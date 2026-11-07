#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_audio_utils/juce_audio_utils.h>
#include <array>
#include <atomic>
#include <limits>
#include <vector>

enum class AuralisAudioSourceKind { file, browserPcm };

class IAuralisAudioSource
{
public:
    virtual ~IAuralisAudioSource() = default;
    virtual AuralisAudioSourceKind kind() const noexcept = 0;
    virtual bool start(juce::String& error) = 0;
    virtual void stop() = 0;
    virtual bool prepare(double outputSampleRate, int maximumBlockSize, juce::String& error) = 0;
    virtual void release() = 0;
    virtual int render(juce::AudioBuffer<float>& destination) noexcept = 0;
    virtual bool isActive() const noexcept = 0;
    virtual void appendStatus(juce::DynamicObject& status) const = 0;
};

class FileAudioSource final : public IAuralisAudioSource
{
public:
    FileAudioSource(juce::AudioTransportSource& source, double nativeSampleRate);
    AuralisAudioSourceKind kind() const noexcept override { return AuralisAudioSourceKind::file; }
    bool start(juce::String& error) override;
    void stop() override;
    bool prepare(double outputSampleRate, int maximumBlockSize, juce::String& error) override;
    void release() override;
    int render(juce::AudioBuffer<float>& destination) noexcept override;
    bool isActive() const noexcept override;
    void appendStatus(juce::DynamicObject& status) const override;

private:
    juce::AudioTransportSource& transport;
    double sourceSampleRate = 0.0;
    double engineSampleRate = 0.0;
    int engineBlockSize = 0;
};

class BrowserPcmAudioSource final : public IAuralisAudioSource
{
public:
    BrowserPcmAudioSource();
    AuralisAudioSourceKind kind() const noexcept override { return AuralisAudioSourceKind::browserPcm; }
    bool start(juce::String& error) override;
    void stop() override;
    bool prepare(double outputSampleRate, int maximumBlockSize, juce::String& error) override;
    void release() override;
    int render(juce::AudioBuffer<float>& destination) noexcept override;
    bool isActive() const noexcept override;
    void appendStatus(juce::DynamicObject& status) const override;
    int pushInterleaved(const float* samples, int frames, int channels, double sampleRate) noexcept;
    void resetForNewSession(bool binaryTransport) noexcept;

private:
    static constexpr uint64_t capacityFrames = 1u << 20;
    std::vector<float> leftRing;
    std::vector<float> rightRing;
    std::atomic<uint64_t> writePosition { 0 };
    std::atomic<uint64_t> readPosition { 0 };
    std::atomic<uint64_t> sessionStartReadPosition { 0 };
    std::atomic<uint64_t> captureRestartCount { 0 };
    std::atomic<uint64_t> receivedFrames { 0 };
    std::atomic<uint64_t> receivedPackets { 0 };
    std::atomic<uint64_t> droppedFrames { 0 };
    std::atomic<uint64_t> zeroPackets { 0 };
    std::atomic<uint64_t> zeroFrames { 0 };
    std::atomic<uint64_t> underruns { 0 };
    std::atomic<uint64_t> primingCount { 0 };
    std::atomic<uint64_t> hardRecoveryCount { 0 };
    std::atomic<uint64_t> captureBufferMinFrames { std::numeric_limits<uint64_t>::max() };
    std::atomic<uint64_t> captureBufferMaxFrames { 0 };
    static constexpr uint64_t captureHistogramBucketFrames = 8192;
    static constexpr size_t captureHistogramBucketCount = capacityFrames / captureHistogramBucketFrames;
    std::array<std::atomic<uint64_t>, captureHistogramBucketCount> captureBufferHistogram {};
    std::atomic<double> inputSampleRate { 0.0 };
    std::atomic<float> inputPeak { 0.0f };
    double outputRate = 44100.0;
    double fractionalRead = 0.0;
    int outputBlockSize = 512;
    bool primed = false;
    double targetBufferSeconds = 0.22;
    double driftRatio = 1.0;
    float recoveryGain = 0.0f;
    float lastOutputLeft = 0.0f;
    float lastOutputRight = 0.0f;
    std::atomic<bool> running { false };
    std::atomic<bool> binaryInput { false };
};

