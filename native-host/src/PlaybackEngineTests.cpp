#include "PlaybackEngine.h"
#include <chrono>
#include <iostream>
#include <stdexcept>
#include <thread>

namespace {
using Clock = std::chrono::steady_clock;

void require(bool condition, const char* message)
{
    if (!condition) throw std::runtime_error(message);
}

template <typename Predicate>
bool waitUntil(Predicate&& predicate, int timeoutMs = 1000)
{
    const auto end = Clock::now() + std::chrono::milliseconds(timeoutMs);
    do {
        if (predicate()) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    } while (Clock::now() < end);
    return predicate();
}

struct FixtureDirectory {
    juce::File directory = juce::File::getSpecialLocation(juce::File::tempDirectory)
        .getNonexistentChildFile("auralis-lifecycle-self-test", "", false);
    FixtureDirectory() { require(directory.createDirectory().wasOk(), "Cannot create test fixture directory"); }
    ~FixtureDirectory() { directory.deleteRecursively(); }
};

void writeAudioFixture(const juce::File& target, juce::AudioFormat& format)
{
    auto stream = target.createOutputStream();
    require(stream != nullptr, "Cannot create audio fixture");
    std::unique_ptr<juce::AudioFormatWriter> writer(format.createWriterFor(stream.get(), 48000.0, 2, 24, {}, 0));
    require(writer != nullptr, "Cannot create fixture audio writer");
    stream.release();
    juce::AudioBuffer<float> samples(2, 48000 * 4);
    for (int channel = 0; channel < 2; ++channel)
        for (int i = 0; i < samples.getNumSamples(); ++i)
            samples.setSample(channel, i, i < 48000 * 2 ? 0.25f : -0.5f);
    require(writer->writeFromAudioSampleBuffer(samples, 0, samples.getNumSamples()), "Cannot write audio fixture");
}

class SnapshotTestPlugin final : public juce::AudioPluginInstance {
public:
    explicit SnapshotTestPlugin(std::atomic<bool>& captured) : snapshotCaptured(captured) {}
    const juce::String getName() const override { return "Lifecycle snapshot test"; }
    void fillInPluginDescription(juce::PluginDescription& description) const override { description.name = getName(); }
    void prepareToPlay(double, int) override {}
    void releaseResources() override {}
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override {}
    double getTailLengthSeconds() const override { return 0; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    juce::AudioProcessorEditor* createEditor() override { return nullptr; }
    bool hasEditor() const override { return false; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}
    void getStateInformation(juce::MemoryBlock& state) override {
        // Large but below the supported 64 MiB limit. Snapshot capture remains
        // on the calling message thread; subsequent hash/IO must allow audio.
        state.setSize(48u * 1024u * 1024u, true);
        snapshotCaptured.store(true, std::memory_order_release);
    }
    void setStateInformation(const void*, int) override {}
private:
    std::atomic<bool>& snapshotCaptured;
};
}

int PlaybackEngine::runLifecycleSelfTest()
{
    try {
        FixtureDirectory fixtures;
        const auto wav = fixtures.directory.getChildFile("sections.wav");
        const auto flac = fixtures.directory.getChildFile("sections.flac");
        juce::WavAudioFormat wavFormat;
        juce::FlacAudioFormat flacFormat;
        writeAudioFixture(wav, wavFormat);
        writeAudioFixture(flac, flacFormat);
        std::atomic<float> lastSample { 0 };
        std::atomic<bool> snapshotCaptured { false };
        std::atomic<int> postSnapshotCallbacks { 0 };
        auto engine = std::unique_ptr<PlaybackEngine>(new PlaybackEngine(false));
        engine->sampleRate = 48000;
        engine->blockSize = 128;
        engine->userFadeMs.store(0);
        engine->volume.store(1);
        // std::jthread joins before engine destruction, including exceptions.
        std::jthread audio([&](std::stop_token stop) {
            juce::AudioBuffer<float> output(2, 128);
            while (!stop.stop_requested()) {
                engine->audioDeviceIOCallbackWithContext(nullptr, 0, output.getArrayOfWritePointers(), 2, 128, {});
                lastSample.store(output.getSample(0, 127), std::memory_order_relaxed);
                if (snapshotCaptured.load(std::memory_order_acquire)) ++postSnapshotCallbacks;
                std::this_thread::sleep_for(std::chrono::milliseconds(2));
            }
        });
        const auto command = [&](const char* type, double value = 0) {
            auto object = std::make_unique<juce::DynamicObject>();
            object->setProperty("type", type);
            object->setProperty("position", value);
            return engine->handleCommand(juce::var(object.release()));
        };
        {
            auto request = std::make_unique<juce::DynamicObject>();
            request->setProperty("type", "status"); request->setProperty("analysis", false);
            const auto light = engine->handleCommand(juce::var(request.release()));
            require(light.hasProperty("position") && !light.hasProperty("nativeFrequency"), "Light status lost transport or computed FFT");
            require(command("status").hasProperty("nativeFrequency"), "Analysis did not resume");
        }
        const auto assertStoppedQuickly = [&](auto&& stop, const char* message) {
            const auto start = Clock::now();
            stop();
            const auto ms = std::chrono::duration<double, std::milli>(Clock::now() - start).count();
            require(ms < 700, message); // Old JUCE acknowledgement timeout is ~1000 ms.
            require(!engine->transport.isPlaying(), "Transport remained playing after stop");
            require(waitUntil([&] { return lastSample.load() == 0; }), "Stopped file leaked an unprocessed tail");
            return ms;
        };

        for (const auto& file : { wav, flac }) {
            require(static_cast<bool>(engine->loadFile(file.getFullPathName(), "fixture").getProperty("ok", false)), "Fixture load failed");
            require(engine->fileReadAheadThread.isThreadRunning(), "File read-ahead worker is not running");
            require(engine->fileReadAheadThread.getNumClients() == 1, "Expected one bounded read-ahead client");
            command("play");
            require(waitUntil([&] { return lastSample.load() > 0.2f; }), "File did not produce expected first section");
            const auto pauseMs = assertStoppedQuickly([&] { command("pause"); }, "Pause waited for JUCE stop timeout");
            for (const auto position : { 2.5, 0.2, 2.5 }) {
                command("seek", position);
                command("play");
                require(waitUntil([&] { return position > 2 ? lastSample.load() < -0.4f : lastSample.load() > 0.2f; }),
                        "Seek returned stale or missing read-ahead content");
                assertStoppedQuickly([&] { command("pause"); }, "Seek/pause waited for JUCE stop timeout");
            }
            command("seek", 0);
            command("play");
            require(waitUntil([&] { return lastSample.load() > 0.2f; }), "Fade test did not begin playback");
            engine->userFadeMs.store(20);
            command("pause");
            std::this_thread::sleep_for(std::chrono::milliseconds(30));
            const auto fadeStopMs = assertStoppedQuickly([&] { engine->timerCallback(); }, "Fade stop held the audio callback lock");
            engine->userFadeMs.store(0);
            command("seek", 3.99);
            command("play");
            require(waitUntil([&] { return !engine->transport.isPlaying(); }), "Natural EOF no longer completed");
            std::cout << file.getFileExtension() << " pauseMs=" << pauseMs << " fadeStopMs=" << fadeStopMs << " seek/EOF=PASS\n";
        }

        // Replacing an actively playing file exercises the production lock
        // ordering, rather than merely testing AudioTransportSource in isolation.
        engine->loadFile(wav.getFullPathName(), "before-replace");
        command("play");
        require(waitUntil([&] { return lastSample.load() > 0.2f; }), "Replacement test did not begin playback");
        const auto replaceStart = Clock::now();
        const auto replaced = engine->loadFile(flac.getFullPathName(), "after-replace");
        require(static_cast<bool>(replaced.getProperty("ok", false)), "Active file replacement failed");
        const auto replaceMs = std::chrono::duration<double, std::milli>(Clock::now() - replaceStart).count();
        require(replaceMs < 700, "Active file replacement waited for JUCE stop timeout");
        require(engine->fileReadAheadThread.getNumClients() == 1, "Replacement retained an old buffering client");

        {
            const juce::ScopedLock lock(engine->processLock);
            engine->plugins.push_back({ "snapshot-test", std::make_unique<SnapshotTestPlugin>(snapshotCaptured) });
        }
        command("play");
        const auto saved = engine->savePluginStates(fixtures.directory.getFullPathName());
        const auto concurrentCallbacks = postSnapshotCallbacks.load();
        require(static_cast<int>(saved.getProperty("saved", 0)) == 1, "Plugin state snapshot was not saved");
        require(concurrentCallbacks >= 3, "State hash/IO still blocked audio callbacks after snapshot capture");
        const auto unchanged = engine->savePluginStates();
        require(static_cast<int>(unchanged.getProperty("unchanged", 0)) == 1, "Unchanged plugin state was rewritten");
        {
            const juce::ScopedLock lock(engine->processLock);
            engine->plugins.clear();
        }
        engine->pluginStateDirectory.clear();
        audio.request_stop();
        audio.join();
        const auto shutdownStart = Clock::now();
        // Deliberately close while transport still considers itself playing:
        // there is no device callback left to acknowledge stop during shutdown.
        engine.reset();
        const auto shutdownMs = std::chrono::duration<double, std::milli>(Clock::now() - shutdownStart).count();
        require(shutdownMs < 700, "Offline shutdown waited for a removed audio callback");
        std::cout << "replaceMs=" << replaceMs << " shutdownMs=" << shutdownMs
                  << " concurrentStateCallbacks=" << concurrentCallbacks << "\n";
        std::cout << "Native file playback lifecycle, bounded read-ahead, and state snapshot IO: PASS\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "Native lifecycle self-test: FAIL: " << error.what() << "\n";
        return 1;
    }
}
