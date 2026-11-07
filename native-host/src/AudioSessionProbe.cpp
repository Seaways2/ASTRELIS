#include "AudioSessionProbe.h"

#if defined(_WIN32)

#include <juce_core/juce_core.h>
#include <windows.h>
#include <audiopolicy.h>
#include <endpointvolume.h>
#include <propsys.h>
#include <functiondiscoverykeys_devpkey.h>
#include <mmdeviceapi.h>
#include <wbemidl.h>
#include <wrl.h>
#include <algorithm>
#include <chrono>
#include <iostream>
#include <map>
#include <thread>
#include <unordered_map>

using Microsoft::WRL::ComPtr;

namespace {
struct ProcessMetadata
{
    DWORD processId = 0;
    DWORD parentProcessId = 0;
    juce::String name;
    juce::String executablePath;
    juce::String commandLine;
    juce::String role;
};

struct SessionAggregate
{
    DWORD processId = 0;
    juce::String processName;
    juce::String processRole;
    juce::String sessionIdentifier;
    int samples = 0;
    int activeSamples = 0;
    int audibleSamples = 0;
    float maximumPeak = 0.0f;
};

juce::String variantString(VARIANT& value)
{
    return value.vt == VT_BSTR && value.bstrVal != nullptr ? juce::String(value.bstrVal) : juce::String();
}

DWORD variantDword(VARIANT& value)
{
    if (value.vt == VT_I4 || value.vt == VT_INT) return static_cast<DWORD>(value.lVal);
    if (value.vt == VT_UI4 || value.vt == VT_UINT) return static_cast<DWORD>(value.ulVal);
    return 0;
}

juce::String classifyProcess(const ProcessMetadata& process)
{
    const auto name = process.name.toLowerCase();
    const auto command = process.commandLine.toLowerCase();
    if (name == "auralispluginhost.exe") return "auralis-native-vst-host";
    if (name == "audiodg.exe") return "windows-audio-engine";
    if (name != "electron.exe") return name.isNotEmpty() ? "external-application" : "unknown";
    if (command.contains("--utility-sub-type=audio.mojom.audioservice")) return "electron-audio-service";
    if (command.contains("--type=renderer")) return "electron-renderer";
    if (command.contains("--type=gpu-process")) return "electron-gpu-process";
    if (command.contains("--type=utility")) return "electron-utility-process";
    if (!command.contains("--type=")) return "electron-browser-main";
    return "electron-other";
}

std::unordered_map<DWORD, ProcessMetadata> enumerateProcesses()
{
    std::unordered_map<DWORD, ProcessMetadata> processes;
    ComPtr<IWbemLocator> locator;
    ComPtr<IWbemServices> services;
    if (FAILED(CoCreateInstance(CLSID_WbemLocator, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&locator))))
        return processes;

    BSTR root = SysAllocString(L"ROOT\\CIMV2");
    const auto connectResult = locator->ConnectServer(root, nullptr, nullptr, nullptr, 0, nullptr, nullptr, &services);
    SysFreeString(root);
    if (FAILED(connectResult)) return processes;

    const auto blanketResult = CoSetProxyBlanket(services.Get(), RPC_C_AUTHN_WINNT, RPC_C_AUTHZ_NONE, nullptr,
                                                  RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE,
                                                  nullptr, EOAC_NONE);
    if (FAILED(blanketResult)) return processes;

    BSTR language = SysAllocString(L"WQL");
    BSTR query = SysAllocString(L"SELECT ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine FROM Win32_Process");
    ComPtr<IEnumWbemClassObject> enumerator;
    const auto queryResult = services->ExecQuery(language, query,
        WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY, nullptr, &enumerator);
    SysFreeString(query);
    SysFreeString(language);
    if (FAILED(queryResult) || enumerator == nullptr) return processes;

    while (true)
    {
        ComPtr<IWbemClassObject> item;
        ULONG returned = 0;
        if (FAILED(enumerator->Next(1000, 1, &item, &returned)) || returned == 0) break;

        VARIANT processId{}, parentId{}, name{}, executable{}, command{};
        VariantInit(&processId); VariantInit(&parentId); VariantInit(&name);
        VariantInit(&executable); VariantInit(&command);
        item->Get(L"ProcessId", 0, &processId, nullptr, nullptr);
        item->Get(L"ParentProcessId", 0, &parentId, nullptr, nullptr);
        item->Get(L"Name", 0, &name, nullptr, nullptr);
        item->Get(L"ExecutablePath", 0, &executable, nullptr, nullptr);
        item->Get(L"CommandLine", 0, &command, nullptr, nullptr);
        ProcessMetadata metadata;
        metadata.processId = variantDword(processId);
        metadata.parentProcessId = variantDword(parentId);
        metadata.name = variantString(name);
        metadata.executablePath = variantString(executable);
        metadata.commandLine = variantString(command);
        metadata.role = classifyProcess(metadata);
        if (metadata.processId > 0) processes[metadata.processId] = std::move(metadata);
        VariantClear(&processId); VariantClear(&parentId); VariantClear(&name);
        VariantClear(&executable); VariantClear(&command);
    }
    return processes;
}

juce::String sessionStateText(AudioSessionState state)
{
    switch (state) {
        case AudioSessionStateActive: return "active";
        case AudioSessionStateInactive: return "inactive";
        case AudioSessionStateExpired: return "expired";
        default: return "unknown";
    }
}

juce::String takeAndFree(LPWSTR value)
{
    if (value == nullptr) return {};
    const juce::String result(value);
    CoTaskMemFree(value);
    return result;
}

juce::String endpointName(IMMDevice& endpoint)
{
    ComPtr<IPropertyStore> properties;
    if (FAILED(endpoint.OpenPropertyStore(STGM_READ, &properties))) return {};
    PROPVARIANT value;
    PropVariantInit(&value);
    const auto result = properties->GetValue(PKEY_Device_FriendlyName, &value);
    const juce::String name = SUCCEEDED(result) && value.vt == VT_LPWSTR && value.pwszVal != nullptr
        ? juce::String(value.pwszVal) : juce::String();
    PropVariantClear(&value);
    return name;
}

juce::var makeSessionSnapshot(IAudioSessionManager2& manager,
                              const std::unordered_map<DWORD, ProcessMetadata>& processes,
                              std::map<std::string, SessionAggregate>& aggregates)
{
    juce::Array<juce::var> sessions;
    ComPtr<IAudioSessionEnumerator> enumerator;
    if (FAILED(manager.GetSessionEnumerator(&enumerator))) return sessions;
    int count = 0;
    if (FAILED(enumerator->GetCount(&count))) return sessions;
    for (int index = 0; index < count; ++index)
    {
        ComPtr<IAudioSessionControl> control;
        ComPtr<IAudioSessionControl2> control2;
        if (FAILED(enumerator->GetSession(index, &control)) || FAILED(control.As(&control2))) continue;
        DWORD processId = 0;
        AudioSessionState state = AudioSessionStateExpired;
        control2->GetProcessId(&processId);
        control2->GetState(&state);
        LPWSTR displayNameRaw = nullptr, identifierRaw = nullptr, instanceRaw = nullptr;
        control2->GetDisplayName(&displayNameRaw);
        control2->GetSessionIdentifier(&identifierRaw);
        control2->GetSessionInstanceIdentifier(&instanceRaw);
        const auto displayName = takeAndFree(displayNameRaw);
        const auto identifier = takeAndFree(identifierRaw);
        const auto instanceIdentifier = takeAndFree(instanceRaw);
        const bool systemSounds = control2->IsSystemSoundsSession() == S_OK;
        float peak = 0.0f;
        ComPtr<IAudioMeterInformation> meter;
        if (SUCCEEDED(control.As(&meter))) meter->GetPeakValue(&peak);

        ProcessMetadata process;
        if (const auto found = processes.find(processId); found != processes.end()) process = found->second;
        else { process.processId = processId; process.role = systemSounds ? "system-sounds" : "unknown"; }

        auto object = std::make_unique<juce::DynamicObject>();
        object->setProperty("pid", static_cast<juce::int64>(processId));
        object->setProperty("parentPid", static_cast<juce::int64>(process.parentProcessId));
        object->setProperty("processName", process.name);
        object->setProperty("processRole", process.role);
        object->setProperty("executablePath", process.executablePath);
        object->setProperty("commandLine", process.commandLine);
        object->setProperty("sessionState", sessionStateText(state));
        object->setProperty("peak", peak);
        object->setProperty("displayName", displayName);
        object->setProperty("sessionIdentifier", identifier);
        object->setProperty("sessionInstanceIdentifier", instanceIdentifier);
        object->setProperty("systemSounds", systemSounds);
        sessions.add(juce::var(object.release()));

        const auto key = instanceIdentifier.isNotEmpty()
            ? instanceIdentifier.toStdString()
            : (juce::String(processId) + ":" + identifier).toStdString();
        auto& aggregate = aggregates[key];
        aggregate.processId = processId;
        aggregate.processName = process.name;
        aggregate.processRole = process.role;
        aggregate.sessionIdentifier = identifier;
        ++aggregate.samples;
        if (state == AudioSessionStateActive) ++aggregate.activeSamples;
        if (peak > 1.0e-5f) ++aggregate.audibleSamples;
        aggregate.maximumPeak = std::max(aggregate.maximumPeak, peak);
    }
    return sessions;
}
}

int runAudioSessionProbe(int durationSeconds, int intervalMilliseconds)
{
    const auto comResult = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    const bool uninitialiseCom = comResult == S_OK || comResult == S_FALSE;
    if (FAILED(comResult) && comResult != RPC_E_CHANGED_MODE) {
        std::cerr << "AUDIO_SESSION_PROBE_COM_INIT_FAILED" << std::endl;
        return 20;
    }
    const auto securityResult = CoInitializeSecurity(nullptr, -1, nullptr, nullptr,
        RPC_C_AUTHN_LEVEL_DEFAULT, RPC_C_IMP_LEVEL_IMPERSONATE, nullptr, EOAC_NONE, nullptr);
    juce::ignoreUnused(securityResult);

    ComPtr<IMMDeviceEnumerator> deviceEnumerator;
    ComPtr<IMMDevice> endpoint;
    ComPtr<IAudioSessionManager2> sessionManager;
    auto result = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&deviceEnumerator));
    if (SUCCEEDED(result)) result = deviceEnumerator->GetDefaultAudioEndpoint(eRender, eConsole, &endpoint);
    if (SUCCEEDED(result)) result = endpoint->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr,
                                                       reinterpret_cast<void**>(sessionManager.GetAddressOf()));
    if (FAILED(result)) {
        std::cerr << "AUDIO_SESSION_PROBE_ENDPOINT_FAILED: " << std::hex << result << std::endl;
        if (uninitialiseCom) CoUninitialize();
        return 21;
    }

    LPWSTR endpointIdRaw = nullptr;
    endpoint->GetId(&endpointIdRaw);
    const auto endpointId = takeAndFree(endpointIdRaw);
    const auto friendlyName = endpointName(*endpoint.Get());
    durationSeconds = std::clamp(durationSeconds, 0, 3600);
    intervalMilliseconds = std::clamp(intervalMilliseconds, 100, 10000);
    const int samples = durationSeconds == 0 ? 1 : std::max(1, durationSeconds * 1000 / intervalMilliseconds);
    std::map<std::string, SessionAggregate> aggregates;
    const auto start = std::chrono::steady_clock::now();
    for (int sample = 0; sample < samples; ++sample)
    {
        const auto processes = enumerateProcesses();
        auto snapshot = std::make_unique<juce::DynamicObject>();
        snapshot->setProperty("type", "audio-session-snapshot");
        snapshot->setProperty("sampleIndex", sample);
        snapshot->setProperty("elapsedMs", static_cast<juce::int64>(std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - start).count()));
        snapshot->setProperty("endpointName", friendlyName);
        snapshot->setProperty("endpointId", endpointId);
        snapshot->setProperty("sessions", makeSessionSnapshot(*sessionManager.Get(), processes, aggregates));
        std::cout << juce::JSON::toString(juce::var(snapshot.release()), true).toStdString() << std::endl;
        if (sample + 1 < samples) std::this_thread::sleep_for(std::chrono::milliseconds(intervalMilliseconds));
    }

    std::vector<SessionAggregate> ranked;
    ranked.reserve(aggregates.size());
    for (const auto& [key, aggregate] : aggregates) { juce::ignoreUnused(key); ranked.push_back(aggregate); }
    std::sort(ranked.begin(), ranked.end(), [](const auto& left, const auto& right) {
        if (left.audibleSamples != right.audibleSamples) return left.audibleSamples > right.audibleSamples;
        return left.maximumPeak > right.maximumPeak;
    });
    juce::Array<juce::var> candidates;
    int rank = 1;
    for (const auto& aggregate : ranked)
    {
        auto candidate = std::make_unique<juce::DynamicObject>();
        candidate->setProperty("rank", rank++);
        candidate->setProperty("pid", static_cast<juce::int64>(aggregate.processId));
        candidate->setProperty("processName", aggregate.processName);
        candidate->setProperty("processRole", aggregate.processRole);
        candidate->setProperty("sessionIdentifier", aggregate.sessionIdentifier);
        candidate->setProperty("samples", aggregate.samples);
        candidate->setProperty("activeSamples", aggregate.activeSamples);
        candidate->setProperty("audibleSamples", aggregate.audibleSamples);
        candidate->setProperty("maximumPeak", aggregate.maximumPeak);
        candidates.add(juce::var(candidate.release()));
    }
    auto summary = std::make_unique<juce::DynamicObject>();
    summary->setProperty("type", "audio-session-probe-summary");
    summary->setProperty("endpointName", friendlyName);
    summary->setProperty("endpointId", endpointId);
    summary->setProperty("durationSeconds", durationSeconds);
    summary->setProperty("intervalMilliseconds", intervalMilliseconds);
    summary->setProperty("candidates", candidates);
    std::cout << juce::JSON::toString(juce::var(summary.release()), true).toStdString() << std::endl;
    if (uninitialiseCom) CoUninitialize();
    return 0;
}

#else

int runAudioSessionProbe(int, int) { return 22; }

#endif
