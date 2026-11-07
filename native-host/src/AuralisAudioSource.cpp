#include "AuralisAudioSource.h"

namespace {
void updateMaximum(std::atomic<uint64_t>& destination, uint64_t candidate) noexcept
{
    auto current = destination.load(std::memory_order_relaxed);
    while (candidate > current
        && !destination.compare_exchange_weak(current, candidate, std::memory_order_relaxed)) {}
}

void updateMinimum(std::atomic<uint64_t>& destination, uint64_t candidate) noexcept
{
    auto current = destination.load(std::memory_order_relaxed);
    while (candidate < current
        && !destination.compare_exchange_weak(current, candidate, std::memory_order_relaxed)) {}
}
}

FileAudioSource::FileAudioSource(juce::AudioTransportSource& source, double nativeSampleRate)
    : transport(source), sourceSampleRate(nativeSampleRate)
{
}

bool FileAudioSource::start(juce::String& error)
{
    juce::ignoreUnused(error);
    transport.start();
    return true;
}

void FileAudioSource::stop() { transport.stop(); }

bool FileAudioSource::prepare(double outputSampleRate, int maximumBlockSize, juce::String& error)
{
    juce::ignoreUnused(error);
    engineSampleRate = outputSampleRate;
    engineBlockSize = maximumBlockSize;
    transport.prepareToPlay(maximumBlockSize, outputSampleRate);
    return true;
}

void FileAudioSource::release() { transport.releaseResources(); }

int FileAudioSource::render(juce::AudioBuffer<float>& destination) noexcept
{
    const auto wasPlaying = transport.isPlaying();
    // JUCE acknowledges stop() inside getNextAudioBlock(), after playing has
    // already become false. Keep pulling that final block or stop waits for
    // its one-second timeout. Do not expose JUCE's unprocessed stop tail after
    // the application's own fade/master path has stopped this source.
    transport.getNextAudioBlock({ &destination, 0, destination.getNumSamples() });
    if (!wasPlaying) { destination.clear(); return 0; }
    return destination.getNumSamples();
}

bool FileAudioSource::isActive() const noexcept { return transport.isPlaying(); }

void FileAudioSource::appendStatus(juce::DynamicObject& status) const
{
    status.setProperty("source", "local-file");
    status.setProperty("sourceState", transport.isPlaying() ? "running" : "stopped");
    status.setProperty("sourceSampleRate", sourceSampleRate);
    status.setProperty("sourceChannels", 2);
    status.setProperty("sourceOutputRate", engineSampleRate);
    status.setProperty("sourceBlockSize", engineBlockSize);
    status.setProperty("sourcePosition", transport.getCurrentPosition());
    status.setProperty("sourceDuration", transport.getLengthInSeconds());
    status.setProperty("sourceDiscontinuities", 0);
}

BrowserPcmAudioSource::BrowserPcmAudioSource()
    : leftRing(static_cast<size_t>(capacityFrames), 0.0f),
      rightRing(static_cast<size_t>(capacityFrames), 0.0f)
{
}

bool BrowserPcmAudioSource::start(juce::String& error)
{
    juce::ignoreUnused(error);
    running.store(true, std::memory_order_release);
    return true;
}

void BrowserPcmAudioSource::stop()
{
    running.store(false, std::memory_order_release);
    primed = false;
    fractionalRead = 0.0;
    driftRatio = 1.0;
    recoveryGain = 0.0f;
    lastOutputLeft = lastOutputRight = 0.0f;
    readPosition.store(writePosition.load(std::memory_order_acquire), std::memory_order_release);
}

bool BrowserPcmAudioSource::prepare(double outputSampleRate, int maximumBlockSize, juce::String& error)
{
    if (outputSampleRate < 8000.0 || outputSampleRate > 384000.0) {
        error = "PCM_OUTPUT_RATE_INVALID";
        return false;
    }
    outputRate = outputSampleRate;
    outputBlockSize = maximumBlockSize;
    running.store(true, std::memory_order_release);
    return true;
}

void BrowserPcmAudioSource::release() { stop(); }

int BrowserPcmAudioSource::pushInterleaved(const float* samples, int frames, int channels, double sampleRate) noexcept
{
    if (!running.load(std::memory_order_acquire) || samples == nullptr || frames <= 0 || channels != 2
        || sampleRate < 8000.0 || sampleRate > 384000.0) return 0;
    const auto write = writePosition.load(std::memory_order_relaxed);
    const auto read = readPosition.load(std::memory_order_acquire);
    const auto buffered = write - read;
    if (static_cast<uint64_t>(frames) >= capacityFrames || buffered + static_cast<uint64_t>(frames) >= capacityFrames) {
        droppedFrames.fetch_add(static_cast<uint64_t>(frames), std::memory_order_relaxed);
        return 0;
    }
    float peak = 0.0f;
    for (int frame = 0; frame < frames; ++frame) {
        const auto index = static_cast<size_t>((write + static_cast<uint64_t>(frame)) % capacityFrames);
        const auto left = samples[frame * channels];
        const auto right = samples[frame * channels + 1];
        leftRing[index] = left;
        rightRing[index] = right;
        peak = juce::jmax(peak, juce::jmax(std::abs(left), std::abs(right)));
    }
    inputSampleRate.store(sampleRate, std::memory_order_relaxed);
    inputPeak.store(peak, std::memory_order_relaxed);
    receivedPackets.fetch_add(1, std::memory_order_relaxed);
    receivedFrames.fetch_add(static_cast<uint64_t>(frames), std::memory_order_relaxed);
    if (peak <= 1.0e-9f) {
        zeroPackets.fetch_add(1, std::memory_order_relaxed);
        zeroFrames.fetch_add(static_cast<uint64_t>(frames), std::memory_order_relaxed);
    }
    writePosition.store(write + static_cast<uint64_t>(frames), std::memory_order_release);
    return frames;
}

void BrowserPcmAudioSource::resetForNewSession(bool binaryTransport) noexcept
{
    const auto write = writePosition.load(std::memory_order_acquire);
    readPosition.store(write, std::memory_order_release);
    sessionStartReadPosition.store(write, std::memory_order_release);
    captureRestartCount.fetch_add(1, std::memory_order_relaxed);
    binaryInput.store(binaryTransport, std::memory_order_relaxed);
    primed = false;
    fractionalRead = 0.0;
    driftRatio = 1.0;
    recoveryGain = 0.0f;
    lastOutputLeft = lastOutputRight = 0.0f;
    inputSampleRate.store(0.0, std::memory_order_relaxed);
}

int BrowserPcmAudioSource::render(juce::AudioBuffer<float>& destination) noexcept
{
    if (!running.load(std::memory_order_acquire) || destination.getNumChannels() <= 0) return 0;
    const auto sourceRate = inputSampleRate.load(std::memory_order_relaxed);
    if (sourceRate <= 0.0) return 0;
    const auto read = readPosition.load(std::memory_order_relaxed);
    const auto write = writePosition.load(std::memory_order_acquire);
    const auto buffered = write - read;
    updateMinimum(captureBufferMinFrames, buffered);
    updateMaximum(captureBufferMaxFrames, buffered);
    const auto histogramIndex = static_cast<size_t>(juce::jmin<uint64_t>(
        captureHistogramBucketCount - 1, buffered / captureHistogramBucketFrames));
    captureBufferHistogram[histogramIndex].fetch_add(1, std::memory_order_relaxed);
    const auto baseRatio = sourceRate / outputRate;
    const auto minimum = static_cast<uint64_t>(std::ceil((destination.getNumSamples() + 2) * baseRatio));
    const auto primeLevel = juce::jmax<uint64_t>(4096, static_cast<uint64_t>(sourceRate * targetBufferSeconds * 0.82));
    if (!primed && buffered >= juce::jmax(minimum, primeLevel)) {
        primed = true;
        primingCount.fetch_add(1, std::memory_order_relaxed);
    }
    if (!primed || buffered < minimum) {
        if (primed) {
            underruns.fetch_add(1, std::memory_order_relaxed);
            targetBufferSeconds = juce::jmin(0.38, targetBufferSeconds + 0.035);
            auto* outputLeft = destination.getWritePointer(0);
            auto* outputRight = destination.getWritePointer(destination.getNumChannels() > 1 ? 1 : 0);
            const auto fadeSamples = juce::jmax(1, juce::jmin(destination.getNumSamples(), static_cast<int>(outputRate * 0.006)));
            for (int sample = 0; sample < fadeSamples; ++sample) {
                const auto gain = 1.0f - static_cast<float>(sample + 1) / static_cast<float>(fadeSamples);
                outputLeft[sample] = lastOutputLeft * gain;
                outputRight[sample] = lastOutputRight * gain;
            }
            recoveryGain = 0.0f;
        }
        primed = false;
        return destination.getNumSamples();
    }

    const auto target = juce::jmax(1.0, sourceRate * targetBufferSeconds);
    const auto fillError = (static_cast<double>(buffered) - target) / target;
    const auto requestedDrift = 1.0 + juce::jlimit(-0.0012, 0.0012, fillError * 0.00035);
    driftRatio += juce::jlimit(-0.00001, 0.00001, requestedDrift - driftRatio);
    const auto ratio = baseRatio * driftRatio;
    auto* outputLeft = destination.getWritePointer(0);
    auto* outputRight = destination.getWritePointer(destination.getNumChannels() > 1 ? 1 : 0);
    auto cursor = fractionalRead;
    for (int sample = 0; sample < destination.getNumSamples(); ++sample) {
        const auto whole = static_cast<uint64_t>(cursor);
        const auto fraction = static_cast<float>(cursor - static_cast<double>(whole));
        const auto first = static_cast<size_t>((read + whole) % capacityFrames);
        const auto second = static_cast<size_t>((read + whole + 1) % capacityFrames);
        const auto left = leftRing[first] + (leftRing[second] - leftRing[first]) * fraction;
        const auto right = rightRing[first] + (rightRing[second] - rightRing[first]) * fraction;
        recoveryGain = juce::jmin(1.0f, recoveryGain + static_cast<float>(1.0 / (outputRate * 0.010)));
        outputLeft[sample] = left * recoveryGain;
        outputRight[sample] = right * recoveryGain;
        cursor += ratio;
    }
    lastOutputLeft = outputLeft[destination.getNumSamples() - 1];
    lastOutputRight = outputRight[destination.getNumSamples() - 1];
    const auto consumed = static_cast<uint64_t>(cursor);
    fractionalRead = cursor - static_cast<double>(consumed);
    readPosition.store(read + consumed, std::memory_order_release);
    return destination.getNumSamples();
}

bool BrowserPcmAudioSource::isActive() const noexcept
{
    return running.load(std::memory_order_acquire);
}

void BrowserPcmAudioSource::appendStatus(juce::DynamicObject& status) const
{
    const auto write = writePosition.load(std::memory_order_acquire);
    const auto read = readPosition.load(std::memory_order_acquire);
    const auto buffered = write >= read ? write - read : 0;
    uint64_t histogramSamples = 0;
    for (const auto& bucket : captureBufferHistogram)
        histogramSamples += bucket.load(std::memory_order_relaxed);
    const auto maximumFrames = captureBufferMaxFrames.load(std::memory_order_relaxed);
    const auto percentileFrames = [&](double percentile) {
        if (histogramSamples == 0) return static_cast<uint64_t>(0);
        const auto rank = static_cast<uint64_t>(std::ceil(histogramSamples * percentile));
        uint64_t cumulative = 0;
        for (size_t index = 0; index < captureBufferHistogram.size(); ++index) {
            cumulative += captureBufferHistogram[index].load(std::memory_order_relaxed);
            if (cumulative >= rank)
                return juce::jmin<uint64_t>(maximumFrames, (index + 1) * captureHistogramBucketFrames);
        }
        return maximumFrames;
    };
    const auto minimumFrames = captureBufferMinFrames.load(std::memory_order_relaxed);
    status.setProperty("source", "browser-pcm");
    status.setProperty("sourceState", isActive() ? "running" : "stopped");
    status.setProperty("sourceChannels", 2);
    status.setProperty("sourceSampleRate", inputSampleRate.load(std::memory_order_relaxed));
    status.setProperty("sourceOutputRate", outputRate);
    status.setProperty("sourceBlockSize", outputBlockSize);
    status.setProperty("sourceDiscontinuities", static_cast<juce::int64>(underruns.load(std::memory_order_relaxed)));
    status.setProperty("captureRunning", isActive());
    status.setProperty("capturePeak", inputPeak.load(std::memory_order_relaxed));
    status.setProperty("capturedFrames", static_cast<juce::int64>(receivedFrames.load(std::memory_order_relaxed)));
    const auto consumed = readPosition.load(std::memory_order_relaxed)
        - sessionStartReadPosition.load(std::memory_order_relaxed);
    status.setProperty("captureConsumedFrames", static_cast<juce::int64>(consumed));
    status.setProperty("capturePackets", static_cast<juce::int64>(receivedPackets.load(std::memory_order_relaxed)));
    status.setProperty("captureSourceRate", inputSampleRate.load(std::memory_order_relaxed));
    status.setProperty("inputSampleRate", inputSampleRate.load(std::memory_order_relaxed));
    status.setProperty("outputSampleRate", outputRate);
    status.setProperty("outputBlockSize", outputBlockSize);
    status.setProperty("captureBufferFrames", static_cast<juce::int64>(buffered));
    status.setProperty("captureBufferCapacity", static_cast<juce::int64>(capacityFrames));
    status.setProperty("captureTargetFrames", static_cast<int>(inputSampleRate.load(std::memory_order_relaxed) * targetBufferSeconds));
    status.setProperty("captureBufferMinFrames", static_cast<juce::int64>(
        minimumFrames == std::numeric_limits<uint64_t>::max() ? 0 : minimumFrames));
    status.setProperty("captureBufferMaxFrames", static_cast<juce::int64>(maximumFrames));
    status.setProperty("captureBufferP50", static_cast<juce::int64>(percentileFrames(0.50)));
    status.setProperty("captureBufferP95", static_cast<juce::int64>(percentileFrames(0.95)));
    status.setProperty("captureBufferP99", static_cast<juce::int64>(percentileFrames(0.99)));
    status.setProperty("primingCount", static_cast<juce::int64>(primingCount.load(std::memory_order_relaxed)));
    status.setProperty("hardRecoveryCount", static_cast<juce::int64>(hardRecoveryCount.load(std::memory_order_relaxed)));
    status.setProperty("captureRestartCount", static_cast<juce::int64>(captureRestartCount.load(std::memory_order_relaxed)));
    status.setProperty("captureUnderruns", static_cast<juce::int64>(underruns.load(std::memory_order_relaxed)));
    status.setProperty("underrunCount", static_cast<juce::int64>(underruns.load(std::memory_order_relaxed)));
    status.setProperty("captureOverruns", static_cast<juce::int64>(droppedFrames.load(std::memory_order_relaxed)));
    status.setProperty("captureDiscontinuities", static_cast<juce::int64>(underruns.load(std::memory_order_relaxed)));
    status.setProperty("captureZeroDataPackets", static_cast<juce::int64>(zeroPackets.load(std::memory_order_relaxed)));
    status.setProperty("captureZeroDataFrames", static_cast<juce::int64>(zeroFrames.load(std::memory_order_relaxed)));
    status.setProperty("captureTransport", binaryInput.load(std::memory_order_relaxed)
        ? "binary-named-pipe" : "legacy-text-base64");
}

