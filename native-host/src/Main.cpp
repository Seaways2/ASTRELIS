#include "PluginWindowStyle.h"
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_utils/juce_audio_utils.h>
#include <iostream>
#include <thread>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include "PlaybackEngine.h"
#include "AuralisVersion.h"
#include "AudioSessionProbe.h"
#include "DryPathIsolationProbe.h"
#include "ProcessPowerThrottlingProbe.h"
#include "ProcessLoopbackProbe.h"
#include "PluginFormatAdapter.h"
#include "PluginCompatibilityPolicy.h"
#if JUCE_WINDOWS
#include <windows.h>
#include <io.h>
#else
#include <unistd.h>
#endif

namespace {
constexpr int scannerProtocolVersion = 2;
constexpr const char* scannerProtocolName = "auralis-plugin-scan";

class ScannerProtocolWriter final
{
public:
    explicit ScannerProtocolWriter(const juce::String& path)
        : modulePath(path), startedAt(juce::Time::getMillisecondCounterHiRes())
    {
        std::fflush(stdout);
#if JUCE_WINDOWS
        const auto process = GetCurrentProcess();
        const auto original = GetStdHandle(STD_OUTPUT_HANDLE);
        if (original != nullptr && original != INVALID_HANDLE_VALUE)
            DuplicateHandle(process, original, process, &protocolHandle, 0, FALSE, DUPLICATE_SAME_ACCESS);
        const auto diagnosticsHandle = GetStdHandle(STD_ERROR_HANDLE);
        SetStdHandle(STD_OUTPUT_HANDLE, diagnosticsHandle);
        _dup2(_fileno(stderr), _fileno(stdout));
#else
        protocolFd = dup(STDOUT_FILENO);
        dup2(STDERR_FILENO, STDOUT_FILENO);
#endif
    }

    ~ScannerProtocolWriter()
    {
#if JUCE_WINDOWS
        if (protocolHandle != nullptr && protocolHandle != INVALID_HANDLE_VALUE) CloseHandle(protocolHandle);
#else
        if (protocolFd >= 0) close(protocolFd);
#endif
    }

    double elapsedMs() const { return juce::Time::getMillisecondCounterHiRes() - startedAt; }
    const juce::String& getLastStage() const { return lastStage; }

    void hello() { writeFrame("hello", nullptr); }

    void progress(const juce::String& stage, const juce::String& pluginId = {})
    {
        lastStage = stage;
        auto extra = std::make_unique<juce::DynamicObject>();
        extra->setProperty("stage", stage);
        if (pluginId.isNotEmpty()) extra->setProperty("pluginId", pluginId);
        writeFrame("progress", extra.get());
        if (juce::SystemStats::getEnvironmentVariable("AURALIS_SCANNER_TEST_HANG_STAGE", {}) == stage)
            juce::Thread::sleep(120000);
        if (juce::SystemStats::getEnvironmentVariable("AURALIS_SCANNER_TEST_CRASH_STAGE", {}) == stage)
            std::abort();
    }

    void result(const juce::Array<juce::var>& plugins, const juce::Array<juce::var>& failures)
    {
        auto extra = std::make_unique<juce::DynamicObject>();
        extra->setProperty("plugins", juce::var(plugins));
        extra->setProperty("failures", juce::var(failures));
        extra->setProperty("lastStage", lastStage);
        writeFrame("result", extra.get());
    }

private:
    void writeFrame(const juce::String& type, const juce::DynamicObject* extra)
    {
        auto object = std::make_unique<juce::DynamicObject>();
        object->setProperty("protocol", scannerProtocolName);
        object->setProperty("version", scannerProtocolVersion);
        object->setProperty("type", type);
        object->setProperty("modulePath", modulePath);
        object->setProperty("elapsedMs", elapsedMs());
        if (extra != nullptr)
            for (const auto& property : extra->getProperties())
                object->setProperty(property.name, property.value);
        const auto line = juce::JSON::toString(juce::var(object.release()), true) + "\n";
        const auto utf8 = line.toRawUTF8();
        const auto bytes = static_cast<int>(std::strlen(utf8));
#if JUCE_WINDOWS
        if (protocolHandle != nullptr && protocolHandle != INVALID_HANDLE_VALUE)
        {
            DWORD written = 0;
            WriteFile(protocolHandle, utf8, static_cast<DWORD>(bytes), &written, nullptr);
        }
#else
        if (protocolFd >= 0) ::write(protocolFd, utf8, static_cast<size_t>(bytes));
#endif
    }

    juce::String modulePath;
    juce::String lastStage { "MODULE_LOAD" };
    double startedAt = 0.0;
#if JUCE_WINDOWS
    HANDLE protocolHandle = INVALID_HANDLE_VALUE;
#else
    int protocolFd = -1;
#endif
};

juce::var scannerFailure(const juce::String& code, const juce::String& stage,
                         const juce::String& modulePath, const juce::String& message,
                         double elapsedMs, const juce::String& pluginId = {})
{
    auto object = std::make_unique<juce::DynamicObject>();
    object->setProperty("code", code);
    object->setProperty("stage", stage);
    object->setProperty("modulePath", modulePath);
    object->setProperty("message", message);
    object->setProperty("elapsedMs", elapsedMs);
    if (pluginId.isNotEmpty()) object->setProperty("pluginId", pluginId);
    return juce::var(object.release());
}

bool looksLikeArchitectureMismatch(const juce::String& message)
{
    const auto lower = message.toLowerCase();
    return lower.contains("architecture") || lower.contains("not a valid win32")
        || lower.contains("bad exe") || lower.contains("wrong format") || lower.contains("193");
}

class PluginEditorWindow final : public juce::DocumentWindow
{
public:
    PluginEditorWindow(std::unique_ptr<juce::AudioPluginInstance> instance, std::uintptr_t ownerHandle)
        : DocumentWindow(instance->getName(), juce::Colour(0xff090e11), DocumentWindow::minimiseButton | DocumentWindow::closeButton, false), plugin(std::move(instance))
    {
        setLookAndFeel(&hostLookAndFeel);
        plugin->prepareToPlay(44100.0, 512);
        if (auto* editor = plugin->createEditorIfNeeded())
        {
            setContentNonOwned(editor, true);
            setResizable(editor->isResizable(), false);
        }
        else
        {
            setSize(480, 180);
            setContentOwned(new juce::Label("noEditor", "该插件没有提供原生编辑器界面"), true);
        }
        centreWithSize(getWidth(), getHeight());
        setUsingNativeTitleBar(false);
        setTitleBarHeight(36); configurePluginPin(*this);
        setColour(juce::DocumentWindow::textColourId, juce::Colour(0xffdbe5e8));
        setColour(juce::DocumentWindow::backgroundColourId, juce::Colour(0xff080d10));
        addToDesktop(getDesktopWindowStyleFlags());
#if JUCE_WINDOWS
        if (auto* peer = getPeer()) {
            auto hwnd = static_cast<HWND>(peer->getNativeHandle());
            auto style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, (style | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW);
            if (ownerHandle != 0) SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, static_cast<LONG_PTR>(ownerHandle));
            SetWindowPos(hwnd, nullptr, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);
        }
#endif
        setVisible(true);
        toFront(true);
    }

    ~PluginEditorWindow() override
    {
        clearContentComponent();
        plugin->releaseResources();
        setLookAndFeel(nullptr);
    }

    void closeButtonPressed() override
    {
        setVisible(false);
        juce::MessageManager::getInstance()->stopDispatchLoop();
    }

    void minimiseButtonPressed() override
    {
        setAlwaysOnTop(!isAlwaysOnTop());
    }

    int getDesktopWindowStyleFlags() const override
    {
        return (juce::DocumentWindow::getDesktopWindowStyleFlags() | juce::ComponentPeer::windowIsTemporary)
            & ~juce::ComponentPeer::windowAppearsOnTaskbar;
    }

private:
    PluginWindowLookAndFeel hostLookAndFeel;
    std::unique_ptr<juce::AudioPluginInstance> plugin;
};

int openPluginEditor(const juce::String& pluginPath, const juce::String& pluginIdentifier, std::uintptr_t ownerHandle)
{
    juce::AudioPluginFormatManager formats;
    formats.addDefaultFormats();
    juce::OwnedArray<juce::PluginDescription> descriptions;
    for (auto* format : formats.getFormats())
        if (format->fileMightContainThisPluginType(pluginPath))
            format->findAllTypesForFile(descriptions, pluginPath);

    if (descriptions.isEmpty())
        return 2;

    const juce::PluginDescription* selected = pluginIdentifier.isEmpty() ? descriptions[0] : nullptr;
    if (pluginIdentifier.isNotEmpty())
        for (const auto* description : descriptions)
            if (description->createIdentifierString() == pluginIdentifier)
                selected = description;

    if (selected == nullptr)
        return 4;

    juce::String error;
    auto instance = formats.createPluginInstance(*selected, 44100.0, 512, error);
    if (instance == nullptr)
        return 3;

    PluginEditorWindow window(std::move(instance), ownerHandle);
    juce::MessageManager::getInstance()->runDispatchLoop();
    return 0;
}

int printAudioEngineInfo()
{
    juce::AudioDeviceManager deviceManager;
    const auto error = deviceManager.initialise(0, 2, nullptr, true);
    auto object = std::make_unique<juce::DynamicObject>();
    AuralisVersion::appendTo(*object);
    object->setProperty("ready", error.isEmpty());
    object->setProperty("error", error);
    if (auto* device = deviceManager.getCurrentAudioDevice())
    {
        object->setProperty("device", device->getName());
        object->setProperty("type", device->getTypeName());
        object->setProperty("sampleRate", device->getCurrentSampleRate());
        object->setProperty("bufferSize", device->getCurrentBufferSizeSamples());
        object->setProperty("outputs", device->getActiveOutputChannels().countNumberOfSetBits());
    }
    std::cout << juce::JSON::toString(juce::var(object.release()), true).toStdString() << std::endl;
    return error.isEmpty() ? 0 : 5;
}

int printBuildInfo()
{
    auto object = std::make_unique<juce::DynamicObject>();
    AuralisVersion::appendTo(*object);
    object->setProperty("juceVersion", juce::SystemStats::getJUCEVersion());
    std::cout << juce::JSON::toString(juce::var(object.release()), true).toStdString() << std::endl;
    return 0;
}

int runPlaybackEngine()
{
    PlaybackEngine engine;
    if (!engine.isReady()) return 6;
    std::thread commandThread([&engine] {
        std::string line;
        while (std::getline(std::cin, line))
        {
            const auto command = juce::JSON::parse(juce::String::fromUTF8(line.c_str()));
            // PCM packets are high-frequency one-way stream messages.  Handle
            // them on the stdin worker without emitting protocol responses,
            // otherwise request/response commands would be displaced.
            if (engine.handleStreamCommand(command)) continue;
            juce::WaitableEvent completed;
            juce::var response;
            juce::MessageManager::callAsync([&] {
                const auto* commandObject = command.getDynamicObject();
                const auto requestId = commandObject != nullptr ? commandObject->getProperty("requestId").toString() : juce::String();
                const auto protocolVersion = commandObject != nullptr
                    ? static_cast<int>(commandObject->getProperty("protocolVersion")) : 0;
                if (protocolVersion != AuralisVersion::controlProtocol)
                {
                    auto error = std::make_unique<juce::DynamicObject>();
                    error->setProperty("ok", false);
                    error->setProperty("error", "CONTROL_PROTOCOL_MISMATCH");
                    response = juce::var(error.release());
                }
                else
                {
                    response = engine.handleCommand(command);
                }
                if (auto* responseObject = response.getDynamicObject())
                {
                    AuralisVersion::appendTo(*responseObject);
                    responseObject->setProperty("responseKind", "response");
                    responseObject->setProperty("requestId", requestId);
                }
                completed.signal();
            });
            completed.wait();
            std::cout << juce::JSON::toString(response, true).toStdString() << std::endl;
        }
        juce::MessageManager::callAsync([] { juce::MessageManager::getInstance()->stopDispatchLoop(); });
    });
    juce::MessageManager::getInstance()->runDispatchLoop();
    commandThread.join();
    return 0;
}

juce::var legacyVst2ToJson(const juce::File& file)
{
    auto object = std::make_unique<juce::DynamicObject>();
    object->setProperty("id", file.getFullPathName().toLowerCase());
    object->setProperty("name", file.getFileNameWithoutExtension());
    object->setProperty("path", file.getFullPathName());
    object->setProperty("format", "VST2");
    object->setProperty("manufacturer", "");
    object->setProperty("category", "Legacy plugin");
    object->setProperty("version", "");
    object->setProperty("instrument", false);
    object->setProperty("loadable", false);
    object->setProperty("policyRejectionReason", "FORMAT_NOT_AVAILABLE");
    object->setProperty("error", "VST2 SDK compatibility layer is not installed");
    return juce::var(object.release());
}

juce::var scanDescription(const juce::PluginDescription& description, const juce::String& sourcePath,
                          PluginFormatAdapter& adapter, ScannerProtocolWriter& protocol,
                          juce::Array<juce::var>& failures)
{
    const auto pluginId = description.createIdentifierString();
    auto object = std::make_unique<juce::DynamicObject>();
    object->setProperty("id", pluginId);
    object->setProperty("name", description.name);
    object->setProperty("path", sourcePath);
    object->setProperty("format", description.pluginFormatName);
    object->setProperty("manufacturer", description.manufacturerName);
    object->setProperty("category", description.category);
    object->setProperty("version", description.version);
    object->setProperty("instrument", description.isInstrument);
    object->setProperty("hasARAExtension", description.hasARAExtension);
    object->setProperty("loadable", false);

    protocol.progress("INSTANTIATION", pluginId);
    juce::String error;
    auto instance = adapter.instantiate(description, 48000.0, 512, error);
    if (instance == nullptr)
    {
        const auto code = looksLikeArchitectureMismatch(error) ? "ARCHITECTURE_MISMATCH" : "INSTANTIATION_FAILED";
        const auto message = error.isNotEmpty() ? error : "Plugin instance could not be created";
        const auto scanFailure = scannerFailure(code, "INSTANTIATION", sourcePath, message, protocol.elapsedMs(), pluginId);
        failures.add(scanFailure);
        object->setProperty("scanFailure", scanFailure);
        return juce::var(object.release());
    }

    protocol.progress("BUS_PROBE", pluginId);
    auto compatibility = evaluateAuralisStereoInsert(*instance, description);
    object->setProperty("capabilities", compatibility.capabilities);
    object->setProperty("compatibility", compatibility.decision);
    object->setProperty("loadable", compatibility.eligible);
    if (!compatibility.eligible)
    {
        if (auto* decision = compatibility.decision.getDynamicObject())
            if (auto* reasons = decision->getProperty("reasons").getArray(); reasons != nullptr && !reasons->isEmpty())
                object->setProperty("policyRejectionReason", reasons->getFirst());
        protocol.progress("DESTROY", pluginId);
        instance.reset();
        return juce::var(object.release());
    }

    try
    {
        protocol.progress("PREPARE", pluginId);
        instance->setNonRealtime(true);
        instance->setProcessingPrecision(juce::AudioProcessor::singlePrecision);
        instance->prepareToPlay(48000.0, 512);
        instance->reset();

        protocol.progress("PROCESS_TEST", pluginId);
        juce::AudioBuffer<float> buffer(2, 512);
        juce::MidiBuffer midi;
        for (int block = 0; block < 3; ++block)
        {
            buffer.clear();
            midi.clear();
            instance->processBlock(buffer, midi);
        }

        protocol.progress("RELEASE", pluginId);
        instance->releaseResources();
        object->setProperty("loadable", true);
    }
    catch (const std::exception& exception)
    {
        const auto scanFailure = scannerFailure("PLUGIN_PROBE_FAILED", protocol.getLastStage(), sourcePath,
                                                juce::String::fromUTF8(exception.what()), protocol.elapsedMs(), pluginId);
        failures.add(scanFailure);
        object->setProperty("scanFailure", scanFailure);
    }
    catch (...)
    {
        const auto scanFailure = scannerFailure("PLUGIN_PROBE_FAILED", protocol.getLastStage(), sourcePath,
                                                "Plugin threw an exception during probe", protocol.elapsedMs(), pluginId);
        failures.add(scanFailure);
        object->setProperty("scanFailure", scanFailure);
    }

    protocol.progress("DESTROY", pluginId);
    instance.reset();
    return juce::var(object.release());
}

int scanSingleModule(const juce::String& modulePath)
{
    ScannerProtocolWriter protocol(modulePath);
    protocol.hello();
    protocol.progress("MODULE_LOAD");
    if (juce::SystemStats::getEnvironmentVariable("AURALIS_SCANNER_TEST_STDOUT_NOISE", {}).isNotEmpty())
        std::cout << "third-party plugin diagnostic noise" << std::endl;

    juce::Array<juce::var> plugins;
    juce::Array<juce::var> failures;
    const juce::File candidate(modulePath);
    if (!candidate.exists())
    {
        failures.add(scannerFailure("ENUMERATION_FAILED", "MODULE_LOAD", modulePath,
                                    "Plugin module does not exist", protocol.elapsedMs()));
        protocol.result(plugins, failures);
        return 0;
    }

    protocol.progress("ENUMERATION");
    if (candidate.hasFileExtension("dll"))
    {
        plugins.add(legacyVst2ToJson(candidate));
        protocol.result(plugins, failures);
        return 0;
    }

    juce::AudioPluginFormatManager formats;
    formats.addDefaultFormats();
    auto adapter = createPluginFormatAdapter(candidate, formats);
    juce::OwnedArray<juce::PluginDescription> descriptions;
    try
    {
        juce::String adapterError;
        if (adapter == nullptr)
            adapterError = "No plugin format adapter accepted this module";
        else if (!adapter->scannerAvailable())
            adapterError = adapter->formatName() + " scanner adapter is registered but unavailable";
        else
            adapter->enumerate(candidate, descriptions, adapterError);
        if (descriptions.isEmpty() && adapterError.isNotEmpty())
            failures.add(scannerFailure("ENUMERATION_FAILED", "ENUMERATION", modulePath,
                                        adapterError, protocol.elapsedMs()));
    }
    catch (const std::exception& exception)
    {
        failures.add(scannerFailure("ENUMERATION_FAILED", "ENUMERATION", modulePath,
                                    juce::String::fromUTF8(exception.what()), protocol.elapsedMs()));
    }
    catch (...)
    {
        failures.add(scannerFailure("ENUMERATION_FAILED", "ENUMERATION", modulePath,
                                    "Plugin enumeration threw an exception", protocol.elapsedMs()));
    }

    if (descriptions.isEmpty() && failures.isEmpty())
        failures.add(scannerFailure("ENUMERATION_FAILED", "ENUMERATION", modulePath,
                                    "No plugin descriptors were found in the module", protocol.elapsedMs()));
    if (adapter != nullptr)
        for (const auto* description : descriptions)
            plugins.add(scanDescription(*description, candidate.getFullPathName(), *adapter, protocol, failures));

    protocol.result(plugins, failures);
    return 0;
}
}

int main(int argc, char* argv[])
{
    juce::ScopedJuceInitialiser_GUI juceInitialiser;
    if (argc >= 3 && juce::String(argv[1]) == "--plugin-frame-preview") {
        std::cerr << "preview:start" << std::endl; PluginWindowLookAndFeel style;
        struct PreviewWindow : juce::DocumentWindow { using DocumentWindow::DocumentWindow; void minimiseButtonPressed() override { setAlwaysOnTop(!isAlwaysOnTop()); repaint(); } };
        PreviewWindow window("Gem Comp LA", juce::Colour(0xff111c22), juce::DocumentWindow::minimiseButton | juce::DocumentWindow::closeButton, false);
        window.setLookAndFeel(&style);
        window.setUsingNativeTitleBar(false);
        window.setTitleBarHeight(36);
        window.setSize(720,120);
        configurePluginPin(window); std::cerr << "preview:configured" << std::endl;
        auto* pin = window.getMinimiseButton();
        auto* close = window.getCloseButton();
        const bool aligned = pin && close && pin->getY() == close->getY() && pin->getHeight() == close->getHeight() && pin->getRight() == close->getX();
        window.minimiseButtonPressed();
        std::cerr << "preview:pinned" << std::endl; const bool pinned = window.isAlwaysOnTop();
        window.minimiseButtonPressed();
        const bool unpinned = !window.isAlwaysOnTop();
        std::cerr << "preview:snapshot" << std::endl; auto image = window.createComponentSnapshot(window.getLocalBounds().withHeight(42));
        juce::FileOutputStream stream(juce::File(juce::String::fromUTF8(argv[2])));
        juce::PNGImageFormat png;
        const bool written = stream.openedOk() && png.writeImageToStream(image,stream);
        window.setLookAndFeel(nullptr);
        return aligned && pinned && unpinned && written ? 0 : 1;
    }
    if (argc >= 3 && juce::String(argv[1]) == "--editor")
        return openPluginEditor(juce::String::fromUTF8(argv[2]), argc >= 4 ? juce::String::fromUTF8(argv[3]) : juce::String(),
                                argc >= 5 ? static_cast<std::uintptr_t>(juce::String(argv[4]).getLargeIntValue()) : 0);
    if (argc >= 2 && juce::String(argv[1]) == "--engine-info")
        return printAudioEngineInfo();
    if (argc >= 2 && juce::String(argv[1]) == "--build-info")
        return printBuildInfo();
    if (argc >= 2 && juce::String(argv[1]) == "--playback-lifecycle-self-test")
        return PlaybackEngine::runLifecycleSelfTest();
    if (argc >= 2 && juce::String(argv[1]) == "--hdmi-direct-self-test")
        return HdmiDirectOutput::selfTest();
    if (argc >= 2 && juce::String(argv[1]) == "--audio-session-probe")
        return runAudioSessionProbe(argc >= 3 ? juce::String(argv[2]).getIntValue() : 30,
                                    argc >= 4 ? juce::String(argv[3]).getIntValue() : 500);
    if (argc >= 2 && juce::String(argv[1]) == "--process-power-throttling")
        return runProcessPowerThrottlingCommand(argc, argv);
    if (argc >= 2 && juce::String(argv[1]) == "--process-power-throttling-self-test")
        return runProcessPowerThrottlingSelfTest();
    if (argc >= 3 && juce::String(argv[1]) == "--process-loopback-probe")
        return runProcessLoopbackProbe(static_cast<unsigned int>(juce::String(argv[2]).getLargeIntValue()),
            argc >= 4 ? juce::String::fromUTF8(argv[3]) : juce::String("unclassified"),
            argc >= 5 ? juce::String(argv[4]).getIntValue() : 30,
            argc >= 6 ? juce::String(argv[5]).getDoubleValue() : 44100.0);
    if (argc >= 4 && juce::String(argv[1]) == "--dry-path-isolation-probe")
        return runDryPathIsolationProbe(static_cast<unsigned int>(juce::String(argv[2]).getLargeIntValue()),
            juce::String::fromUTF8(argv[3]),
            argc >= 5 ? juce::String(argv[4]).getIntValue() : 5,
            argc >= 6 ? juce::String(argv[5]).getIntValue() : 15,
            argc >= 7 ? juce::String(argv[6]).getIntValue() : 5,
            argc >= 8 ? juce::String(argv[7]).getDoubleValue() : 44100.0);
    if (argc >= 2 && juce::String(argv[1]) == "--engine")
        return runPlaybackEngine();
    if (argc >= 3 && juce::String(argv[1]) == "--scan-module")
        return scanSingleModule(juce::String::fromUTF8(argv[2]));
    if (argc >= 2)
        return scanSingleModule(juce::String::fromUTF8(argv[1]));
    std::cerr << "AuralisPluginHost: missing command" << std::endl;
    return 1;
}
