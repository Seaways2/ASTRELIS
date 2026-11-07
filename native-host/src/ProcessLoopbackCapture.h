#pragma once

#if defined(_WIN32)

#include <juce_audio_basics/juce_audio_basics.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <wrl.h>
#include <atomic>
#include <array>
#include <thread>

// Captures only the audio rendered by one Windows process tree. The capture
// side and JUCE device callback are decoupled by a lock-free stereo FIFO.
class ProcessLoopbackCapture final
    : public Microsoft::WRL::RuntimeClass<Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>,
                                          Microsoft::WRL::FtmBase,
                                          IActivateAudioInterfaceCompletionHandler>
{
public:
    ProcessLoopbackCapture();
    ~ProcessLoopbackCapture() override;

    HRESULT start(DWORD processId, double requestedSampleRate);
    void stop();
    int read(float* left, float* right, int frames) noexcept;
    int discardBufferedFrames(int maximumFrames) noexcept;
    bool isRunning() const noexcept { return running.load(); }
    float recentPeak() const noexcept { return peak.load(); }
    uint64_t capturedFrameCount() const noexcept { return capturedFrames.load(); }
    uint64_t capturedPacketCount() const noexcept { return capturedPackets.load(); }
    double capturedFramesPerSecond() const noexcept;
    double captureRateRatio() const noexcept;
    double maximumPacketGapMs() const noexcept
    {
        return static_cast<double>(maxPacketGap100ns.load(std::memory_order_relaxed)) / 10000.0;
    }
    uint64_t underrunCount() const noexcept { return underruns.load(); }
    uint64_t overrunCount() const noexcept { return overruns.load(); }
    uint64_t discontinuityCount() const noexcept { return discontinuities.load(); }
    uint64_t silentPacketCount() const noexcept { return silentPackets.load(); }
    uint64_t silentFrameCount() const noexcept { return silentFrames.load(); }
    uint64_t zeroDataPacketCount() const noexcept { return zeroDataPackets.load(); }
    uint64_t zeroDataFrameCount() const noexcept { return zeroDataFrames.load(); }
    float recentRawRms() const noexcept { return rawRms.load(); }
    int bufferedFrameCount() const noexcept { return fifo.getNumReady(); }
    int bufferCapacity() const noexcept { return fifo.getTotalSize(); }
    int targetBufferLevel() const noexcept { return targetBufferedFrames.load(); }
    int minimumBufferLevel() const noexcept { return minimumBufferedFrames; }
    int maximumBufferLevel() const noexcept { return maximumBufferedFrames; }
    bool isRecovering() const noexcept { return recovering.load(); }
    double driftCorrectionPpm() const noexcept { return driftPpm.load(); }
    double sourceSampleRate() const noexcept { return static_cast<double>(format.nSamplesPerSec); }
    DWORD targetProcessId() const noexcept { return targetPid.load(); }
    HRESULT lastResult() const noexcept { return activationResult.load(); }

    STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation* operation) override;

private:
    void captureLoop();
    void resetState(double requestedSampleRate);
    void recordPacketTiming(uint64_t qpcPosition100ns, uint32_t frames) noexcept;
    HRESULT initialiseClient();
    void push(const float* interleaved, int frames) noexcept;
    int readRaw(float* left, float* right, int frames) noexcept;
    void raiseTargetBuffer(int additionalFrames) noexcept;
    void renderConcealment(float* left, float* right, int frames) noexcept;
    void applyRecoveryFade(float* left, float* right, int frames) noexcept;

    Microsoft::WRL::ComPtr<IAudioClient> audioClient;
    Microsoft::WRL::ComPtr<IAudioCaptureClient> captureClient;
    HANDLE activationEvent = nullptr;
    HANDLE sampleEvent = nullptr;
    HANDLE stopEvent = nullptr;
    std::thread captureThread;
    WAVEFORMATEX format{};
    juce::AudioBuffer<float> fifoBuffer{ 2, 44100 * 4 };
    juce::AbstractFifo fifo{ 44100 * 4 };
    std::atomic<bool> running{ false };
    std::atomic<float> peak{ 0.0f };
    std::atomic<uint64_t> capturedFrames{ 0 };
    std::atomic<uint64_t> capturedPackets{ 0 };
    std::atomic<uint64_t> timedFrames{ 0 };
    std::atomic<uint64_t> firstPacketQpc100ns{ 0 };
    std::atomic<uint64_t> lastPacketQpc100ns{ 0 };
    std::atomic<uint64_t> maxPacketGap100ns{ 0 };
    std::atomic<uint64_t> underruns{ 0 };
    std::atomic<uint64_t> overruns{ 0 };
    std::atomic<uint64_t> discontinuities{ 0 };
    std::atomic<uint64_t> silentPackets{ 0 };
    std::atomic<uint64_t> silentFrames{ 0 };
    std::atomic<uint64_t> zeroDataPackets{ 0 };
    std::atomic<uint64_t> zeroDataFrames{ 0 };
    std::atomic<float> rawRms{ 0.0f };
    std::atomic<double> driftPpm{ 0.0 };
    std::atomic<DWORD> targetPid{ 0 };
    std::atomic<HRESULT> activationResult{ E_PENDING };
    std::atomic<bool> recovering{ true };
    bool primed = false;
    std::atomic<int> targetBufferedFrames{ 4410 };
    int minimumBufferedFrames = 4410;
    int maximumBufferedFrames = 13230;
    static constexpr size_t stagingCapacity = 32768;
    std::array<float, stagingCapacity> rawLeft{};
    std::array<float, stagingCapacity> rawRight{};
    juce::LagrangeInterpolator leftInterpolator;
    juce::LagrangeInterpolator rightInterpolator;
    int stagedFrames = 0;
    double driftRatio = 1.0;
    double driftIntegral = 0.0;
    uint64_t stableRenderedFrames = 0;
    float lastOutputLeft = 0.0f;
    float lastOutputRight = 0.0f;
    int fadeInRemaining = 0;
    int fadeInTotal = 0;
};

#endif
