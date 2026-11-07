#include "HdmiDirectOutput.h"
#include "AuralisVersion.h"
#include <windows.h>
#include <initguid.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <ks.h>
#include <ksmedia.h>
#include <functiondiscoverykeys_devpkey.h>
#include <wrl/client.h>
#include <avrt.h>
#include <cmath>
#include <complex>
#include <iostream>

using Microsoft::WRL::ComPtr;
namespace {
struct ComScope { HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED); ~ComScope() { if (SUCCEEDED(hr)) CoUninitialize(); } };
struct Handle { HANDLE value = nullptr; ~Handle() { if (value) CloseHandle(value); } };
struct StopClient { IAudioClient* client; ~StopClient() { client->Stop(); } };
juce::String failure(const char* stage, HRESULT hr) { return juce::String(stage) + " (0x" + juce::String::toHexString(static_cast<int>(hr)) + ")"; }
void require(HRESULT hr, const char* stage) { if (FAILED(hr)) throw failure(stage, hr); }
ComPtr<IMMDevice> endpointDevice(const juce::String& id, juce::String& name) {
    if (id.isEmpty()) throw juce::String("HDMI_ENDPOINT_REQUIRED");
    ComPtr<IMMDeviceEnumerator> enumerator;
    require(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator)), "ENDPOINT_ENUMERATOR");
    ComPtr<IMMDevice> endpoint;
    require(enumerator->GetDevice(id.toWideCharPointer(), &endpoint), "HDMI_ENDPOINT_NOT_FOUND");
    DWORD state = 0; require(endpoint->GetState(&state), "ENDPOINT_STATE");
    if (!(state & DEVICE_STATE_ACTIVE)) throw juce::String("HDMI_ENDPOINT_DISCONNECTED");
    ComPtr<IPropertyStore> properties; require(endpoint->OpenPropertyStore(STGM_READ, &properties), "ENDPOINT_PROPERTIES");
    PROPVARIANT form; PropVariantInit(&form);
    const auto hr = properties->GetValue(PKEY_AudioEndpoint_FormFactor, &form);
    const bool display = SUCCEEDED(hr) && form.vt == VT_UI4 && form.ulVal == DigitalAudioDisplayDevice;
    PropVariantClear(&form);
    if (!display) throw juce::String("SELECT_HDMI_OR_DISPLAYPORT_ENDPOINT");
    PROPVARIANT label; PropVariantInit(&label);
    if (SUCCEEDED(properties->GetValue(PKEY_Device_FriendlyName, &label)) && label.vt == VT_LPWSTR) name = label.pwszVal;
    PropVariantClear(&label);
    return endpoint;
}
WAVEFORMATEXTENSIBLE_IEC61937 makeFormat(const juce::var& spec) {
    WAVEFORMATEXTENSIBLE_IEC61937 result {};
    auto& ext = result.FormatExt; auto& fmt = ext.Format;
    const auto codec = spec["codec"].toString();
    const int rate = static_cast<int>(spec["sampleRate"]), channels = static_cast<int>(spec["channels"]);
    const int bits = static_cast<int>(spec["bits"]), valid = static_cast<int>(spec["validBits"]);
    const bool pcm = codec == "pcm" || codec == "pcm-float";
    if (rate < 8000 || rate > 384000 || channels < 1 || channels > 8
        || (bits != 16 && bits != 32) || valid < 1 || valid > bits
        || (!pcm && (channels != 2 || bits != 16))) throw juce::String("INVALID_DIRECT_FORMAT");
    fmt.wFormatTag = WAVE_FORMAT_EXTENSIBLE; fmt.nChannels = static_cast<WORD>(channels);
    fmt.nSamplesPerSec = static_cast<DWORD>(rate); fmt.wBitsPerSample = static_cast<WORD>(bits);
    fmt.nBlockAlign = static_cast<WORD>(channels * bits / 8); fmt.nAvgBytesPerSec = rate * fmt.nBlockAlign;
    fmt.cbSize = static_cast<WORD>((pcm ? sizeof(WAVEFORMATEXTENSIBLE) : sizeof(result)) - sizeof(WAVEFORMATEX));
    ext.Samples.wValidBitsPerSample = static_cast<WORD>(valid);
    ext.dwChannelMask = static_cast<DWORD>(static_cast<int>(spec["channelMask"]));
    if (codec == "pcm") ext.SubFormat = KSDATAFORMAT_SUBTYPE_PCM;
    else if (codec == "pcm-float") ext.SubFormat = KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
    else if (codec == "dts") ext.SubFormat = KSDATAFORMAT_SUBTYPE_IEC61937_DTS;
    else if (codec == "ac3") ext.SubFormat = KSDATAFORMAT_SUBTYPE_IEC61937_DOLBY_DIGITAL;
    else if (codec == "eac3") ext.SubFormat = KSDATAFORMAT_SUBTYPE_IEC61937_DOLBY_DIGITAL_PLUS;
    else throw juce::String("DIRECT_CODEC_UNSUPPORTED");
    result.dwEncodedSamplesPerSec = static_cast<DWORD>(static_cast<int>(spec["encodedSampleRate"]));
    result.dwEncodedChannelCount = static_cast<DWORD>(static_cast<int>(spec["encodedChannels"]));
    result.dwAverageBytesPerSec = 0;
    return result;
}
juce::int64 alignedOffset(double seconds, int rate, int align, int burst, juce::int64 size) {
    const auto unit = static_cast<juce::int64>(burst > 0 ? burst : align);
    return juce::jlimit<juce::int64>(0, size, static_cast<juce::int64>(std::max(0.0, seconds) * rate) * align) / unit * unit;
}
}

HdmiDirectOutput::~HdmiDirectOutput() { close(); }
void HdmiDirectOutput::close() { quit = true; if (worker.joinable()) worker.join(); playing = false; requestedPlaying = false; }
void HdmiDirectOutput::seek(double seconds) { if (std::isfinite(seconds)) pendingSeek = std::max(0.0, seconds); }
juce::var HdmiDirectOutput::probe(const juce::String& id) {
    ComScope com; auto value = std::make_unique<juce::DynamicObject>();
    try { juce::String name; endpointDevice(id, name); value->setProperty("ok", true); value->setProperty("device", name); }
    catch (const juce::String& message) { value->setProperty("ok", false); value->setProperty("error", message); }
    return juce::var(value.release());
}
juce::String HdmiDirectOutput::open(const juce::var& spec, const juce::String& id) {
    close(); quit = false; pendingSeek = -1; position = 0;
    { const juce::ScopedLock guard(lock); error.clear();
      analysisReader.reset();
      const juce::File analysisFile(spec["analysisPath"].toString());
      if (!spec["codec"].toString().startsWith("pcm") && analysisFile.existsAsFile()) {
          juce::WavAudioFormat wav;
          analysisReader.reset(wav.createReaderFor(new juce::FileInputStream(analysisFile), true));
      }
    }
    std::promise<juce::String> promise; auto ready = promise.get_future();
    worker = std::thread(&HdmiDirectOutput::run, this, spec, id, std::move(promise));
    return ready.get();
}
void HdmiDirectOutput::run(juce::var spec, juce::String id, std::promise<juce::String> initialised) {
    ComScope com; bool reported = false; ComPtr<IAudioClient> client;
    DWORD taskIndex = 0; HANDLE task = AvSetMmThreadCharacteristicsW(L"Pro Audio", &taskIndex);
    try {
        if (FAILED(com.hr)) throw failure("COM_INIT", com.hr);
        auto format = makeFormat(spec); auto* wave = &format.FormatExt.Format;
        const auto selectedCodec = spec["codec"].toString();
        const bool pcm = selectedCodec.startsWith("pcm");
        const auto burst = static_cast<int>(spec["burstBytes"]);
        if (!pcm && burst != 2048 && burst != 4096 && burst != 8192 && burst != 6144 && burst != 24576)
            throw juce::String("INVALID_IEC61937_BURST");
        juce::FileInputStream file(juce::File(spec["path"].toString()));
        if (!file.openedOk()) throw juce::String("DIRECT_CACHE_UNREADABLE");
        const auto size = file.getTotalLength(); const int align = wave->nBlockAlign;
        if (size <= 0 || size % (pcm ? align : burst)) throw juce::String("DIRECT_CACHE_INCOMPLETE");
        juce::String name; auto endpoint = endpointDevice(id, name);
        require(endpoint->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &client), "AUDIO_CLIENT");
        auto supported = client->IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, wave, nullptr);
        if (supported != S_OK && !pcm) {
            // Older drivers use the same encoded subtype with the 40-byte descriptor.
            // This changes only the descriptor, never the codec, rate or sample data.
            wave->cbSize = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
            supported = client->IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, wave, nullptr);
        }
        if (supported != S_OK && selectedCodec == "ac3") {
            wave->wFormatTag = WAVE_FORMAT_DOLBY_AC3_SPDIF; wave->cbSize = 0;
            supported = client->IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, wave, nullptr);
        }
        if (supported != S_OK)
            throw juce::String("HDMI_FORMAT_NOT_SUPPORTED: ") + selectedCodec + " / " + juce::String(wave->nSamplesPerSec) + " Hz / " + juce::String(wave->nChannels) + " ch";
        REFERENCE_TIME minimum = 0; require(client->GetDevicePeriod(nullptr, &minimum), "DEVICE_PERIOD");
        REFERENCE_TIME period = std::max<REFERENCE_TIME>(minimum, 1000000); // 100 ms keeps disk IO off the DSP callback.
        auto hr = client->Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, period, period, wave, nullptr);
        if (hr == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED) {
            UINT32 aligned = 0; require(client->GetBufferSize(&aligned), "ALIGNED_BUFFER_SIZE");
            period = static_cast<REFERENCE_TIME>(10000000.0 * aligned / wave->nSamplesPerSec + 0.5);
            client.Reset(); require(endpoint->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &client), "AUDIO_CLIENT_RETRY");
            hr = client->Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, period, period, wave, nullptr);
        }
        require(hr, "HDMI_EXCLUSIVE_OPEN_FAILED");
        Handle event { CreateEventW(nullptr, FALSE, FALSE, nullptr) };
        StopClient stopOnExit { client.Get() };
        if (!event.value) throw juce::String("AUDIO_EVENT_FAILED");
        require(client->SetEventHandle(event.value), "AUDIO_EVENT");
        ComPtr<IAudioRenderClient> render; require(client->GetService(IID_PPV_ARGS(&render)), "RENDER_CLIENT");
        ComPtr<IAudioClock> clock; require(client->GetService(IID_PPV_ARGS(&clock)), "AUDIO_CLOCK");
        UINT64 frequency = 0; require(clock->GetFrequency(&frequency), "CLOCK_FREQUENCY");
        UINT32 capacity = 0; require(client->GetBufferSize(&capacity), "BUFFER_SIZE");
        if (!frequency || !capacity || static_cast<uint64_t>(capacity) * align > 16 * 1024 * 1024) throw juce::String("INVALID_AUDIO_BUFFER");
        { const juce::ScopedLock guard(lock); codec = selectedCodec; device = name;
          rate = static_cast<int>(wave->nSamplesPerSec); channels = wave->nChannels; bits = wave->wBitsPerSample;
          validBits = format.FormatExt.Samples.wValidBitsPerSample; bufferFrames = static_cast<int>(capacity);
          encodedChannels = static_cast<int>(spec["encodedChannels"]); duration = static_cast<double>(size) / (rate * align); }
        juce::MemoryBlock bytes(static_cast<size_t>(capacity) * align);
        juce::int64 baseOffset = 0; bool started = false, primed = false;
        UINT64 lastTicks = 0; ULONGLONG lastClockMove = GetTickCount64();
        auto fill = [&] {
            std::memset(bytes.getData(), 0, bytes.getSize());
            const auto remaining = size - file.getPosition();
            const int wanted = static_cast<int>(std::min<juce::int64>(remaining, static_cast<juce::int64>(bytes.getSize())));
            if (wanted > 0 && file.read(bytes.getData(), wanted) != wanted) throw juce::String("DIRECT_CACHE_READ_FAILED");
            if (pcm && wanted >= align) {
                const auto* raw = static_cast<const unsigned char*>(bytes.getData());
                for (size_t i = 0; i < left.size(); ++i) {
                    const size_t frame = std::min(i, static_cast<size_t>(wanted / align - 1));
                    auto sample = [&](int channel) {
                        const auto* p = raw + frame * align + static_cast<size_t>(channel) * (bits / 8);
                        if (codec == "pcm-float") { float value; std::memcpy(&value, p, 4); return std::isfinite(value) ? value : 0.0f; }
                        return bits == 16 ? static_cast<float>(static_cast<int16_t>(juce::ByteOrder::littleEndianShort(p))) / 32768.0f
                                          : static_cast<float>(static_cast<int32_t>(juce::ByteOrder::littleEndianInt(p))) / 2147483648.0f;
                    };
                    left[i] = sample(0); right[i] = sample(channels > 1 ? 1 : 0);
                }
            }
            BYTE* output = nullptr; require(render->GetBuffer(capacity, &output), "AUDIO_BUFFER");
            std::memcpy(output, bytes.getData(), bytes.getSize()); // exact bytes; no gain, resampling or DSP
            require(render->ReleaseBuffer(capacity, 0), "AUDIO_SUBMIT");
        };
        initialised.set_value({}); reported = true;
        while (!quit) {
            const double seekTo = pendingSeek.exchange(-1);
            if (seekTo >= 0) {
                if (started) require(client->Stop(), "AUDIO_STOP");
                started = false; playing = false;
                require(client->Reset(), "AUDIO_RESET");
                baseOffset = alignedOffset(seekTo, rate, align, burst, size);
                file.setPosition(baseOffset); position = static_cast<double>(baseOffset) / (rate * align); primed = false;
            }
            if (!requestedPlaying) {
                if (started) { require(client->Stop(), "AUDIO_PAUSE"); started = false; }
                playing = false; std::this_thread::sleep_for(std::chrono::milliseconds(5)); continue;
            }
            if (!started) { if (!primed) { fill(); primed = true; } require(client->Start(), "AUDIO_START"); started = true; playing = true; lastClockMove = GetTickCount64(); }
            const auto wait = WaitForSingleObject(event.value, 100);
            UINT64 ticks = 0; require(clock->GetPosition(&ticks, nullptr), "HDMI_DEVICE_LOST");
            if (ticks != lastTicks) { lastTicks = ticks; lastClockMove = GetTickCount64(); }
            else if (GetTickCount64() - lastClockMove > 2000) throw juce::String("HDMI_CLOCK_STALLED");
            const double elapsed = static_cast<double>(ticks) / static_cast<double>(frequency);
            position = std::min(duration, static_cast<double>(baseOffset) / (rate * align) + elapsed);
            if (position >= duration) { require(client->Stop(), "AUDIO_EOF"); started = false; playing = false; requestedPlaying = false; }
            else if (wait == WAIT_OBJECT_0) fill();
            else if (wait != WAIT_TIMEOUT) throw juce::String("AUDIO_EVENT_WAIT_FAILED");
        }
    } catch (const juce::String& message) {
        { const juce::ScopedLock guard(lock); error = message; }
        if (!reported) { initialised.set_value(message); reported = true; }
    } catch (...) {
        { const juce::ScopedLock guard(lock); error = "DIRECT_OUTPUT_FAILURE"; }
        if (!reported) initialised.set_value("DIRECT_OUTPUT_FAILURE");
    }
    if (client) client->Stop(); playing = false; requestedPlaying = false;
    if (task) AvRevertMmThreadCharacteristics(task);
}
bool HdmiDirectOutput::setAnalysisFile(const juce::String& path) {
    const juce::ScopedLock guard(lock);
    juce::WavAudioFormat wav;
    auto reader = std::unique_ptr<juce::AudioFormatReader>(wav.createReaderFor(new juce::FileInputStream(juce::File(path)), true));
    if (!reader) return false;
    analysisReader = std::move(reader);
    return true;
}
juce::var HdmiDirectOutput::status(const juce::String& token, bool analysis) const {
    const juce::ScopedLock guard(lock); auto object = std::make_unique<juce::DynamicObject>();
    AuralisVersion::appendTo(*object); object->setProperty("ok", error.isEmpty());
    if (error.isNotEmpty()) object->setProperty("error", error);
    object->setProperty("playing", playing.load() || requestedPlaying.load());
    object->setProperty("position", position.load()); object->setProperty("duration", duration);
    object->setProperty("playbackToken", token); object->setProperty("source", "local-file");
    object->setProperty("sourceState", playing ? "running" : "stopped");
    object->setProperty("directOutput", true); object->setProperty("directCodec", codec);
    object->setProperty("device", device); object->setProperty("sampleRate", rate);
    object->setProperty("juceDeviceName", device); object->setProperty("backend", "wasapi-exclusive");
    object->setProperty("bitDepth", validBits); object->setProperty("state", error.isEmpty() ? "active" : "error");
    object->setProperty("sourceChannels", encodedChannels); object->setProperty("outputChannels", channels);
    object->setProperty("outputBitDepth", validBits); object->setProperty("bufferSize", bufferFrames);
    object->setProperty("processingMode", "direct"); object->setProperty("plugins", 0); object->setProperty("fadeMs", 0);
    if (!analysis) return juce::var(object.release());
    juce::Array<juce::var> l, r, frequency; float peak = 0; double energy = 0;
    constexpr int fftSize = 512;
    // The decoded file is read only by status polling, never by the WASAPI byte writer.
    // Use the device clock position for pause/seek synchronization, not a second player.
    juce::AudioBuffer<float> decoded;
    bool analysisRead = false;
    if (analysisReader && playing.load()) {
        const int count = static_cast<int>(std::min(analysisReader->numChannels, 8u));
        decoded.setSize(count, fftSize); decoded.clear();
        analysisRead = count > 0 && analysisReader->read(decoded.getArrayOfWritePointers(), count,
            static_cast<juce::int64>(position.load() * analysisReader->sampleRate), fftSize);
    }
    object->setProperty("analysisSampleRate", analysisReader ? analysisReader->sampleRate : rate);
    object->setProperty("analysisSource", analysisReader ? "decoded-sidecar" : codec.startsWith("pcm") ? "direct-pcm" : "unavailable");
    std::array<std::complex<double>, fftSize> spectrum {};
    for (size_t i = 0; i < left.size(); ++i) {
        float a = playing ? left[i].load() : 0, b = playing ? right[i].load() : 0;
        if (analysisRead) {
            const int count = decoded.getNumChannels();
            a = decoded.getSample(0, static_cast<int>(i));
            b = decoded.getSample(count > 1 ? 1 : 0, static_cast<int>(i));
            // Include centre/surround content in this analysis-only stereo overview.
            for (int channel = 2; channel < count; ++channel) {
                const float value = decoded.getSample(channel, static_cast<int>(i)) * 0.5f;
                a += value; b += value;
            }
            const float scale = 1.0f / (1.0f + std::max(0, count - 2) * 0.5f);
            a *= scale; b *= scale;
        }
        if ((i & 1) == 0) { l.add(a); r.add(b); }
        spectrum[i] = (a + b) * 0.5 * (0.5 - 0.5 * std::cos(juce::MathConstants<double>::twoPi * static_cast<double>(i) / (fftSize - 1)));
        peak = std::max({peak, std::abs(a), std::abs(b)}); energy += (a*a+b*b)*0.5; }
    for (int i = 1, j = 0; i < fftSize; ++i) {
        int bit = fftSize >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) std::swap(spectrum[static_cast<size_t>(i)], spectrum[static_cast<size_t>(j)]);
    }
    for (int length = 2; length <= fftSize; length <<= 1) {
        const auto step = std::polar(1.0, -juce::MathConstants<double>::twoPi / length);
        for (int offset = 0; offset < fftSize; offset += length) {
            std::complex<double> factor(1.0, 0.0);
            for (int i = 0; i < length / 2; ++i) {
                const auto even = spectrum[static_cast<size_t>(offset + i)];
                const auto odd = spectrum[static_cast<size_t>(offset + i + length / 2)] * factor;
                spectrum[static_cast<size_t>(offset + i)] = even + odd;
                spectrum[static_cast<size_t>(offset + i + length / 2)] = even - odd;
                factor *= step;
            }
        }
    }
    for (int bin = 0; bin < 256; ++bin) {
        const double magnitude = std::abs(spectrum[static_cast<size_t>(bin)]) / (fftSize * 0.5);
        const double db = 20.0 * std::log10(std::max(1.0e-8, magnitude));
        frequency.add(static_cast<int>(255 * juce::jlimit(0.0, 1.0, (db + 90.0) / 80.0)));
    }
    object->setProperty("nativeLeft", l); object->setProperty("nativeRight", r); object->setProperty("nativeFrequency", frequency);
    object->setProperty("nativePeak", peak); object->setProperty("nativeRms", std::sqrt(energy / fftSize));
    return juce::var(object.release());
}
int HdmiDirectOutput::selfTest() {
    auto spec = juce::JSON::parse(R"({"codec":"pcm","sampleRate":44100,"channels":2,"bits":32,"validBits":24,"channelMask":3})");
    const auto pcm = makeFormat(spec);
    if (pcm.FormatExt.Format.nBlockAlign != 8 || pcm.FormatExt.Samples.wValidBitsPerSample != 24 || pcm.FormatExt.Format.cbSize != 22) return 1;
    spec.getDynamicObject()->setProperty("codec", "dts"); spec.getDynamicObject()->setProperty("bits", 16); spec.getDynamicObject()->setProperty("validBits", 16);
    const auto dts = makeFormat(spec);
    if (dts.FormatExt.SubFormat != KSDATAFORMAT_SUBTYPE_IEC61937_DTS || dts.FormatExt.Format.cbSize != 34) return 1;
    if (alignedOffset(1, 44100, 4, 2048, 999999) % 2048) return 1;
    spec.getDynamicObject()->setProperty("codec", "unknown");
    try { makeFormat(spec); return 1; } catch (const juce::String&) {}
    if (static_cast<bool>(probe("missing-device")["ok"])) return 1;
    // In-memory decoded sidecar: exercise nonzero analysis, pause and clock-based seek.
    juce::MemoryBlock waveData;
    juce::WavAudioFormat wav;
    {
        std::unique_ptr<juce::AudioFormatWriter> writer(wav.createWriterFor(new juce::MemoryOutputStream(waveData, false), 48000.0, 6, 16, {}, 0));
        if (!writer) return 1;
        juce::AudioBuffer<float> samples(6, 48000); samples.clear();
        for (int i = 0; i < 24000; ++i) samples.setSample(2, i, static_cast<float>(0.6 * std::sin(juce::MathConstants<double>::twoPi * 1000 * i / 48000.0)));
        if (!writer->writeFromAudioSampleBuffer(samples, 0, samples.getNumSamples())) return 1;
    }
    HdmiDirectOutput analysis;
    analysis.codec = "dts";
    analysis.analysisReader.reset(wav.createReaderFor(new juce::MemoryInputStream(waveData, false), true));
    if (!analysis.analysisReader) return 1;
    analysis.position = 0.1; analysis.playing = true;
    const auto light = analysis.status("test", false);
    if (light.hasProperty("nativeFrequency") || static_cast<double>(light["position"]) != 0.1 || !static_cast<bool>(light["playing"])) return 1;
    auto measured = analysis.status("test");
    if (static_cast<double>(measured["nativePeak"]) < 0.05 || static_cast<double>(measured["analysisSampleRate"]) != 48000) return 1;
    bool spectrumPresent = false;
    for (const auto& bin : *measured["nativeFrequency"].getArray()) spectrumPresent |= static_cast<int>(bin) > 0;
    if (!spectrumPresent) return 1;
    analysis.playing = false;
    if (static_cast<double>(analysis.status("test")["nativePeak"]) != 0) return 1;
    analysis.playing = true; analysis.position = 0.75;
    if (static_cast<double>(analysis.status("test")["nativePeak"]) != 0) return 1;
    std::cout << "HDMI decoded analysis: centre-channel signal, spectrum, pause and seek: PASS" << std::endl;
    std::cout << "HDMI direct format, burst-aligned seek, unsupported codec and missing endpoint rejection: PASS" << std::endl;
    return 0;
}
