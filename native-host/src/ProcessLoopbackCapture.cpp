#include "ProcessLoopbackCapture.h"

#if defined(_WIN32)

#include <algorithm>
#include <avrt.h>
#include <cmath>
#include <cstring>

using Microsoft::WRL::ComPtr;

ProcessLoopbackCapture::ProcessLoopbackCapture()
{
    activationEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    sampleEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    stopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
}

ProcessLoopbackCapture::~ProcessLoopbackCapture()
{
    stop();
    if (activationEvent) CloseHandle(activationEvent);
    if (sampleEvent) CloseHandle(sampleEvent);
    if (stopEvent) CloseHandle(stopEvent);
}

void ProcessLoopbackCapture::resetState(double requestedSampleRate)
{
    stop();
    ResetEvent(stopEvent);
    ResetEvent(activationEvent);
    fifo.reset();
    primed = false;
    peak = 0.0f;
    capturedFrames = 0;
    capturedPackets = 0;
    timedFrames = 0;
    firstPacketQpc100ns = 0;
    lastPacketQpc100ns = 0;
    maxPacketGap100ns = 0;
    underruns = 0;
    overruns = 0;
    discontinuities = 0;
    silentPackets = 0;
    silentFrames = 0;
    zeroDataPackets = 0;
    zeroDataFrames = 0;
    rawRms = 0.0f;
    driftPpm = 0.0;
    driftRatio = 1.0;
    driftIntegral = 0.0;
    stableRenderedFrames = 0;
    stagedFrames = 0;
    lastOutputLeft = 0.0f;
    lastOutputRight = 0.0f;
    fadeInRemaining = 0;
    fadeInTotal = 0;
    recovering = true;
    leftInterpolator.reset();
    rightInterpolator.reset();
    targetPid = 0;
    activationResult = E_PENDING;

    format.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
    format.nChannels = 2;
    format.nSamplesPerSec = static_cast<DWORD>(requestedSampleRate > 0 ? requestedSampleRate : 44100.0);
    format.wBitsPerSample = 32;
    format.nBlockAlign = format.nChannels * format.wBitsPerSample / 8;
    format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
    format.cbSize = 0;
    // Process-loopback and the physical output device run on independent
    // clocks. Keep enough initial headroom to absorb USB/WDM scheduling bursts
    // without turning a short delay into a repeating mute/re-prime cycle.
    minimumBufferedFrames = std::max(4096, static_cast<int>(format.nSamplesPerSec * 0.100));
    maximumBufferedFrames = std::max(minimumBufferedFrames, static_cast<int>(format.nSamplesPerSec * 0.300));
    targetBufferedFrames = std::clamp(static_cast<int>(format.nSamplesPerSec * 0.120),
                                      minimumBufferedFrames, maximumBufferedFrames);
}

HRESULT ProcessLoopbackCapture::initialiseClient()
{
    if (!audioClient) return E_POINTER;
    auto hr = audioClient->Initialize(AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
            AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
        0, 0, &format, nullptr);
    if (FAILED(hr)) return hr;
    if (FAILED(hr = audioClient->GetService(IID_PPV_ARGS(&captureClient)))) return hr;
    if (FAILED(hr = audioClient->SetEventHandle(sampleEvent))) return hr;
    if (FAILED(hr = audioClient->Start())) return hr;
    running = true;
    captureThread = std::thread([this] { captureLoop(); });
    return S_OK;
}

HRESULT ProcessLoopbackCapture::start(DWORD processId, double requestedSampleRate)
{
    if (!activationEvent || !sampleEvent || !stopEvent || processId == 0) return E_INVALIDARG;
    resetState(requestedSampleRate);
    targetPid = processId;

    AUDIOCLIENT_ACTIVATION_PARAMS params{};
    params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    params.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
    params.ProcessLoopbackParams.TargetProcessId = processId;
    PROPVARIANT prop{};
    prop.vt = VT_BLOB;
    prop.blob.cbSize = sizeof(params);
    prop.blob.pBlobData = reinterpret_cast<BYTE*>(&params);
    ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
    auto hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient),
                                          &prop, this, &operation);
    if (FAILED(hr)) return hr;
    if (WaitForSingleObject(activationEvent, 5000) != WAIT_OBJECT_0) return HRESULT_FROM_WIN32(ERROR_TIMEOUT);
    hr = activationResult.load();
    if (FAILED(hr)) return hr;

    return initialiseClient();
}

HRESULT ProcessLoopbackCapture::ActivateCompleted(IActivateAudioInterfaceAsyncOperation* operation)
{
    HRESULT activateHr = E_FAIL;
    ComPtr<IUnknown> activated;
    auto hr = operation->GetActivateResult(&activateHr, &activated);
    if (SUCCEEDED(hr)) hr = activateHr;
    if (SUCCEEDED(hr)) hr = activated.As(&audioClient);
    activationResult = hr;
    SetEvent(activationEvent);
    return S_OK;
}

void ProcessLoopbackCapture::stop()
{
    running = false;
    if (stopEvent) SetEvent(stopEvent);
    if (captureThread.joinable()) captureThread.join();
    if (audioClient) audioClient->Stop();
    captureClient.Reset();
    audioClient.Reset();
}

void ProcessLoopbackCapture::captureLoop()
{
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    DWORD taskIndex = 0;
    const auto mmcssHandle = AvSetMmThreadCharacteristicsW(L"Pro Audio", &taskIndex);
    if (mmcssHandle != nullptr) AvSetMmThreadPriority(mmcssHandle, AVRT_PRIORITY_HIGH);
    HANDLE events[] = { stopEvent, sampleEvent };
    while (running.load())
    {
        const auto wait = WaitForMultipleObjects(2, events, FALSE, 1000);
        if (wait == WAIT_OBJECT_0) break;
        if (wait != WAIT_OBJECT_0 + 1) continue;
        UINT32 available = 0;
        auto packetResult = captureClient->GetNextPacketSize(&available);
        if (FAILED(packetResult)) {
            activationResult = packetResult;
            running = false;
            break;
        }
        while (running.load() && available > 0)
        {
            BYTE* data = nullptr;
            DWORD flags = 0;
            UINT64 devicePosition = 0, qpcPosition = 0;
            const auto bufferResult = captureClient->GetBuffer(&data, &available, &flags, &devicePosition, &qpcPosition);
            if (FAILED(bufferResult)) { activationResult = bufferResult; running = false; break; }
            recordPacketTiming(qpcPosition, available);
            if ((flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY) != 0) {
                ++discontinuities;
                raiseTargetBuffer(std::max(256, static_cast<int>(format.nSamplesPerSec * 0.010)));
            }
            if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0 || data == nullptr) {
                ++silentPackets;
                silentFrames += static_cast<uint64_t>(available);
            }
            push((flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0 || data == nullptr
                    ? nullptr : reinterpret_cast<const float*>(data),
                 static_cast<int>(available));
            captureClient->ReleaseBuffer(available);
            packetResult = captureClient->GetNextPacketSize(&available);
            if (FAILED(packetResult)) { activationResult = packetResult; running = false; break; }
        }
    }
    if (mmcssHandle != nullptr) AvRevertMmThreadCharacteristics(mmcssHandle);
    CoUninitialize();
}

void ProcessLoopbackCapture::recordPacketTiming(uint64_t qpcPosition100ns, uint32_t frames) noexcept
{
    capturedPackets.fetch_add(1, std::memory_order_relaxed);
    if (qpcPosition100ns == 0) return;

    const auto previous = lastPacketQpc100ns.exchange(qpcPosition100ns, std::memory_order_relaxed);
    if (previous == 0) {
        firstPacketQpc100ns.store(qpcPosition100ns, std::memory_order_relaxed);
        return;
    }
    if (qpcPosition100ns <= previous) return;

    timedFrames.fetch_add(static_cast<uint64_t>(frames), std::memory_order_relaxed);
    const auto gap = qpcPosition100ns - previous;
    auto current = maxPacketGap100ns.load(std::memory_order_relaxed);
    while (gap > current
           && !maxPacketGap100ns.compare_exchange_weak(current, gap, std::memory_order_relaxed)) {}
}

double ProcessLoopbackCapture::capturedFramesPerSecond() const noexcept
{
    const auto first = firstPacketQpc100ns.load(std::memory_order_relaxed);
    const auto last = lastPacketQpc100ns.load(std::memory_order_relaxed);
    const auto frames = timedFrames.load(std::memory_order_relaxed);
    if (first == 0 || last <= first || frames == 0) return 0.0;
    return static_cast<double>(frames) * 10000000.0 / static_cast<double>(last - first);
}

double ProcessLoopbackCapture::captureRateRatio() const noexcept
{
    const auto sourceRate = sourceSampleRate();
    return sourceRate > 0.0 ? capturedFramesPerSecond() / sourceRate : 0.0;
}

void ProcessLoopbackCapture::push(const float* interleaved, int frames) noexcept
{
    const int writable = std::min(frames, fifo.getFreeSpace());
    if (writable < frames) overruns += static_cast<uint64_t>(frames - writable);
    const auto scope = fifo.write(writable);
    float blockPeak = 0.0f;
    double blockSquares = 0.0;
    int sourceFrame = 0;
    const auto copyBlock = [&](int start, int length)
    {
        for (int i = 0; i < length; ++i)
        {
            const int source = sourceFrame++ * 2;
            const float left = interleaved ? interleaved[source] : 0.0f;
            const float right = interleaved ? interleaved[source + 1] : 0.0f;
            fifoBuffer.setSample(0, start + i, left);
            fifoBuffer.setSample(1, start + i, right);
            blockPeak = std::max(blockPeak, std::max(std::abs(left), std::abs(right)));
            blockSquares += 0.5 * (static_cast<double>(left) * left
                                + static_cast<double>(right) * right);
        }
    };
    copyBlock(scope.startIndex1, scope.blockSize1);
    copyBlock(scope.startIndex2, scope.blockSize2);
    capturedFrames += static_cast<uint64_t>(frames);
    peak = std::max(blockPeak, peak.load() * 0.92f);
    const auto blockRms = frames > 0 ? static_cast<float>(std::sqrt(blockSquares / frames)) : 0.0f;
    rawRms = blockRms;
    if (frames > 0 && blockPeak < 1.0e-7f) {
        ++zeroDataPackets;
        zeroDataFrames += static_cast<uint64_t>(frames);
    }
}

int ProcessLoopbackCapture::readRaw(float* left, float* right, int frames) noexcept
{
    const auto scope = fifo.read(std::min(frames, fifo.getNumReady()));
    int copied = 0;
    const auto copyBlock = [&](int start, int length)
    {
        if (length <= 0) return;
        juce::FloatVectorOperations::copy(left + copied, fifoBuffer.getReadPointer(0, start), length);
        juce::FloatVectorOperations::copy(right + copied, fifoBuffer.getReadPointer(1, start), length);
        copied += length;
    };
    copyBlock(scope.startIndex1, scope.blockSize1);
    copyBlock(scope.startIndex2, scope.blockSize2);
    return copied;
}

int ProcessLoopbackCapture::discardBufferedFrames(int maximumFrames) noexcept
{
    const auto frames = std::min(std::max(0, maximumFrames), fifo.getNumReady());
    const auto scope = fifo.read(frames);
    return scope.blockSize1 + scope.blockSize2;
}

void ProcessLoopbackCapture::raiseTargetBuffer(int additionalFrames) noexcept
{
    auto current = targetBufferedFrames.load(std::memory_order_relaxed);
    const auto desired = std::min(maximumBufferedFrames, current + std::max(1, additionalFrames));
    while (current < desired
           && !targetBufferedFrames.compare_exchange_weak(current, desired, std::memory_order_relaxed)) {}
}

void ProcessLoopbackCapture::renderConcealment(float* left, float* right, int frames) noexcept
{
    const auto fadeFrames = std::min(frames, std::max(32, static_cast<int>(format.nSamplesPerSec * 0.008)));
    for (int i = 0; i < fadeFrames; ++i) {
        const auto gain = 1.0f - static_cast<float>(i + 1) / static_cast<float>(fadeFrames);
        left[i] = lastOutputLeft * gain;
        right[i] = lastOutputRight * gain;
    }
    if (fadeFrames < frames) {
        juce::FloatVectorOperations::clear(left + fadeFrames, frames - fadeFrames);
        juce::FloatVectorOperations::clear(right + fadeFrames, frames - fadeFrames);
    }
    lastOutputLeft = 0.0f;
    lastOutputRight = 0.0f;
}

void ProcessLoopbackCapture::applyRecoveryFade(float* left, float* right, int frames) noexcept
{
    if (fadeInRemaining <= 0 || fadeInTotal <= 0) return;
    const auto affected = std::min(frames, fadeInRemaining);
    const auto completed = fadeInTotal - fadeInRemaining;
    for (int i = 0; i < affected; ++i) {
        const auto gain = static_cast<float>(completed + i + 1) / static_cast<float>(fadeInTotal);
        left[i] *= std::min(1.0f, gain);
        right[i] *= std::min(1.0f, gain);
    }
    fadeInRemaining -= affected;
}

int ProcessLoopbackCapture::read(float* left, float* right, int frames) noexcept
{
    const int ready = fifo.getNumReady() + stagedFrames;
    if (!primed) {
        if (ready < targetBufferedFrames.load(std::memory_order_relaxed)) {
            driftPpm = 0.0;
            renderConcealment(left, right, frames);
            return frames;
        }
        primed = true;
        recovering = false;
        fadeInTotal = fadeInRemaining = std::max(frames, static_cast<int>(format.nSamplesPerSec * 0.012));
    }
    if (ready < frames + 8) {
        primed = false;
        recovering = true;
        ++underruns;
        // Grow the target after every real starvation. This turns repeated
        // 75 ms gating into a single, softly concealed recovery and adapts to
        // slower USB/WDM driver stacks without penalising stable machines.
        raiseTargetBuffer(std::max(frames * 2, static_cast<int>(format.nSamplesPerSec * 0.025)));
        stableRenderedFrames = 0;
        driftRatio = 1.0;
        driftIntegral = 0.0;
        driftPpm = 0.0;
        leftInterpolator.reset();
        rightInterpolator.reset();
        renderConcealment(left, right, frames);
        return frames;
    }

    // Track independent capture/output clocks with a continuous ratio. The
    // controller is intentionally limited to +/-800 ppm and slews by at most
    // 10 ppm per block, avoiding the audible 440/441/442-frame block hopping
    // used by the previous implementation.
    const auto currentTarget = targetBufferedFrames.load(std::memory_order_relaxed);
    const double fillError = static_cast<double>(ready - currentTarget)
                           / static_cast<double>(std::max(1, currentTarget));
    driftIntegral = std::clamp(driftIntegral + fillError * 0.0000004, -0.00035, 0.00035);
    const double targetRatio = 1.0 + std::clamp(fillError * 0.00022 + driftIntegral, -0.0008, 0.0008);
    driftRatio += std::clamp(targetRatio - driftRatio, -0.00001, 0.00001);
    driftPpm = (driftRatio - 1.0) * 1000000.0;

    const int required = std::min(static_cast<int>(stagingCapacity),
                                  static_cast<int>(std::ceil(driftRatio * frames)) + 8);
    if (stagedFrames < required) {
        const int wanted = required - stagedFrames;
        const int got = readRaw(rawLeft.data() + stagedFrames, rawRight.data() + stagedFrames, wanted);
        stagedFrames += got;
    }
    if (stagedFrames < static_cast<int>(std::ceil(driftRatio * frames)) + 2) {
        primed = false;
        recovering = true;
        ++underruns;
        raiseTargetBuffer(std::max(frames * 2, static_cast<int>(format.nSamplesPerSec * 0.025)));
        stableRenderedFrames = 0;
        driftRatio = 1.0;
        driftIntegral = 0.0;
        driftPpm = 0.0;
        leftInterpolator.reset();
        rightInterpolator.reset();
        renderConcealment(left, right, frames);
        return frames;
    }

    const int usedLeft = leftInterpolator.process(driftRatio, rawLeft.data(), left, frames, stagedFrames, 0);
    const int usedRight = rightInterpolator.process(driftRatio, rawRight.data(), right, frames, stagedFrames, 0);
    const int used = std::min(usedLeft, usedRight);
    const int remaining = std::max(0, stagedFrames - used);
    if (remaining > 0) {
        std::memmove(rawLeft.data(), rawLeft.data() + used, static_cast<size_t>(remaining) * sizeof(float));
        std::memmove(rawRight.data(), rawRight.data() + used, static_cast<size_t>(remaining) * sizeof(float));
    }
    stagedFrames = remaining;
    applyRecoveryFade(left, right, frames);
    lastOutputLeft = left[frames - 1];
    lastOutputRight = right[frames - 1];

    // After thirty stable seconds, cautiously reduce excess latency while
    // keeping a 100 ms floor. Recovery raises happen immediately; reductions
    // are deliberately slow so the buffer cannot oscillate.
    stableRenderedFrames += static_cast<uint64_t>(frames);
    if (stableRenderedFrames >= static_cast<uint64_t>(format.nSamplesPerSec) * 30u) {
        auto target = targetBufferedFrames.load(std::memory_order_relaxed);
        while (target > minimumBufferedFrames) {
            const auto reduced = std::max(minimumBufferedFrames,
                                          target - static_cast<int>(format.nSamplesPerSec * 0.005));
            if (targetBufferedFrames.compare_exchange_weak(target, reduced, std::memory_order_relaxed)) break;
        }
        stableRenderedFrames = 0;
    }
    return frames;
}

#endif
