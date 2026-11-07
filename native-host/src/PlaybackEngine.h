#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_utils/juce_audio_utils.h>
#include <array>
#include <atomic>
#include <unordered_map>
#include "AuralisAudioSource.h"
#include "BrowserPcmPipeServer.h"
#include "HdmiDirectOutput.h"

class EnginePluginWindow;

struct HostedPlugin
{
    juce::String id;
    std::unique_ptr<juce::AudioPluginInstance> instance;
};

struct OutputDeviceIntent
{
    juce::String backend;
    juce::String juceTypeName;
    juce::String juceDeviceName;
    juce::String platformEndpointId;
    juce::String sampleRateMode { "system" };
    double fixedSampleRate = 0.0;
    juce::String bufferMode { "auto" };
    int fixedBufferSize = 0;
    juce::String exclusiveFallback { "shared-low-latency" };
    juce::int64 generation = 0;
};

class PlaybackEngine final : private juce::AudioIODeviceCallback,
                             private juce::Timer
{
public:
    PlaybackEngine();
    ~PlaybackEngine() override;
    juce::var handleCommand(const juce::var& command);
    bool handleStreamCommand(const juce::var& command);
    bool isReady() const noexcept { return ready; }
    static int runLifecycleSelfTest();

private:
    explicit PlaybackEngine(bool initialiseDevice);
    void stopActiveSource();
    void audioDeviceIOCallbackWithContext(const float* const*, int, float* const*, int, int,
                                          const juce::AudioIODeviceCallbackContext&) override;
    void audioDeviceAboutToStart(juce::AudioIODevice*) override;
    void audioDeviceStopped() override;
    void timerCallback() override;
    juce::var loadFile(const juce::String& filePath, const juce::String& playbackToken);
    juce::var loadRack(const juce::Array<juce::var>& rack, const juce::String& stateDirectory);
    juce::var savePluginStates(const juce::String& stateDirectory = {});
    juce::File stateFileFor(const juce::String& pluginId) const;
    bool restorePluginState(juce::AudioPluginInstance& plugin, const juce::String& pluginId);
    juce::var startBrowserPcm(const juce::String& transportName);
    juce::var pipeInformation() const;
    juce::var enumerateOutputDevices();
    juce::var outputDeviceCapabilities(const juce::DynamicObject& command);
    juce::var outputDeviceStatus();
    juce::var applyOutputDeviceTransaction(const juce::DynamicObject& command);
    bool handlePipePacket(const AuralisPcmProtocol::PacketMetadata& packet, const float* samples);
    juce::var makeStatus(bool ok, const juce::String& error = {}, bool analysis = true) const;
    std::atomic<bool> analysisRequested { true };

    juce::AudioDeviceManager deviceManager;
    std::unique_ptr<HdmiDirectOutput> directOutput;
    juce::AudioFormatManager audioFormats;
    juce::AudioPluginFormatManager pluginFormats;
    // 512 KiB stereo read-ahead target; JUCE raises this only if two device
    // blocks need more space (plus its small resampler buffer).
    // Declared before transport so it outlives every buffering client.
    static constexpr int fileReadAheadSamples = 65536;
    juce::TimeSliceThread fileReadAheadThread { "Auralis file read-ahead" };
    juce::AudioTransportSource transport;
    std::unique_ptr<juce::AudioFormatReaderSource> readerSource;
    std::unique_ptr<IAuralisAudioSource> activeSource;
    std::vector<HostedPlugin> plugins;
    std::vector<std::unique_ptr<EnginePluginWindow>> editorWindows;
    // Some commercial plugins dispatch UI callbacks after their editor has
    // closed. Keep replaced instances/modules alive until engine shutdown.
    std::vector<HostedPlugin> retiredPlugins;
    std::vector<std::unique_ptr<EnginePluginWindow>> retiredEditorWindows;
    juce::String pluginStateDirectory;
    std::unordered_map<std::string, std::string> pluginStateHashes;
    juce::CriticalSection processLock;
    double sampleRate = 44100.0;
    int blockSize = 512;
    std::atomic<float> volume { 0.72f };
    std::atomic<float> routeGainCurrent { 1.0f };
    std::atomic<float> routeGainTarget { 1.0f };
    std::atomic<float> userFadeCurrent { 1.0f };
    std::atomic<float> userFadeTarget { 1.0f };
    std::atomic<int> userFadeMs { 350 };
    std::atomic<uint64_t> pauseAfterFadeAtUs { 0 };
    uint64_t lastPluginStateSaveUs = 0;
    juce::AudioDeviceManager::AudioDeviceSetup lastKnownGoodSetup;
    juce::String lastKnownGoodType;
    OutputDeviceIntent lastKnownGoodIntent;
    bool hasLastKnownGood = false;
    juce::String lastGraphPrepareError;
    juce::String lastSourceRateDecision { "not-evaluated" };
    double lastSourceRate = 0.0;
    bool ready = false;
    bool onlineMode = false;
    juce::String localPlaybackToken;
    static constexpr size_t analysisCapacity = 1024;
    std::array<std::atomic<float>, analysisCapacity> analysisLeft {};
    std::array<std::atomic<float>, analysisCapacity> analysisRight {};
    std::atomic<uint64_t> analysisWritePosition { 0 };
    std::atomic<uint64_t> callbackCount { 0 };
    std::atomic<uint64_t> callbackMaxGapUs { 0 };
    std::atomic<uint64_t> lastCallbackTimestampUs { 0 };
    std::atomic<uint64_t> lastMediaSessionId { 0 };
    std::atomic<uint64_t> lastSequence { 0 };
    std::atomic<uint64_t> sequenceGapCount { 0 };
    std::atomic<uint64_t> maxPacketArrivalGapUs { 0 };
    std::atomic<uint64_t> lastPacketArrivalUs { 0 };
    std::atomic<uint64_t> base64DecodeTimeAggregateUs { 0 };
    std::atomic<uint64_t> pcmPacketsAccepted { 0 };
    std::atomic<uint64_t> pcmPacketsRejected { 0 };
    std::unique_ptr<BrowserPcmPipeServer> browserPcmPipeServer;
    std::atomic<uint64_t> nativePipePackets { 0 };
    std::atomic<uint64_t> nativePipeSequenceGaps { 0 };
    std::atomic<uint64_t> nativePipeSessionDrops { 0 };
    std::atomic<uint64_t> nativePipeDiscontinuities { 0 };
    std::atomic<int> pluginLatencySamples { 0 };
};
