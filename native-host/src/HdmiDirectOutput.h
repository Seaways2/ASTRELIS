#pragma once
#include <juce_core/juce_core.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include <atomic>
#include <array>
#include <future>
#include <thread>

// Dedicated byte transport. Never route encoded frames through JUCE's float DSP graph.
class HdmiDirectOutput {
public:
    ~HdmiDirectOutput();
    static juce::var probe(const juce::String& endpoint);
    juce::String open(const juce::var& specification, const juce::String& endpoint);
    void close();
    void play() { requestedPlaying = true; }
    void pause() { requestedPlaying = false; }
    void seek(double seconds);
    bool setAnalysisFile(const juce::String& path);
    juce::var status(const juce::String& token, bool analysis = true) const;
    static int selfTest();
private:
    void run(juce::var specification, juce::String endpoint, std::promise<juce::String> initialised);
    std::thread worker;
    std::atomic<bool> quit { false }, requestedPlaying { false }, playing { false };
    std::atomic<double> position { 0 }, pendingSeek { -1 };
    mutable juce::CriticalSection lock;
    juce::String error, codec, device;
    std::unique_ptr<juce::AudioFormatReader> analysisReader;
    double duration = 0;
    int rate = 0, channels = 0, bits = 0, validBits = 0, bufferFrames = 0, encodedChannels = 0;
    std::array<std::atomic<float>, 512> left {}, right {};
};
