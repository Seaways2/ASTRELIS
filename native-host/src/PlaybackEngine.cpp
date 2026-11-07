#include "PlaybackEngine.h"
#include "PluginWindowStyle.h"
#include "AuralisVersion.h"
#if JUCE_WINDOWS
#include <windows.h>
#include <propsys.h>
#include <functiondiscoverykeys_devpkey.h>
#include <mmdeviceapi.h>
#include <propvarutil.h>
#endif
#include <chrono>
#include <complex>

namespace {
constexpr size_t maximumPluginStateBytes = 64u * 1024u * 1024u;

uint64_t steadyClockMicros() noexcept
{
    return static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::microseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count());
}

void updateAtomicMaximum(std::atomic<uint64_t>& destination, uint64_t candidate) noexcept
{
    auto current = destination.load(std::memory_order_relaxed);
    while (candidate > current
        && !destination.compare_exchange_weak(current, candidate, std::memory_order_relaxed)) {}
}

juce::String stableStateHash(const void* data, size_t size)
{
    constexpr uint64_t offset = 1469598103934665603ull;
    constexpr uint64_t prime = 1099511628211ull;
    auto hash = offset;
    const auto* bytes = static_cast<const uint8_t*>(data);
    for (size_t index = 0; index < size; ++index) hash = (hash ^ bytes[index]) * prime;
    return juce::String::toHexString(static_cast<juce::int64>(hash)).paddedLeft('0', 16);
}
}

class EnginePluginWindow final : public juce::DocumentWindow
{
public:
    EnginePluginWindow(juce::AudioPluginInstance& plugin, std::uintptr_t ownerHandle, juce::String pluginIdentifier)
        : DocumentWindow(plugin.getName(), juce::Colour(0xff080d10), minimiseButton | closeButton, false), identifier(std::move(pluginIdentifier))
    {
        setLookAndFeel(&look);
        if (auto* editor = plugin.createEditorIfNeeded()) { setContentNonOwned(editor, true); setResizable(editor->isResizable(), false); }
        else { setSize(480, 180); setContentOwned(new juce::Label("noEditor", "该插件没有提供原生编辑器界面"), true); }
        setUsingNativeTitleBar(false); setTitleBarHeight(36); configurePluginPin(*this); centreWithSize(getWidth(), getHeight());
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
        setVisible(true); toFront(true);
    }
    ~EnginePluginWindow() override { clearContentComponent(); setLookAndFeel(nullptr); }
    void closeButtonPressed() override { setVisible(false); }
    void minimiseButtonPressed() override { setAlwaysOnTop(!isAlwaysOnTop()); }
    const juce::String& getPluginIdentifier() const { return identifier; }
private:
    int getDesktopWindowStyleFlags() const override
    {
        return DocumentWindow::getDesktopWindowStyleFlags() & ~juce::ComponentPeer::windowAppearsOnTaskbar;
    }
    PluginWindowLookAndFeel look;
    juce::String identifier;
};

namespace {
struct PlatformEndpointIdentity
{
    juce::String endpointId;
    juce::String status { "unavailable-platform-id" };
};

#if JUCE_WINDOWS
PlatformEndpointIdentity windowsEndpointIdentityForFriendlyName(const juce::String& friendlyName)
{
    const auto initialised = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    const auto shouldUninitialise = SUCCEEDED(initialised);
    if (FAILED(initialised) && initialised != RPC_E_CHANGED_MODE)
        return {};

    IMMDeviceEnumerator* enumerator = nullptr;
    IMMDeviceCollection* collection = nullptr;
    PlatformEndpointIdentity result;
    int matches = 0;
    if (SUCCEEDED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_INPROC_SERVER,
                                   IID_PPV_ARGS(&enumerator)))
        // JUCE's output list contains currently available endpoints. Restrict
        // the platform lookup to ACTIVE as well, otherwise a disabled historic
        // endpoint with the same friendly name makes a valid live device look
        // ambiguous.
        && SUCCEEDED(enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &collection)))
    {
        UINT count = 0;
        collection->GetCount(&count);
        for (UINT index = 0; index < count; ++index)
        {
            IMMDevice* device = nullptr;
            IPropertyStore* properties = nullptr;
            LPWSTR endpointId = nullptr;
            PROPVARIANT name;
            PropVariantInit(&name);
            if (SUCCEEDED(collection->Item(index, &device))
                && SUCCEEDED(device->OpenPropertyStore(STGM_READ, &properties))
                && SUCCEEDED(properties->GetValue(PKEY_Device_FriendlyName, &name))
                && name.vt == VT_LPWSTR && name.pwszVal != nullptr
                && friendlyName.equalsIgnoreCase(juce::String(name.pwszVal))
                && SUCCEEDED(device->GetId(&endpointId)) && endpointId != nullptr)
            {
                ++matches;
                result.endpointId = juce::String(endpointId);
            }
            if (endpointId != nullptr) CoTaskMemFree(endpointId);
            PropVariantClear(&name);
            if (properties != nullptr) properties->Release();
            if (device != nullptr) device->Release();
        }
    }
    if (collection != nullptr) collection->Release();
    if (enumerator != nullptr) enumerator->Release();
    if (shouldUninitialise) CoUninitialize();
    if (matches == 1 && result.endpointId.isNotEmpty()) result.status = "stable-windows-endpoint-id";
    else if (matches > 1) { result.endpointId.clear(); result.status = "ambiguous-friendly-name"; }
    return result;
}
#endif

juce::String backendKindForType(const juce::String& typeName)
{
    if (typeName == "Windows Audio") return "wasapi-shared";
    if (typeName == "Windows Audio (Low Latency Mode)") return "wasapi-shared-low-latency";
    if (typeName == "Windows Audio (Exclusive Mode)") return "wasapi-exclusive";
    if (typeName.containsIgnoreCase("ASIO")) return "asio";
    if (typeName.containsIgnoreCase("DirectSound")) return "directsound-legacy";
    return "unknown";
}

juce::String typeNameForBackend(const juce::String& backend)
{
    if (backend == "wasapi-shared") return "Windows Audio";
    if (backend == "wasapi-shared-low-latency") return "Windows Audio (Low Latency Mode)";
    if (backend == "wasapi-exclusive") return "Windows Audio (Exclusive Mode)";
    return {};
}

juce::var outputIntentToVar(const OutputDeviceIntent& intent)
{
    auto object = std::make_unique<juce::DynamicObject>();
    object->setProperty("backend", intent.backend);
    object->setProperty("juceTypeName", intent.juceTypeName);
    object->setProperty("juceDeviceName", intent.juceDeviceName);
    if (intent.platformEndpointId.isNotEmpty()) object->setProperty("platformEndpointId", intent.platformEndpointId);
    object->setProperty("sampleRateMode", intent.sampleRateMode);
    if (intent.sampleRateMode == "fixed") object->setProperty("fixedSampleRate", intent.fixedSampleRate);
    object->setProperty("bufferMode", intent.bufferMode);
    if (intent.bufferMode == "fixed") object->setProperty("fixedBufferSize", intent.fixedBufferSize);
    object->setProperty("exclusiveFallback", intent.exclusiveFallback);
    object->setProperty("generation", intent.generation);
    return juce::var(object.release());
}

juce::Array<juce::var> toVarArray(const juce::Array<double>& values)
{
    juce::Array<juce::var> result;
    for (const auto value : values) result.add(value);
    return result;
}

juce::Array<juce::var> toVarArray(const juce::Array<int>& values)
{
    juce::Array<juce::var> result;
    for (const auto value : values) result.add(value);
    return result;
}

juce::Array<juce::var> toVarArray(const juce::StringArray& values)
{
    juce::Array<juce::var> result;
    for (const auto& value : values) result.add(value);
    return result;
}

juce::Array<juce::var> activeChannelIndexes(const juce::BigInteger& channels)
{
    juce::Array<juce::var> result;
    for (int index = channels.findNextSetBit(0); index >= 0; index = channels.findNextSetBit(index + 1))
        result.add(index);
    return result;
}

void appendDeviceKey(juce::DynamicObject& object, const juce::String& typeName, const juce::String& deviceName)
{
    const auto backend = backendKindForType(typeName);
    object.setProperty("backend", backend);
    object.setProperty("juceTypeName", typeName);
    object.setProperty("juceDeviceName", deviceName);
#if JUCE_WINDOWS
    if (backend.startsWith("wasapi-")) {
        const auto identity = windowsEndpointIdentityForFriendlyName(deviceName);
        object.setProperty("identityStatus", identity.status);
        if (identity.endpointId.isNotEmpty()) object.setProperty("platformEndpointId", identity.endpointId);
        return;
    }
#endif
    object.setProperty("identityStatus", "unavailable-platform-id");
}

juce::var result(bool ok, const juce::String& error = {})
{
    auto object = std::make_unique<juce::DynamicObject>();
    AuralisVersion::appendTo(*object);
    object->setProperty("ok", ok);
    if (error.isNotEmpty()) object->setProperty("error", error);
    return juce::var(object.release());
}
}

juce::var PlaybackEngine::enumerateOutputDevices()
{
    juce::Array<juce::var> devices;
    auto* current = deviceManager.getCurrentAudioDevice();
    const auto currentType = current != nullptr ? current->getTypeName() : juce::String();
    const auto currentName = current != nullptr ? current->getName() : juce::String();
    for (auto* type : deviceManager.getAvailableDeviceTypes())
    {
        if (type == nullptr) continue;
        type->scanForDevices();
        const auto names = type->getDeviceNames(false);
        const auto defaultIndex = type->getDefaultDeviceIndex(false);
        for (int index = 0; index < names.size(); ++index)
        {
            auto item = std::make_unique<juce::DynamicObject>();
            appendDeviceKey(*item, type->getTypeName(), names[index]);
            item->setProperty("defaultForType", index == defaultIndex);
            item->setProperty("active", type->getTypeName() == currentType && names[index] == currentName);
            devices.add(juce::var(item.release()));
        }
    }
    auto object = std::make_unique<juce::DynamicObject>();
    AuralisVersion::appendTo(*object);
    object->setProperty("ok", true);
    object->setProperty("devices", juce::var(devices));
    object->setProperty("identityNote", "A Windows MMDevice endpoint ID is returned only for an exact, unique FriendlyName match. Ambiguous or unavailable identities are reported honestly; no ID is fabricated.");
    return juce::var(object.release());
}

juce::var PlaybackEngine::outputDeviceCapabilities(const juce::DynamicObject& command)
{
    const auto requestedType = command.getProperty("juceTypeName").toString();
    const auto requestedName = command.getProperty("juceDeviceName").toString();
    if (requestedType.isEmpty() || requestedName.isEmpty()) return result(false, "INVALID_DEVICE_KEY");

    juce::AudioIODeviceType* selectedType = nullptr;
    for (auto* type : deviceManager.getAvailableDeviceTypes())
        if (type != nullptr && type->getTypeName() == requestedType) { selectedType = type; break; }
    if (selectedType == nullptr) return result(false, "AUDIO_BACKEND_NOT_FOUND");
    selectedType->scanForDevices();
    const auto names = selectedType->getDeviceNames(false);
    if (!names.contains(requestedName)) return result(false, "OUTPUT_DEVICE_NOT_FOUND");

    auto* current = deviceManager.getCurrentAudioDevice();
    const auto isActive = current != nullptr && current->getTypeName() == requestedType && current->getName() == requestedName;
    std::unique_ptr<juce::AudioIODevice> unopenedProbe;
    juce::AudioIODevice* device = current;
    if (!isActive)
    {
        unopenedProbe.reset(selectedType->createDevice(requestedName, {}));
        device = unopenedProbe.get();
    }
    if (device == nullptr) return result(false, "OUTPUT_DEVICE_CAPABILITIES_UNAVAILABLE");

    const auto rates = device->getAvailableSampleRates();
    const auto buffers = device->getAvailableBufferSizes();
    const auto channels = device->getOutputChannelNames();
    auto object = std::make_unique<juce::DynamicObject>();
    AuralisVersion::appendTo(*object);
    object->setProperty("ok", true);
    appendDeviceKey(*object, requestedType, requestedName);
    object->setProperty("active", isActive);
    object->setProperty("capabilitiesState", isActive ? "active-device" :
        (rates.isEmpty() && buffers.isEmpty() && channels.isEmpty() ? "unavailable-unopened" : "reported-unopened"));
    object->setProperty("availableSampleRates", juce::var(toVarArray(rates)));
    object->setProperty("availableBufferSizes", juce::var(toVarArray(buffers)));
    object->setProperty("outputChannelNames", juce::var(toVarArray(channels)));
    object->setProperty("defaultBufferSize", device->getDefaultBufferSize());
    object->setProperty("hasControlPanel", device->hasControlPanel());
    if (isActive)
    {
        object->setProperty("currentSampleRate", device->getCurrentSampleRate());
        object->setProperty("currentBufferSize", device->getCurrentBufferSizeSamples());
        object->setProperty("currentBitDepth", device->getCurrentBitDepth());
        object->setProperty("activeOutputChannels", juce::var(activeChannelIndexes(device->getActiveOutputChannels())));
    }
    return juce::var(object.release());
}

juce::var PlaybackEngine::outputDeviceStatus()
{
    auto object = std::make_unique<juce::DynamicObject>();
    AuralisVersion::appendTo(*object);
    object->setProperty("ok", ready);
    auto* device = deviceManager.getCurrentAudioDevice();
    if (device == nullptr)
    {
        object->setProperty("state", "no-device");
        return juce::var(object.release());
    }
    object->setProperty("state", "active");
    appendDeviceKey(*object, device->getTypeName(), device->getName());
    object->setProperty("sampleRate", device->getCurrentSampleRate());
    object->setProperty("bufferSize", device->getCurrentBufferSizeSamples());
    object->setProperty("bufferMs", device->getCurrentSampleRate() > 0.0
        ? device->getCurrentBufferSizeSamples() * 1000.0 / device->getCurrentSampleRate() : 0.0);
    object->setProperty("bitDepth", device->getCurrentBitDepth());
    object->setProperty("outputChannelNames", juce::var(toVarArray(device->getOutputChannelNames())));
    object->setProperty("activeOutputChannels", juce::var(activeChannelIndexes(device->getActiveOutputChannels())));
    object->setProperty("callbackCount", static_cast<juce::int64>(callbackCount.load(std::memory_order_relaxed)));
    object->setProperty("callbackMaxGapUs", static_cast<juce::int64>(callbackMaxGapUs.load(std::memory_order_relaxed)));
    if (hasLastKnownGood) {
        object->setProperty("sampleRateMode", lastKnownGoodIntent.sampleRateMode);
        const auto policy = lastKnownGoodIntent.sampleRateMode == "follow-source"
            ? (lastKnownGoodIntent.backend == "wasapi-exclusive" ? "source-rate-priority" : "continuity-priority")
            : lastKnownGoodIntent.sampleRateMode == "fixed" ? "fixed-rate" : "system-rate";
        object->setProperty("sampleRatePolicy", policy);
    }
    return juce::var(object.release());
}

juce::var PlaybackEngine::applyOutputDeviceTransaction(const juce::DynamicObject& command)
{
    const auto candidateValue = command.getProperty("candidate");
    const auto* candidateObject = candidateValue.getDynamicObject();
    if (candidateObject == nullptr) return result(false, "INVALID_DEVICE_CANDIDATE");

    OutputDeviceIntent candidate;
    candidate.backend = candidateObject->getProperty("backend").toString();
    candidate.juceTypeName = typeNameForBackend(candidate.backend);
    candidate.juceDeviceName = candidateObject->getProperty("juceDeviceName").toString();
    candidate.platformEndpointId = candidateObject->getProperty("platformEndpointId").toString();
    candidate.sampleRateMode = candidateObject->getProperty("sampleRateMode").toString();
    candidate.fixedSampleRate = static_cast<double>(candidateObject->getProperty("fixedSampleRate"));
    candidate.bufferMode = candidateObject->getProperty("bufferMode").toString();
    candidate.fixedBufferSize = static_cast<int>(candidateObject->getProperty("fixedBufferSize"));
    candidate.exclusiveFallback = candidateObject->getProperty("exclusiveFallback").toString();
    candidate.generation = static_cast<juce::int64>(command.getProperty("generation"));
    if (candidate.sampleRateMode.isEmpty()) candidate.sampleRateMode = "system";
    if (candidate.bufferMode.isEmpty()) candidate.bufferMode = "auto";
    if (candidate.exclusiveFallback.isEmpty()) candidate.exclusiveFallback = "shared-low-latency";

    if (candidate.juceTypeName.isEmpty()) return result(false, "UNSUPPORTED_OUTPUT_BACKEND");
    if (candidate.juceDeviceName.isEmpty()) return result(false, "OUTPUT_DEVICE_REQUIRED");
    if (candidate.sampleRateMode != "system" && candidate.sampleRateMode != "follow-source"
        && candidate.sampleRateMode != "fixed") return result(false, "INVALID_SAMPLE_RATE_MODE");
    if (candidate.bufferMode != "auto" && candidate.bufferMode != "fixed")
        return result(false, "INVALID_BUFFER_MODE");
    if (candidate.exclusiveFallback != "shared-low-latency" && candidate.exclusiveFallback != "shared"
        && candidate.exclusiveFallback != "ask") return result(false, "INVALID_EXCLUSIVE_FALLBACK");

    juce::AudioIODeviceType* selectedType = nullptr;
    for (auto* type : deviceManager.getAvailableDeviceTypes())
        if (type != nullptr && type->getTypeName() == candidate.juceTypeName) { selectedType = type; break; }
    if (selectedType == nullptr) return result(false, "AUDIO_BACKEND_NOT_FOUND");
    selectedType->scanForDevices();
    if (!selectedType->getDeviceNames(false).contains(candidate.juceDeviceName))
        return result(false, "OUTPUT_DEVICE_NOT_FOUND");

#if JUCE_WINDOWS
    if (candidate.platformEndpointId.isNotEmpty()) {
        const auto identity = windowsEndpointIdentityForFriendlyName(candidate.juceDeviceName);
        if (identity.status != "stable-windows-endpoint-id" || identity.endpointId != candidate.platformEndpointId)
            return result(false, "OUTPUT_DEVICE_IDENTITY_MISMATCH");
    }
#endif

    std::unique_ptr<juce::AudioIODevice> capabilityProbe(selectedType->createDevice(candidate.juceDeviceName, {}));
    if (capabilityProbe == nullptr) return result(false, "OUTPUT_DEVICE_CAPABILITIES_UNAVAILABLE");
    if (candidate.sampleRateMode == "fixed"
        && (candidate.fixedSampleRate <= 0.0 || !capabilityProbe->getAvailableSampleRates().contains(candidate.fixedSampleRate)))
        return result(false, "UNSUPPORTED_SAMPLE_RATE");
    if (candidate.bufferMode == "fixed"
        && (candidate.fixedBufferSize <= 0 || !capabilityProbe->getAvailableBufferSizes().contains(candidate.fixedBufferSize)))
        return result(false, "UNSUPPORTED_BUFFER_SIZE");

    double requestedRate = candidate.sampleRateMode == "fixed" ? candidate.fixedSampleRate : 0.0;
    auto sampleRateDecision = candidate.sampleRateMode == "fixed" ? juce::String("fixed-device-rate")
        : candidate.sampleRateMode == "system" ? juce::String("system-device-rate")
        : juce::String("continuity-resample");
    if (candidate.sampleRateMode == "follow-source" && candidate.backend == "wasapi-exclusive") {
        auto sourceRate = static_cast<double>(command.getProperty("sourceSampleRateHint"));
        if (sourceRate <= 0.0 && activeSource != nullptr) {
            juce::DynamicObject sourceStatus;
            activeSource->appendStatus(sourceStatus);
            sourceRate = static_cast<double>(sourceStatus.getProperty("sourceSampleRate"));
        }
        if (sourceRate > 0.0 && capabilityProbe->getAvailableSampleRates().contains(sourceRate)) {
            requestedRate = sourceRate;
            sampleRateDecision = "exclusive-follow-source-reconfigure";
        } else {
            requestedRate = 0.0;
            sampleRateDecision = "follow-source-unavailable-resample";
        }
    }
    const auto requestedBuffer = candidate.bufferMode == "fixed" ? candidate.fixedBufferSize : 0;
    const auto previousType = deviceManager.getCurrentDeviceTypeObject() != nullptr
        ? deviceManager.getCurrentDeviceTypeObject()->getTypeName() : juce::String();
    const auto previousSetup = deviceManager.getAudioDeviceSetup();
    const auto testFault = juce::SystemStats::getEnvironmentVariable("AURALIS_ENABLE_TEST_FAULTS", {}) == "1"
        ? command.getProperty("testFault").toString() : juce::String();

    const auto applySetup = [this](const juce::String& typeName, const juce::String& deviceName,
                                   double rate, int buffer) -> juce::String {
        if (deviceManager.getCurrentDeviceTypeObject() == nullptr
            || deviceManager.getCurrentDeviceTypeObject()->getTypeName() != typeName)
            deviceManager.setCurrentAudioDeviceType(typeName, false);
        if (deviceManager.getCurrentDeviceTypeObject() == nullptr
            || deviceManager.getCurrentDeviceTypeObject()->getTypeName() != typeName)
            return "AUDIO_BACKEND_ACTIVATION_FAILED";
        auto setup = deviceManager.getAudioDeviceSetup();
        setup.inputDeviceName.clear();
        setup.inputChannels.clear();
        setup.useDefaultInputChannels = false;
        setup.outputDeviceName = deviceName;
        setup.outputChannels.clear();
        setup.useDefaultOutputChannels = true;
        setup.sampleRate = rate;
        setup.bufferSize = buffer;
        return deviceManager.setAudioDeviceSetup(setup, false);
    };

    const auto healthError = [this](const juce::String& expectedType, const juce::String& expectedName,
                                    uint64_t previousCallbackCount) -> juce::String {
        auto* device = deviceManager.getCurrentAudioDevice();
        if (device == nullptr) return "NO_ACTIVE_OUTPUT_AFTER_APPLY";
        if (device->getTypeName() != expectedType || device->getName() != expectedName)
            return "ACTUAL_OUTPUT_MISMATCH";
        if (device->getCurrentSampleRate() <= 0.0 || device->getCurrentBufferSizeSamples() <= 0
            || device->getActiveOutputChannels().countNumberOfSetBits() < 2)
            return "ACTUAL_OUTPUT_FORMAT_INVALID";
        {
            const juce::ScopedLock lock(processLock);
            if (lastGraphPrepareError.isNotEmpty()) return lastGraphPrepareError;
        }
        for (int attempt = 0; attempt < 60; ++attempt) {
            if (callbackCount.load(std::memory_order_relaxed) > previousCallbackCount) return {};
            juce::Thread::sleep(10);
        }
        return "AUDIO_CALLBACK_HEALTH_TIMEOUT";
    };

    const auto setFadeTargetAndWait = [this](float target) {
        routeGainTarget.store(target, std::memory_order_relaxed);
        for (int attempt = 0; attempt < 12; ++attempt) {
            if (std::abs(routeGainCurrent.load(std::memory_order_relaxed) - target) < 0.01f) break;
            juce::Thread::sleep(5);
        }
    };
    setFadeTargetAndWait(0.0f);

    auto error = testFault == "candidate-open-fail" ? juce::String("INJECTED_CANDIDATE_OPEN_FAILURE")
        : applySetup(candidate.juceTypeName, candidate.juceDeviceName, requestedRate, requestedBuffer);
    const auto candidateHealthBaseline = callbackCount.load(std::memory_order_relaxed);
    if (error.isEmpty()) error = healthError(candidate.juceTypeName, candidate.juceDeviceName, candidateHealthBaseline);
    if (error.isEmpty() && (testFault == "after-open" || testFault == "after-open-and-rollback"))
        error = "INJECTED_POST_OPEN_HEALTH_FAILURE";

    auto makeTransactionResponse = [this, &candidate, &sampleRateDecision](bool ok, bool committed, bool degraded,
                                                      const juce::String& transactionError,
                                                      const juce::String& recovery) {
        auto response = std::make_unique<juce::DynamicObject>();
        AuralisVersion::appendTo(*response);
        response->setProperty("ok", ok);
        response->setProperty("committed", committed);
        response->setProperty("degraded", degraded);
        response->setProperty("generation", candidate.generation);
        response->setProperty("requested", outputIntentToVar(candidate));
        response->setProperty("sampleRateDecision", sampleRateDecision);
        response->setProperty("actual", outputDeviceStatus());
        if (hasLastKnownGood) response->setProperty("lastKnownGood", outputIntentToVar(lastKnownGoodIntent));
        if (transactionError.isNotEmpty()) response->setProperty("error", transactionError);
        if (recovery.isNotEmpty()) response->setProperty("recovery", recovery);
        return juce::var(response.release());
    };

    const auto commitCurrentAsLkg = [this](const OutputDeviceIntent& intent) {
        auto* device = deviceManager.getCurrentAudioDevice();
        if (device == nullptr) return;
        lastKnownGoodType = device->getTypeName();
        lastKnownGoodSetup = deviceManager.getAudioDeviceSetup();
        lastKnownGoodIntent = intent;
        lastKnownGoodIntent.backend = backendKindForType(device->getTypeName());
        lastKnownGoodIntent.juceTypeName = device->getTypeName();
        lastKnownGoodIntent.juceDeviceName = device->getName();
#if JUCE_WINDOWS
        const auto identity = windowsEndpointIdentityForFriendlyName(device->getName());
        lastKnownGoodIntent.platformEndpointId = identity.status == "stable-windows-endpoint-id" ? identity.endpointId : juce::String();
#endif
        hasLastKnownGood = true;
    };

    if (error.isEmpty()) {
        commitCurrentAsLkg(candidate);
        routeGainTarget.store(1.0f, std::memory_order_relaxed);
        return makeTransactionResponse(true, true, false, {}, "none");
    }

    // An Exclusive failure may intentionally degrade to the profile's chosen
    // shared mode. The requested intent remains visible, but only the healthy
    // actual fallback is promoted to last-known-good.
    if (candidate.backend == "wasapi-exclusive" && candidate.exclusiveFallback != "ask") {
        OutputDeviceIntent fallback = candidate;
        fallback.backend = candidate.exclusiveFallback == "shared" ? "wasapi-shared" : "wasapi-shared-low-latency";
        fallback.juceTypeName = typeNameForBackend(fallback.backend);
        fallback.sampleRateMode = "system";
        fallback.fixedSampleRate = 0.0;
        fallback.bufferMode = "auto";
        fallback.fixedBufferSize = 0;
        auto fallbackError = applySetup(fallback.juceTypeName, fallback.juceDeviceName, 0.0, 0);
        const auto fallbackHealthBaseline = callbackCount.load(std::memory_order_relaxed);
        if (fallbackError.isEmpty()) fallbackError = healthError(fallback.juceTypeName, fallback.juceDeviceName, fallbackHealthBaseline);
        if (fallbackError.isEmpty()) {
            commitCurrentAsLkg(fallback);
            routeGainTarget.store(1.0f, std::memory_order_relaxed);
            return makeTransactionResponse(true, true, true, error, "exclusive-profile-fallback");
        }
        error += "; FALLBACK_FAILED: " + fallbackError;
    }

    auto rollbackError = testFault == "after-open-and-rollback" ? juce::String("INJECTED_ROLLBACK_FAILURE")
        : applySetup(previousType, previousSetup.outputDeviceName, previousSetup.sampleRate, previousSetup.bufferSize);
    const auto rollbackHealthBaseline = callbackCount.load(std::memory_order_relaxed);
    if (rollbackError.isEmpty()) rollbackError = healthError(previousType, previousSetup.outputDeviceName, rollbackHealthBaseline);
    if (rollbackError.isEmpty()) {
        routeGainTarget.store(1.0f, std::memory_order_relaxed);
        return makeTransactionResponse(false, false, false, error, "previous-route-restored");
    }

    // Final recovery is the default WASAPI Shared endpoint with system rate and
    // automatic buffer. This path is intentionally independent of the bad
    // candidate and never promotes that candidate to LKG.
    auto* sharedType = [&]() -> juce::AudioIODeviceType* {
        for (auto* type : deviceManager.getAvailableDeviceTypes())
            if (type != nullptr && type->getTypeName() == "Windows Audio") return type;
        return nullptr;
    }();
    juce::String safeError = "SAFE_SHARED_BACKEND_UNAVAILABLE";
    if (sharedType != nullptr) {
        sharedType->scanForDevices();
        const auto names = sharedType->getDeviceNames(false);
        const auto defaultIndex = sharedType->getDefaultDeviceIndex(false);
        if (juce::isPositiveAndBelow(defaultIndex, names.size())) {
            safeError = applySetup("Windows Audio", names[defaultIndex], 0.0, 0);
            const auto safeHealthBaseline = callbackCount.load(std::memory_order_relaxed);
            if (safeError.isEmpty()) safeError = healthError("Windows Audio", names[defaultIndex], safeHealthBaseline);
            if (safeError.isEmpty()) {
                OutputDeviceIntent safe;
                safe.backend = "wasapi-shared";
                safe.juceTypeName = "Windows Audio";
                safe.juceDeviceName = names[defaultIndex];
                safe.generation = candidate.generation;
                commitCurrentAsLkg(safe);
                routeGainTarget.store(1.0f, std::memory_order_relaxed);
                return makeTransactionResponse(false, false, true, error + "; ROLLBACK_FAILED: " + rollbackError,
                                               "safe-shared-restored");
            }
        }
    }
    routeGainTarget.store(1.0f, std::memory_order_relaxed);
    ready = deviceManager.getCurrentAudioDevice() != nullptr;
    return makeTransactionResponse(false, false, false,
        error + "; ROLLBACK_FAILED: " + rollbackError + "; SAFE_SHARED_FAILED: " + safeError,
        "recovery-failed");
}

namespace {
bool configureStereoEffect(juce::AudioPluginInstance& plugin, double rate, int samplesPerBlock,
                           juce::String& error)
{
    auto layout = plugin.getBusesLayout();
    if (layout.outputBuses.isEmpty()) {
        error = "PLUGIN_HAS_NO_AUDIO_OUTPUT";
        return false;
    }
    for (auto& bus : layout.inputBuses) bus = juce::AudioChannelSet::disabled();
    for (auto& bus : layout.outputBuses) bus = juce::AudioChannelSet::disabled();
    if (!layout.inputBuses.isEmpty())
        layout.inputBuses.getReference(0) = juce::AudioChannelSet::stereo();
    layout.outputBuses.getReference(0) = juce::AudioChannelSet::stereo();

    if (!plugin.checkBusesLayoutSupported(layout) || !plugin.setBusesLayout(layout)) {
        error = "PLUGIN_STEREO_LAYOUT_UNSUPPORTED";
        return false;
    }
    plugin.setRateAndBufferSizeDetails(rate, samplesPerBlock);
    plugin.setNonRealtime(false);
    plugin.setProcessingPrecision(juce::AudioProcessor::singlePrecision);
    plugin.prepareToPlay(rate, samplesPerBlock);
    plugin.reset();
    return true;
}
}

PlaybackEngine::PlaybackEngine() : PlaybackEngine(true) {}

PlaybackEngine::PlaybackEngine(bool initialiseDevice)
{
    audioFormats.registerBasicFormats();
    pluginFormats.addDefaultFormats();
    // The lifecycle self-test uses the real file/transport/rack code and a
    // manually pumped callback, without opening devices, pipes, or timers.
    if (!initialiseDevice) return;
    const auto error = deviceManager.initialise(0, 2, nullptr, true);
    ready = error.isEmpty() && deviceManager.getCurrentAudioDevice() != nullptr;
    if (ready) {
        deviceManager.addAudioCallback(this);
        if (auto* device = deviceManager.getCurrentAudioDevice()) {
            lastKnownGoodSetup = deviceManager.getAudioDeviceSetup();
            lastKnownGoodType = device->getTypeName();
            lastKnownGoodIntent.backend = backendKindForType(lastKnownGoodType);
            lastKnownGoodIntent.juceTypeName = lastKnownGoodType;
            lastKnownGoodIntent.juceDeviceName = device->getName();
            lastKnownGoodIntent.sampleRateMode = "system";
            lastKnownGoodIntent.bufferMode = "auto";
            hasLastKnownGood = true;
        }
    }
    browserPcmPipeServer = std::make_unique<BrowserPcmPipeServer>(
        [this](const auto& packet, const float* samples) { return handlePipePacket(packet, samples); });
    browserPcmPipeServer->start();
    lastPluginStateSaveUs = steadyClockMicros();
    startTimer(10);
}

PlaybackEngine::~PlaybackEngine()
{
    stopTimer();
    directOutput.reset();
    browserPcmPipeServer.reset();
    if (pluginStateDirectory.isNotEmpty()) savePluginStates();
    deviceManager.removeAudioCallback(this);
    {
        const juce::ScopedLock lock(processLock);
        // No callback remains to acknowledge transport.stop(). Detaching is
        // the shutdown operation; it also joins all read-ahead client work.
        if (activeSource && activeSource->kind() != AuralisAudioSourceKind::file)
            activeSource->stop();
        if (activeSource) activeSource->release();
        activeSource.reset();
        transport.setSource(nullptr);
        editorWindows.clear();
        retiredEditorWindows.clear();
        for (auto& plugin : plugins) plugin.instance->releaseResources();
        for (auto& plugin : retiredPlugins) plugin.instance->releaseResources();
        plugins.clear();
        retiredPlugins.clear();
        readerSource.reset();
    }
    // Clients are removed before stopping the worker; never force-kill an IO
    // thread while it can still own a reader or reference the transport.
    fileReadAheadThread.stopThread(-1);
}

void PlaybackEngine::stopActiveSource()
{
    // Source ownership changes only on this message/control thread. A file
    // stop must let the audio thread enter processLock to acknowledge it.
    if (activeSource && activeSource->kind() == AuralisAudioSourceKind::file) {
        activeSource->stop();
        return;
    }
    const juce::ScopedLock lock(processLock);
    if (activeSource) activeSource->stop();
}

void PlaybackEngine::timerCallback()
{
    const auto now = steadyClockMicros();
    const auto pauseAt = pauseAfterFadeAtUs.load(std::memory_order_relaxed);
    if (pauseAt > 0 && now >= pauseAt) {
        if (pauseAfterFadeAtUs.exchange(0, std::memory_order_relaxed) > 0) stopActiveSource();
        userFadeCurrent.store(1.0f, std::memory_order_relaxed);
        userFadeTarget.store(1.0f, std::memory_order_relaxed);
    }
    if (now - lastPluginStateSaveUs >= 10000000ull) {
        lastPluginStateSaveUs = now;
        if (pluginStateDirectory.isNotEmpty() && !plugins.empty()) savePluginStates();
    }
}

void PlaybackEngine::audioDeviceAboutToStart(juce::AudioIODevice* device)
{
    const juce::ScopedLock lock(processLock);
    sampleRate = device->getCurrentSampleRate();
    blockSize = device->getCurrentBufferSizeSamples();
    lastGraphPrepareError.clear();
    juce::String sourceError;
    if (activeSource && !activeSource->prepare(sampleRate, blockSize, sourceError))
        lastGraphPrepareError = sourceError.isNotEmpty() ? sourceError : "AUDIO_SOURCE_PREPARE_FAILED";
    try {
        for (auto& plugin : plugins) plugin.instance->prepareToPlay(sampleRate, blockSize);
    } catch (...) {
        lastGraphPrepareError = "PLUGIN_GRAPH_PREPARE_FAILED";
    }
    int latencySamples = 0;
    for (const auto& plugin : plugins) latencySamples += std::max(0, plugin.instance->getLatencySamples());
    pluginLatencySamples.store(latencySamples, std::memory_order_relaxed);
}

void PlaybackEngine::audioDeviceStopped()
{
    const juce::ScopedLock lock(processLock);
    if (activeSource) activeSource->release();
    for (auto& plugin : plugins) plugin.instance->releaseResources();
}

void PlaybackEngine::audioDeviceIOCallbackWithContext(const float* const*, int,
                                                       float* const* output, int outputChannels,
                                                       int samples,
                                                       const juce::AudioIODeviceCallbackContext&)
{
    const auto callbackTimestamp = steadyClockMicros();
    const auto previousCallback = lastCallbackTimestampUs.exchange(callbackTimestamp, std::memory_order_relaxed);
    if (previousCallback > 0 && callbackTimestamp > previousCallback)
        updateAtomicMaximum(callbackMaxGapUs, callbackTimestamp - previousCallback);
    callbackCount.fetch_add(1, std::memory_order_relaxed);
    juce::AudioBuffer<float> buffer(output, outputChannels, samples);
    buffer.clear();
    const juce::ScopedLock lock(processLock);
    const int rendered = activeSource ? activeSource->render(buffer) : 0;
    if (rendered <= 0) return;
    juce::MidiBuffer midi;
    for (auto& plugin : plugins) plugin.instance->processBlock(buffer, midi);
    // Publish the processed, pre-master signal. This keeps the visualizer and
    // meters honest when a YouTube or local source is changed by the rack,
    // while the user's listening volume does not flatten the visualization.
    if (analysisRequested.load(std::memory_order_relaxed)) {
    const auto start = analysisWritePosition.load(std::memory_order_relaxed);
    const auto* left = buffer.getReadPointer(0);
    const auto* right = buffer.getReadPointer(outputChannels > 1 ? 1 : 0);
    for (int sample = 0; sample < samples; ++sample) {
        const auto index = static_cast<size_t>((start + static_cast<uint64_t>(sample)) % analysisCapacity);
        analysisLeft[index].store(left[sample], std::memory_order_relaxed);
        analysisRight[index].store(right[sample], std::memory_order_relaxed);
    }
    analysisWritePosition.store(start + static_cast<uint64_t>(samples), std::memory_order_release);
    }
    const auto gainStart = routeGainCurrent.load(std::memory_order_relaxed);
    const auto gainTarget = routeGainTarget.load(std::memory_order_relaxed);
    const auto maximumChange = static_cast<float>(samples / juce::jmax(1.0, sampleRate * 0.020));
    const auto gainEnd = gainStart + juce::jlimit(-maximumChange, maximumChange, gainTarget - gainStart);
    routeGainCurrent.store(gainEnd, std::memory_order_relaxed);
    const auto fadeStart = userFadeCurrent.load(std::memory_order_relaxed);
    const auto fadeTarget = userFadeTarget.load(std::memory_order_relaxed);
    const auto fadeSeconds = static_cast<double>(userFadeMs.load(std::memory_order_relaxed)) / 1000.0;
    const auto fadeMaximumChange = fadeSeconds <= 0.0 ? 1.0f
        : static_cast<float>(samples / juce::jmax(1.0, sampleRate * fadeSeconds));
    const auto fadeEnd = fadeStart + juce::jlimit(-fadeMaximumChange, fadeMaximumChange, fadeTarget - fadeStart);
    userFadeCurrent.store(fadeEnd, std::memory_order_relaxed);
    const auto master = volume.load(std::memory_order_relaxed);
    buffer.applyGainRamp(0, samples, master * gainStart * fadeStart, master * gainEnd * fadeEnd);
}

juce::var PlaybackEngine::loadFile(const juce::String& filePath, const juce::String& playbackToken)
{
    onlineMode = false;
    std::unique_ptr<juce::AudioFormatReader> reader(audioFormats.createReaderFor(juce::File(filePath)));
    if (reader == nullptr) return result(false, "不支持或无法读取该音频文件");
    const auto sourceRate = reader->sampleRate;
    lastSourceRate = sourceRate;
    lastSourceRateDecision = "continuity-resample";
    if (hasLastKnownGood && lastKnownGoodIntent.sampleRateMode == "follow-source"
        && lastKnownGoodIntent.backend == "wasapi-exclusive" && deviceManager.getCurrentAudioDevice() != nullptr)
    {
        if (std::abs(deviceManager.getCurrentAudioDevice()->getCurrentSampleRate() - sourceRate) <= 0.5) {
            lastSourceRateDecision = "exclusive-follow-source-resident";
        } else {
            juce::DynamicObject transaction;
            transaction.setProperty("candidate", outputIntentToVar(lastKnownGoodIntent));
            transaction.setProperty("generation", lastKnownGoodIntent.generation + 1);
            transaction.setProperty("sourceSampleRateHint", sourceRate);
            const auto applied = applyOutputDeviceTransaction(transaction);
            if (const auto* response = applied.getDynamicObject())
                lastSourceRateDecision = response->getProperty("sampleRateDecision").toString();
        }
    }
    auto source = std::make_unique<juce::AudioFormatReaderSource>(reader.release(), true);
    if (!fileReadAheadThread.isThreadRunning() && !fileReadAheadThread.startThread())
        return result(false, "FILE_READ_AHEAD_THREAD_START_FAILED");
    stopActiveSource();
    const juce::ScopedLock lock(processLock);
    transport.setSource(nullptr);
    readerSource = std::move(source);
    transport.setSource(readerSource.get(), fileReadAheadSamples, &fileReadAheadThread, sourceRate);
    auto nextSource = std::make_unique<FileAudioSource>(transport, sourceRate);
    juce::String sourceError;
    if (!nextSource->prepare(sampleRate, blockSize, sourceError)) return result(false, sourceError);
    activeSource = std::move(nextSource);
    localPlaybackToken = playbackToken;
    return makeStatus(true);
}

juce::var PlaybackEngine::startBrowserPcm(const juce::String& transportName)
{
    auto nextSource = std::make_unique<BrowserPcmAudioSource>();
    juce::String sourceError;
    if (!nextSource->prepare(sampleRate, blockSize, sourceError)) return result(false, sourceError);
    const auto binaryTransport = transportName == "binaryPipe";
    nextSource->resetForNewSession(binaryTransport);
    stopActiveSource();
    transport.stop();
    const juce::ScopedLock lock(processLock);
    activeSource = std::move(nextSource);
    localPlaybackToken.clear();
    lastMediaSessionId.store(0, std::memory_order_relaxed);
    lastSequence.store(0, std::memory_order_relaxed);
    sequenceGapCount.store(0, std::memory_order_relaxed);
    maxPacketArrivalGapUs.store(0, std::memory_order_relaxed);
    lastPacketArrivalUs.store(0, std::memory_order_relaxed);
    nativePipePackets.store(0, std::memory_order_relaxed);
    nativePipeSequenceGaps.store(0, std::memory_order_relaxed);
    nativePipeSessionDrops.store(0, std::memory_order_relaxed);
    nativePipeDiscontinuities.store(0, std::memory_order_relaxed);
    onlineMode = true;
    return makeStatus(true);
}

juce::var PlaybackEngine::pipeInformation() const
{
    auto object = std::make_unique<juce::DynamicObject>();
    const auto available = browserPcmPipeServer != nullptr && browserPcmPipeServer->isReady();
    object->setProperty("ok", available);
    if (!available) object->setProperty("error", "PCM_PIPE_SERVER_UNAVAILABLE");
    if (browserPcmPipeServer != nullptr) {
        object->setProperty("pipeName", juce::String(browserPcmPipeServer->pipeName().c_str()));
        object->setProperty("nonce", juce::String(browserPcmPipeServer->nonce()));
    }
    return juce::var(object.release());
}

bool PlaybackEngine::handlePipePacket(const AuralisPcmProtocol::PacketMetadata& packet, const float* samples)
{
    const auto arrivalTimestamp = steadyClockMicros();
    auto currentSession = lastMediaSessionId.load(std::memory_order_relaxed);
    if (currentSession > 0 && packet.mediaSessionId < currentSession) {
        nativePipeSessionDrops.fetch_add(1, std::memory_order_relaxed);
        return true;
    }
    const juce::ScopedLock lock(processLock);
    auto* source = dynamic_cast<BrowserPcmAudioSource*>(activeSource.get());
    if (source == nullptr) return false;
    currentSession = lastMediaSessionId.load(std::memory_order_relaxed);
    if (currentSession > 0 && packet.mediaSessionId < currentSession) {
        nativePipeSessionDrops.fetch_add(1, std::memory_order_relaxed);
        return true;
    }
    if (currentSession == 0 || packet.mediaSessionId > currentSession) {
        lastMediaSessionId.store(packet.mediaSessionId, std::memory_order_relaxed);
        lastSequence.store(0, std::memory_order_relaxed);
        maxPacketArrivalGapUs.store(0, std::memory_order_relaxed);
        lastPacketArrivalUs.store(0, std::memory_order_relaxed);
        source->resetForNewSession(true);
    }
    const auto previousSequence = lastSequence.exchange(packet.sequence, std::memory_order_relaxed);
    if (previousSequence > 0 && packet.sequence != previousSequence + 1) {
        const auto gap = packet.sequence > previousSequence ? packet.sequence - previousSequence - 1 : 1;
        sequenceGapCount.fetch_add(gap, std::memory_order_relaxed);
        nativePipeSequenceGaps.fetch_add(gap, std::memory_order_relaxed);
    }
    const auto previousArrival = lastPacketArrivalUs.exchange(arrivalTimestamp, std::memory_order_relaxed);
    if (previousArrival > 0 && arrivalTimestamp > previousArrival)
        updateAtomicMaximum(maxPacketArrivalGapUs, arrivalTimestamp - previousArrival);
    if ((packet.flags & AuralisPcmProtocol::discontinuity) != 0)
        nativePipeDiscontinuities.fetch_add(1, std::memory_order_relaxed);
    if (source->pushInterleaved(samples, packet.frames, packet.channelCount, packet.sampleRate) != packet.frames)
        return false;
    nativePipePackets.fetch_add(1, std::memory_order_relaxed);
    pcmPacketsAccepted.fetch_add(1, std::memory_order_relaxed);
    return true;
}

bool PlaybackEngine::handleStreamCommand(const juce::var& command)
{
    const auto* object = command.getDynamicObject();
    if (object == nullptr || object->getProperty("type").toString() != "pcm-data") return false;
    const auto arrivalTimestamp = steadyClockMicros();
    const auto mediaSession = static_cast<uint64_t>(static_cast<juce::int64>(object->getProperty("mediaSessionId")));
    const auto sequence = static_cast<uint64_t>(static_cast<juce::int64>(object->getProperty("sequence")));
    if (mediaSession > 0 && mediaSession != lastMediaSessionId.load(std::memory_order_relaxed)) {
        lastMediaSessionId.store(mediaSession, std::memory_order_relaxed);
        lastSequence.store(0, std::memory_order_relaxed);
        sequenceGapCount.store(0, std::memory_order_relaxed);
        maxPacketArrivalGapUs.store(0, std::memory_order_relaxed);
        lastPacketArrivalUs.store(0, std::memory_order_relaxed);
    }
    if (sequence > 0) {
        const auto previousSequence = lastSequence.exchange(sequence, std::memory_order_relaxed);
        if (previousSequence > 0 && sequence != previousSequence + 1)
            sequenceGapCount.fetch_add(sequence > previousSequence ? sequence - previousSequence - 1 : 1,
                                      std::memory_order_relaxed);
    }
    const auto previousArrival = lastPacketArrivalUs.exchange(arrivalTimestamp, std::memory_order_relaxed);
    if (previousArrival > 0 && arrivalTimestamp > previousArrival)
        updateAtomicMaximum(maxPacketArrivalGapUs, arrivalTimestamp - previousArrival);
    const auto frames = static_cast<int>(object->getProperty("frames"));
    const auto channels = static_cast<int>(object->getProperty("channels"));
    const auto sourceRate = static_cast<double>(object->getProperty("sampleRate"));
    if (frames <= 0 || frames > 16384 || channels != 2 || sourceRate < 8000.0 || sourceRate > 384000.0) {
        pcmPacketsRejected.fetch_add(1, std::memory_order_relaxed);
        return true;
    }
    juce::MemoryOutputStream decoded;
    const auto decodeStarted = steadyClockMicros();
    const auto decodedOk = juce::Base64::convertFromBase64(decoded, object->getProperty("data").toString());
    base64DecodeTimeAggregateUs.fetch_add(steadyClockMicros() - decodeStarted, std::memory_order_relaxed);
    if (!decodedOk) {
        pcmPacketsRejected.fetch_add(1, std::memory_order_relaxed);
        return true;
    }
    const auto expectedBytes = static_cast<size_t>(frames * channels) * sizeof(float);
    if (decoded.getDataSize() != expectedBytes) {
        pcmPacketsRejected.fetch_add(1, std::memory_order_relaxed);
        return true;
    }
    const juce::ScopedLock lock(processLock);
    if (auto* source = dynamic_cast<BrowserPcmAudioSource*>(activeSource.get()); source != nullptr
        && source->pushInterleaved(static_cast<const float*>(decoded.getData()), frames, channels, sourceRate) == frames)
        pcmPacketsAccepted.fetch_add(1, std::memory_order_relaxed);
    else
        pcmPacketsRejected.fetch_add(1, std::memory_order_relaxed);
    return true;
}

juce::File PlaybackEngine::stateFileFor(const juce::String& pluginId) const
{
    if (pluginStateDirectory.isEmpty()) return {};
    const auto bytes = static_cast<size_t>(pluginId.getNumBytesAsUTF8());
    const auto key = stableStateHash(pluginId.toRawUTF8(), bytes);
    return juce::File(pluginStateDirectory).getChildFile(key + ".vststate");
}

bool PlaybackEngine::restorePluginState(juce::AudioPluginInstance& plugin, const juce::String& pluginId)
{
    const auto file = stateFileFor(pluginId);
    if (!file.existsAsFile() || file.getSize() <= 0 || file.getSize() > static_cast<juce::int64>(maximumPluginStateBytes)) return false;
    juce::MemoryBlock state;
    if (!file.loadFileAsData(state) || state.getSize() == 0 || state.getSize() > maximumPluginStateBytes) return false;
    try {
        plugin.setStateInformation(state.getData(), static_cast<int>(state.getSize()));
        pluginStateHashes[pluginId.toStdString()] = stableStateHash(state.getData(), state.getSize()).toStdString();
        return true;
    } catch (...) {
        return false;
    }
}

juce::var PlaybackEngine::savePluginStates(const juce::String& stateDirectory)
{
    if (stateDirectory.isNotEmpty()) pluginStateDirectory = stateDirectory;
    auto response = result(true);
    auto* object = response.getDynamicObject();
    if (pluginStateDirectory.isEmpty()) {
        object->setProperty("saved", 0);
        object->setProperty("unchanged", 0);
        object->setProperty("failed", 0);
        return response;
    }
    const juce::File directory(pluginStateDirectory);
    if (!directory.isDirectory() && !directory.createDirectory())
        return result(false, "无法创建 VST3 参数状态目录");

    int saved = 0, unchanged = 0, failed = 0;
    for (auto& hosted : plugins) {
        if (hosted.instance == nullptr) continue;
        juce::MemoryBlock state;
        {
            // Plugin state APIs stay on the existing message thread and are
            // serialized with processing. Only the snapshot needs that lock;
            // hashing and disk IO below must never hold up the audio callback.
            const juce::ScopedLock lock(processLock);
            try { hosted.instance->getStateInformation(state); }
            catch (...) { ++failed; continue; }
        }
        if (state.getSize() == 0) { ++unchanged; continue; }
        if (state.getSize() > maximumPluginStateBytes) { ++failed; continue; }
        const auto hash = stableStateHash(state.getData(), state.getSize()).toStdString();
        const auto key = hosted.id.toStdString();
        const auto target = stateFileFor(hosted.id);
        const auto known = pluginStateHashes.find(key);
        if (known != pluginStateHashes.end() && known->second == hash && target.existsAsFile()) {
            ++unchanged;
            continue;
        }
        juce::TemporaryFile temporary(target);
        if (temporary.getFile().replaceWithData(state.getData(), state.getSize())
            && temporary.overwriteTargetFileWithTemporary()) {
            pluginStateHashes[key] = hash;
            ++saved;
        } else ++failed;
    }
    object->setProperty("saved", saved);
    object->setProperty("unchanged", unchanged);
    object->setProperty("failed", failed);
    return response;
}

juce::var PlaybackEngine::loadRack(const juce::Array<juce::var>& rack, const juce::String& stateDirectory)
{
    if (stateDirectory.isNotEmpty()) pluginStateDirectory = stateDirectory;
    std::vector<juce::String> requestedIds;
    for (const auto& item : rack)
        if (const auto* object = item.getDynamicObject(); object != nullptr && static_cast<bool>(object->getProperty("enabled")))
            requestedIds.push_back(object->getProperty("id").toString());
    bool unchanged = requestedIds.size() == plugins.size();
    for (size_t i = 0; unchanged && i < requestedIds.size(); ++i)
        unchanged = plugins[i].id == requestedIds[i];
    if (unchanged) return makeStatus(true);
    if (!plugins.empty() && pluginStateDirectory.isNotEmpty()) savePluginStates();

    struct PendingPlugin {
        juce::String id;
        int existingIndex = -1;
        std::unique_ptr<juce::AudioPluginInstance> newInstance;
    };
    std::vector<PendingPlugin> pending;
    for (const auto& item : rack)
    {
        const auto* object = item.getDynamicObject();
        if (object == nullptr || !static_cast<bool>(object->getProperty("enabled"))) continue;
        const auto pluginPath = object->getProperty("path").toString();
        const auto pluginId = object->getProperty("id").toString();
        const auto existing = std::find_if(plugins.begin(), plugins.end(), [&](const auto& plugin) { return plugin.id == pluginId; });
        if (existing != plugins.end()) {
            pending.push_back({ pluginId, static_cast<int>(std::distance(plugins.begin(), existing)), nullptr });
            continue;
        }
        juce::OwnedArray<juce::PluginDescription> descriptions;
        for (auto* format : pluginFormats.getFormats())
            if (format->fileMightContainThisPluginType(pluginPath))
                format->findAllTypesForFile(descriptions, pluginPath);
        const juce::PluginDescription* selected = nullptr;
        for (const auto* description : descriptions)
            if (description->createIdentifierString() == pluginId) selected = description;
        if (selected == nullptr) return result(false, "插件描述符不存在: " + pluginId);
        juce::String error;
        auto plugin = pluginFormats.createPluginInstance(*selected, sampleRate, blockSize, error);
        if (plugin == nullptr) return result(false, error.isNotEmpty() ? error : "插件实例化失败");
        if (!configureStereoEffect(*plugin, sampleRate, blockSize, error))
            return result(false, error + ": " + plugin->getName());
        restorePluginState(*plugin, pluginId);
        pending.push_back({ pluginId, -1, std::move(plugin) });
    }
    const juce::ScopedLock lock(processLock);
    std::vector<HostedPlugin> nextPlugins;
    nextPlugins.reserve(pending.size());
    std::vector<bool> reused(plugins.size(), false);
    for (auto& item : pending) {
        if (item.existingIndex >= 0) {
            const auto index = static_cast<size_t>(item.existingIndex);
            reused[index] = true;
            nextPlugins.push_back(std::move(plugins[index]));
        } else {
            nextPlugins.push_back({ item.id, std::move(item.newInstance) });
        }
    }
    for (size_t index = 0; index < plugins.size(); ++index)
        if (!reused[index] && plugins[index].instance != nullptr)
            retiredPlugins.push_back(std::move(plugins[index]));
    std::vector<std::unique_ptr<EnginePluginWindow>> retainedWindows;
    for (auto& window : editorWindows) {
        const auto retained = std::find(requestedIds.begin(), requestedIds.end(), window->getPluginIdentifier()) != requestedIds.end();
        if (retained) retainedWindows.push_back(std::move(window));
        else {
            window->setVisible(false);
            retiredEditorWindows.push_back(std::move(window));
        }
    }
    editorWindows = std::move(retainedWindows);
    plugins = std::move(nextPlugins);
    int latencySamples = 0;
    for (const auto& plugin : plugins) latencySamples += std::max(0, plugin.instance->getLatencySamples());
    pluginLatencySamples.store(latencySamples, std::memory_order_relaxed);
    return makeStatus(true);
}

juce::var PlaybackEngine::makeStatus(bool ok, const juce::String& error, bool analysis) const
{
    if (directOutput) return directOutput->status(localPlaybackToken, analysis);
    auto object = std::make_unique<juce::DynamicObject>();
    AuralisVersion::appendTo(*object);
    object->setProperty("ok", ok);
    if (error.isNotEmpty()) object->setProperty("error", error);
    object->setProperty("playing", activeSource && activeSource->isActive());
    object->setProperty("position", transport.getCurrentPosition());
    object->setProperty("duration", transport.getLengthInSeconds());
    object->setProperty("playbackToken", localPlaybackToken);
    object->setProperty("sampleRate", sampleRate);
    object->setProperty("bufferSize", blockSize);
    object->setProperty("plugins", static_cast<int>(plugins.size()));
    object->setProperty("processingMode", plugins.empty() ? "dry" : "vst");
    object->setProperty("fadeMs", userFadeMs.load(std::memory_order_relaxed));
    object->setProperty("sourceRateDecision", lastSourceRateDecision);
    object->setProperty("lastSourceSampleRate", lastSourceRate);
    const auto cachedPluginLatency = pluginLatencySamples.load(std::memory_order_relaxed);
    object->setProperty("pluginLatencySamples", cachedPluginLatency);
    object->setProperty("lastMediaSessionId", static_cast<juce::int64>(lastMediaSessionId.load(std::memory_order_relaxed)));
    object->setProperty("lastSequence", static_cast<juce::int64>(lastSequence.load(std::memory_order_relaxed)));
    object->setProperty("sequenceGapCount", static_cast<juce::int64>(sequenceGapCount.load(std::memory_order_relaxed)));
    object->setProperty("maxPacketArrivalGapUs", static_cast<juce::int64>(maxPacketArrivalGapUs.load(std::memory_order_relaxed)));
    object->setProperty("base64DecodeTimeAggregateUs", static_cast<juce::int64>(base64DecodeTimeAggregateUs.load(std::memory_order_relaxed)));
    object->setProperty("base64DecodeTimeAggregate", static_cast<juce::int64>(base64DecodeTimeAggregateUs.load(std::memory_order_relaxed)));
    object->setProperty("pcmPacketsAccepted", static_cast<juce::int64>(pcmPacketsAccepted.load(std::memory_order_relaxed)));
    object->setProperty("pcmPacketsRejected", static_cast<juce::int64>(pcmPacketsRejected.load(std::memory_order_relaxed)));
    object->setProperty("nativePackets", static_cast<juce::int64>(nativePipePackets.load(std::memory_order_relaxed)));
    object->setProperty("nativeSequenceGaps", static_cast<juce::int64>(nativePipeSequenceGaps.load(std::memory_order_relaxed)));
    object->setProperty("nativeSessionDrops", static_cast<juce::int64>(nativePipeSessionDrops.load(std::memory_order_relaxed)));
    object->setProperty("nativeDiscontinuities", static_cast<juce::int64>(nativePipeDiscontinuities.load(std::memory_order_relaxed)));
    if (browserPcmPipeServer != nullptr) {
        object->setProperty("pipeConnections", static_cast<juce::int64>(browserPcmPipeServer->connectionCount()));
        object->setProperty("pipeReadFailures", static_cast<juce::int64>(browserPcmPipeServer->readFailureCount()));
        object->setProperty("pipeInvalidPackets", static_cast<juce::int64>(browserPcmPipeServer->invalidPacketCount()));
    }
    object->setProperty("callbackCount", static_cast<juce::int64>(callbackCount.load(std::memory_order_relaxed)));
    object->setProperty("callbackMaxGapUs", static_cast<juce::int64>(callbackMaxGapUs.load(std::memory_order_relaxed)));
    juce::Array<juce::var> pluginIds;
    for (const auto& plugin : plugins) pluginIds.add(plugin.id);
    object->setProperty("pluginIds", pluginIds);
    if (activeSource) activeSource->appendStatus(*object);
    else { object->setProperty("source", "none"); object->setProperty("sourceState", "stopped"); }
    if (!analysis) return juce::var(object.release());
    constexpr int fftSize = 512;
    constexpr int frequencyBins = 256;
    std::array<float, fftSize> mono {};
    juce::Array<juce::var> leftWaveform, rightWaveform, frequency;
    const auto end = analysisWritePosition.load(std::memory_order_acquire);
    double sumSquares = 0.0;
    float peak = 0.0f, leftPeak = 0.0f, rightPeak = 0.0f;
    for (int i = 0; i < fftSize; ++i) {
        const auto absolute = end >= fftSize ? end - fftSize + static_cast<uint64_t>(i) : static_cast<uint64_t>(i);
        const auto index = static_cast<size_t>(absolute % analysisCapacity);
        const auto left = analysisLeft[index].load(std::memory_order_relaxed);
        const auto right = analysisRight[index].load(std::memory_order_relaxed);
        mono[static_cast<size_t>(i)] = 0.5f * (left + right);
        sumSquares += 0.5 * (static_cast<double>(left) * left + static_cast<double>(right) * right);
        leftPeak = juce::jmax(leftPeak, std::abs(left));
        rightPeak = juce::jmax(rightPeak, std::abs(right));
        peak = juce::jmax(peak, juce::jmax(leftPeak, rightPeak));
        if ((i & 1) == 0) {
            leftWaveform.add(left);
            rightWaveform.add(right);
        }
    }
    // Iterative radix-2 FFT is several orders cheaper than evaluating a full
    // trigonometric DFT for every status packet.
    constexpr double twoPi = juce::MathConstants<double>::twoPi;
    std::array<std::complex<double>, fftSize> spectrum {};
    for (int i = 0; i < fftSize; ++i) {
        const auto window = 0.5 - 0.5 * std::cos(twoPi * i / (fftSize - 1));
        spectrum[static_cast<size_t>(i)] = mono[static_cast<size_t>(i)] * window;
    }
    for (int i = 1, j = 0; i < fftSize; ++i) {
        int bit = fftSize >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) std::swap(spectrum[static_cast<size_t>(i)], spectrum[static_cast<size_t>(j)]);
    }
    for (int length = 2; length <= fftSize; length <<= 1) {
        const std::complex<double> step = std::polar(1.0, -twoPi / length);
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
    double lowPower = 0.0, midPower = 0.0, highPower = 0.0;
    int lowBins = 0, midBins = 0, highBins = 0;
    for (int bin = 0; bin < frequencyBins; ++bin) {
        // N/2 is the coherent-gain correction for the Hann-windowed FFT.
        const auto magnitude = std::abs(spectrum[static_cast<size_t>(bin)]) / (fftSize * 0.5);
        // Frequency bins are naturally much smaller than time-domain peaks.
        // Use a moderate -90..-10 dB display window: wider than Web Audio's
        // aggressive default, but perceptually useful without pinning bars.
        const auto decibels = 20.0 * std::log10(juce::jmax(1.0e-8, magnitude));
        const auto display = juce::jlimit(0.0, 1.0, (decibels + 90.0) / 80.0);
        frequency.add(static_cast<int>(std::round(display * 255.0)));
        const auto hz = static_cast<double>(bin) * sampleRate / fftSize;
        if (hz >= 20.0 && hz < 250.0) { lowPower += magnitude * magnitude; ++lowBins; }
        else if (hz < 4000.0) { midPower += magnitude * magnitude; ++midBins; }
        else if (hz < 16000.0) { highPower += magnitude * magnitude; ++highBins; }
    }
    object->setProperty("nativeFrequency", frequency);
    object->setProperty("nativeLeft", leftWaveform);
    object->setProperty("nativeRight", rightWaveform);
    object->setProperty("nativePeak", peak);
    object->setProperty("nativeLeftPeak", leftPeak);
    object->setProperty("nativeRightPeak", rightPeak);
    object->setProperty("nativeRms", std::sqrt(sumSquares / fftSize));
    object->setProperty("nativeLow", lowBins > 0 ? std::sqrt(lowPower / lowBins) : 0.0);
    object->setProperty("nativeMid", midBins > 0 ? std::sqrt(midPower / midBins) : 0.0);
    object->setProperty("nativeHigh", highBins > 0 ? std::sqrt(highPower / highBins) : 0.0);
    if (auto* device = deviceManager.getCurrentAudioDevice()) object->setProperty("device", device->getName());
    return juce::var(object.release());
}

juce::var PlaybackEngine::handleCommand(const juce::var& command)
{
    const auto* object = command.getDynamicObject();
    if (object == nullptr) return result(false, "无效命令");
    const auto type = object->getProperty("type").toString();
    if (type == "status") {
        // Query on the message thread: plugins can change latency after loading.
        int latencySamples = 0;
        for (const auto& plugin : plugins) latencySamples += std::max(0, plugin.instance->getLatencySamples());
        pluginLatencySamples.store(latencySamples, std::memory_order_relaxed);
        const bool analysis = !object->hasProperty("analysis") || static_cast<bool>(object->getProperty("analysis"));
        analysisRequested.store(analysis, std::memory_order_relaxed);
        return makeStatus(true, {}, analysis);
    }
    if (type == "direct-analysis") {
        if (!directOutput || object->getProperty("playbackToken").toString() != localPlaybackToken)
            return result(false, "STALE_ANALYSIS_SOURCE");
        return result(directOutput->setAnalysisFile(object->getProperty("path").toString()));
    }
    if (type == "direct-probe") return HdmiDirectOutput::probe(object->getProperty("endpointId").toString());
    if (type == "direct-load") {
        stopActiveSource();
        pauseAfterFadeAtUs = 0;
        directOutput.reset();
        deviceManager.closeAudioDevice();
        onlineMode = false;
        localPlaybackToken = object->getProperty("playbackToken").toString();
        directOutput = std::make_unique<HdmiDirectOutput>();
        const auto error = directOutput->open(object->getProperty("directFormat"), object->getProperty("endpointId").toString());
        if (error.isNotEmpty()) return result(false, error); // fail closed, no shared/PCM fallback
        return makeStatus(true);
    }
    if (type == "direct-close" || type == "load" || type == "pcm-start" || type == "device-apply" || type == "output") {
        if (directOutput) { directOutput.reset(); deviceManager.restartLastAudioDevice(); }
        if (type == "direct-close") return makeStatus(true);
    }
    if (directOutput) {
        if (type == "play") directOutput->play();
        else if (type == "pause") directOutput->pause();
        else if (type == "seek") directOutput->seek(static_cast<double>(object->getProperty("position")));
        else if (type == "rack") return makeStatus(true);
        else if (type == "editor") return result(false, "HDMI_DIRECT_BYPASSES_VST");
        else if (type == "device-status") return directOutput->status(localPlaybackToken);
        if (type == "play" || type == "pause" || type == "seek" || type == "volume" || type == "fade" || type == "status") return makeStatus(true);
    }
    if (type == "load") return loadFile(object->getProperty("path").toString(), object->getProperty("playbackToken").toString());
    if (type == "device-enumerate") return enumerateOutputDevices();
    if (type == "device-capabilities") return outputDeviceCapabilities(*object);
    if (type == "device-status") return outputDeviceStatus();
    if (type == "device-apply") return applyOutputDeviceTransaction(*object);
    if (type == "pcm-start") return startBrowserPcm(object->getProperty("onlinePcmTransport").toString());
    if (type == "pcm-pipe-info") return pipeInformation();
    if (type == "pcm-stop") {
        const juce::ScopedLock lock(processLock);
        if (activeSource && activeSource->kind() == AuralisAudioSourceKind::browserPcm) {
            activeSource->stop();
            activeSource.reset();
        }
        localPlaybackToken.clear();
        onlineMode = false;
        return makeStatus(true);
    }
    if (type == "output") {
        const auto requested = object->getProperty("name").toString();
        auto* deviceType = deviceManager.getCurrentDeviceTypeObject();
        if (deviceType == nullptr) return result(false, "NO_ACTIVE_AUDIO_BACKEND");
        deviceType->scanForDevices();
        const auto names = deviceType->getDeviceNames(false);
        auto exactName = requested;
        if (exactName.isEmpty()) {
            const auto defaultIndex = deviceType->getDefaultDeviceIndex(false);
            if (!juce::isPositiveAndBelow(defaultIndex, names.size())) return result(false, "DEFAULT_OUTPUT_NOT_FOUND");
            exactName = names[defaultIndex];
        }
        if (!names.contains(exactName)) return result(false, "OUTPUT_DEVICE_NOT_FOUND: " + requested);
        auto candidate = std::make_unique<juce::DynamicObject>();
        candidate->setProperty("backend", backendKindForType(deviceType->getTypeName()));
        candidate->setProperty("juceDeviceName", exactName);
        candidate->setProperty("sampleRateMode", "system");
        candidate->setProperty("bufferMode", "auto");
        candidate->setProperty("exclusiveFallback", "shared-low-latency");
#if JUCE_WINDOWS
        const auto identity = windowsEndpointIdentityForFriendlyName(exactName);
        if (identity.status == "stable-windows-endpoint-id") candidate->setProperty("platformEndpointId", identity.endpointId);
#endif
        juce::DynamicObject transaction;
        transaction.setProperty("candidate", juce::var(candidate.release()));
        transaction.setProperty("generation", object->getProperty("generation"));
        return applyOutputDeviceTransaction(transaction);
    }
    if (type == "rack") {
        if (const auto* rack = object->getProperty("plugins").getArray())
            return loadRack(*rack, object->getProperty("stateDirectory").toString());
        return result(false, "插件机架数据无效");
    }
    if (type == "state-save") {
        if (static_cast<bool>(object->getProperty("closeEditors"))) {
            // Remove native peers while their Electron owner still exists.
            for (auto& window : editorWindows) { window->setVisible(false); window->removeFromDesktop(); }
            for (auto& window : retiredEditorWindows) { window->setVisible(false); window->removeFromDesktop(); }
            editorWindows.clear();
            retiredEditorWindows.clear();
        }
        return savePluginStates(object->getProperty("stateDirectory").toString());
    }
    if (type == "editor") {
        const auto pluginId = object->getProperty("id").toString();
        for (auto& window : editorWindows) {
            if (window->getPluginIdentifier() == pluginId) { window->setVisible(true); window->toFront(true); return makeStatus(true); }
        }
        for (auto& plugin : plugins) {
            if (plugin.id == pluginId) {
                const auto owner = static_cast<std::uintptr_t>(static_cast<juce::int64>(object->getProperty("owner")));
                editorWindows.push_back(std::make_unique<EnginePluginWindow>(*plugin.instance, owner, plugin.id));
                return makeStatus(true);
            }
        }
        return result(false, "PLUGIN_NOT_IN_LIVE_CHAIN");
    }
    if (type == "play") {
        pauseAfterFadeAtUs.store(0, std::memory_order_relaxed);
        const auto fade = userFadeMs.load(std::memory_order_relaxed);
        userFadeCurrent.store(fade > 0 ? 0.0f : 1.0f, std::memory_order_relaxed);
        userFadeTarget.store(1.0f, std::memory_order_relaxed);
        juce::String sourceError;
        if (activeSource && !activeSource->start(sourceError)) return result(false, sourceError);
    }
    else if (type == "pause") {
        const auto fade = userFadeMs.load(std::memory_order_relaxed);
        if (activeSource && fade > 0 && activeSource->isActive()) {
            userFadeTarget.store(0.0f, std::memory_order_relaxed);
            pauseAfterFadeAtUs.store(steadyClockMicros() + static_cast<uint64_t>(fade) * 1000ull, std::memory_order_relaxed);
        } else stopActiveSource();
    }
    else if (type == "seek") transport.setPosition(static_cast<double>(object->getProperty("position")));
    else if (type == "volume") volume.store(juce::jlimit(0.0f, 1.0f, static_cast<float>(object->getProperty("value"))), std::memory_order_relaxed);
    else if (type == "fade") {
        const auto duration = juce::jlimit(0, 5000, static_cast<int>(object->getProperty("durationMs")));
        userFadeMs.store(duration, std::memory_order_relaxed);
        if (duration == 0) {
            pauseAfterFadeAtUs.store(0, std::memory_order_relaxed);
            userFadeCurrent.store(1.0f, std::memory_order_relaxed);
            userFadeTarget.store(1.0f, std::memory_order_relaxed);
        }
    }
    else if (type != "status") return result(false, "未知命令: " + type);
    return makeStatus(true);
}
