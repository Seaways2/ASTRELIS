#include "ProcessPowerThrottlingProbe.h"

#include <juce_core/juce_core.h>

#if defined(_WIN32)

#include <windows.h>
#include <tlhelp32.h>
#include <winternl.h>
#include <cerrno>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <unordered_map>

#ifndef PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION
#define PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION 0x4
#endif

namespace {
constexpr std::uint64_t windowsToUnixEpochMs = 11644473600000ULL;
constexpr DWORD minimumSupportedBuild = 22621;

struct PowerState final
{
    ULONG version = PROCESS_POWER_THROTTLING_CURRENT_VERSION;
    ULONG controlMask = 0;
    ULONG stateMask = 0;
};

juce::String flagState(const PowerState& state, ULONG flag)
{
    if ((state.controlMask & flag) == 0) return "unset";
    return (state.stateMask & flag) != 0 ? "enabled" : "disabled";
}

juce::var stateValue(const PowerState& state)
{
    auto object = std::make_unique<juce::DynamicObject>();
    object->setProperty("version", static_cast<juce::int64>(state.version));
    object->setProperty("controlMask", static_cast<juce::int64>(state.controlMask));
    object->setProperty("stateMask", static_cast<juce::int64>(state.stateMask));
    object->setProperty("timerResolution", flagState(state, PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION));
    object->setProperty("executionSpeed", flagState(state, PROCESS_POWER_THROTTLING_EXECUTION_SPEED));
    return juce::var(object.release());
}

PowerState disableTimerThrottling(PowerState state)
{
    state.controlMask |= PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION;
    state.stateMask &= ~PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION;
    return state;
}

DWORD windowsBuildNumber()
{
    using RtlGetVersionFunction = LONG (WINAPI*)(PRTL_OSVERSIONINFOW);
    const auto module = GetModuleHandleW(L"ntdll.dll");
    const auto function = module != nullptr
        ? reinterpret_cast<RtlGetVersionFunction>(GetProcAddress(module, "RtlGetVersion")) : nullptr;
    if (function == nullptr) return 0;
    RTL_OSVERSIONINFOW version{};
    version.dwOSVersionInfoSize = sizeof(version);
    return function(&version) == 0 ? version.dwBuildNumber : 0;
}

std::uint64_t processCreationTimeMs(HANDLE process)
{
    FILETIME creation{}, exit{}, kernel{}, user{};
    if (!GetProcessTimes(process, &creation, &exit, &kernel, &user)) return 0;
    ULARGE_INTEGER ticks{};
    ticks.LowPart = creation.dwLowDateTime;
    ticks.HighPart = creation.dwHighDateTime;
    const auto milliseconds = ticks.QuadPart / 10000ULL;
    return milliseconds > windowsToUnixEpochMs ? milliseconds - windowsToUnixEpochMs : 0;
}

bool belongsToProcessTree(DWORD processId, DWORD rootProcessId)
{
    if (processId == 0 || rootProcessId == 0 || processId == rootProcessId) return false;
    const auto snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return false;
    std::unordered_map<DWORD, DWORD> parents;
    PROCESSENTRY32W entry{};
    entry.dwSize = sizeof(entry);
    if (Process32FirstW(snapshot, &entry)) {
        do { parents[entry.th32ProcessID] = entry.th32ParentProcessID; }
        while (Process32NextW(snapshot, &entry));
    }
    CloseHandle(snapshot);
    auto current = processId;
    for (int depth = 0; depth < 64; ++depth) {
        const auto found = parents.find(current);
        if (found == parents.end() || found->second == 0 || found->second == current) return false;
        current = found->second;
        if (current == rootProcessId) return true;
    }
    return false;
}

bool readPowerState(HANDLE process, PowerState& output, DWORD& error)
{
    PROCESS_POWER_THROTTLING_STATE state{};
    state.Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION;
    if (!GetProcessInformation(process, ProcessPowerThrottling, &state, sizeof(state))) {
        error = GetLastError();
        return false;
    }
    output = { state.Version, state.ControlMask, state.StateMask };
    error = ERROR_SUCCESS;
    return true;
}

bool writePowerState(HANDLE process, const PowerState& input, DWORD& error)
{
    PROCESS_POWER_THROTTLING_STATE state{};
    state.Version = input.version;
    state.ControlMask = input.controlMask;
    state.StateMask = input.stateMask;
    if (!SetProcessInformation(process, ProcessPowerThrottling, &state, sizeof(state))) {
        error = GetLastError();
        return false;
    }
    error = ERROR_SUCCESS;
    return true;
}

bool parseUnsigned64(const char* text, std::uint64_t& value)
{
    if (text == nullptr || *text == 0) return false;
    char* end = nullptr;
    errno = 0;
    const auto parsed = std::strtoull(text, &end, 10);
    if (errno != 0 || end == text || *end != 0) return false;
    value = parsed;
    return true;
}

void printResult(std::unique_ptr<juce::DynamicObject> object)
{
    std::cout << juce::JSON::toString(juce::var(object.release()), false).toStdString() << std::endl;
}

std::unique_ptr<juce::DynamicObject> baseResult(const juce::String& operation, DWORD build)
{
    auto result = std::make_unique<juce::DynamicObject>();
    result->setProperty("schemaVersion", 1);
    result->setProperty("operation", operation);
    result->setProperty("ok", false);
    result->setProperty("supported", build >= minimumSupportedBuild);
    result->setProperty("windowsBuild", static_cast<juce::int64>(build));
    result->setProperty("lastError", 0);
    return result;
}

bool sameState(const PowerState& left, const PowerState& right)
{
    return left.version == right.version && left.controlMask == right.controlMask
        && left.stateMask == right.stateMask;
}
}

int runProcessPowerThrottlingCommand(int argc, char* argv[])
{
    const juce::String operation = argc >= 3 ? juce::String::fromUTF8(argv[2]) : juce::String();
    const auto build = windowsBuildNumber();
    auto result = baseResult(operation, build);
    if (build < minimumSupportedBuild) {
        result->setProperty("error", "WINDOWS_11_22H2_REQUIRED");
        printResult(std::move(result));
        return 0;
    }
    if (argc < 6 || (operation != "query" && operation != "disable-timer" && operation != "restore")) {
        result->setProperty("error", "INVALID_ARGUMENTS");
        printResult(std::move(result));
        return 0;
    }

    std::uint64_t processValue = 0, expectedCreationMs = 0, rootValue = 0;
    if (!parseUnsigned64(argv[3], processValue) || processValue == 0 || processValue > MAXDWORD
        || !parseUnsigned64(argv[4], expectedCreationMs) || expectedCreationMs == 0
        || !parseUnsigned64(argv[5], rootValue) || rootValue == 0 || rootValue > MAXDWORD) {
        result->setProperty("error", "INVALID_PROCESS_IDENTITY");
        printResult(std::move(result));
        return 0;
    }
    const auto processId = static_cast<DWORD>(processValue);
    const auto rootProcessId = static_cast<DWORD>(rootValue);
    result->setProperty("pid", static_cast<juce::int64>(processId));
    result->setProperty("expectedCreationTimeMs", static_cast<double>(expectedCreationMs));
    result->setProperty("rootPid", static_cast<juce::int64>(rootProcessId));
    if (!belongsToProcessTree(processId, rootProcessId)) {
        result->setProperty("error", "TARGET_NOT_IN_ASTRELIS_TREE");
        printResult(std::move(result));
        return 0;
    }

    const auto access = PROCESS_QUERY_LIMITED_INFORMATION
        | (operation == "query" ? 0 : PROCESS_SET_INFORMATION);
    const auto process = OpenProcess(access, FALSE, processId);
    if (process == nullptr) {
        result->setProperty("error", "OPEN_PROCESS_FAILED");
        result->setProperty("lastError", static_cast<juce::int64>(GetLastError()));
        printResult(std::move(result));
        return 0;
    }

    const auto actualCreationMs = processCreationTimeMs(process);
    result->setProperty("processCreationTimeMs", static_cast<double>(actualCreationMs));
    if (actualCreationMs == 0 || (actualCreationMs > expectedCreationMs
            ? actualCreationMs - expectedCreationMs : expectedCreationMs - actualCreationMs) > 1) {
        result->setProperty("error", "PROCESS_CREATION_TIME_MISMATCH");
        result->setProperty("lastError", 0);
        CloseHandle(process);
        printResult(std::move(result));
        return 0;
    }

    DWORD error = ERROR_SUCCESS;
    PowerState before{};
    if (!readPowerState(process, before, error)) {
        result->setProperty("error", "GET_PROCESS_INFORMATION_FAILED");
        result->setProperty("lastError", static_cast<juce::int64>(error));
        CloseHandle(process);
        printResult(std::move(result));
        return 0;
    }
    result->setProperty("before", stateValue(before));

    if (operation == "query") {
        result->setProperty("after", stateValue(before));
        result->setProperty("ok", true);
        CloseHandle(process);
        printResult(std::move(result));
        return 0;
    }

    PowerState requested = before;
    if (operation == "disable-timer") {
        requested = disableTimerThrottling(before);
    } else {
        if (argc < 8) {
            result->setProperty("error", "RESTORE_STATE_REQUIRED");
            CloseHandle(process);
            printResult(std::move(result));
            return 0;
        }
        std::uint64_t controlMask = 0, stateMask = 0;
        if (!parseUnsigned64(argv[6], controlMask) || controlMask > MAXDWORD
            || !parseUnsigned64(argv[7], stateMask) || stateMask > MAXDWORD) {
            result->setProperty("error", "INVALID_RESTORE_STATE");
            CloseHandle(process);
            printResult(std::move(result));
            return 0;
        }
        requested = { PROCESS_POWER_THROTTLING_CURRENT_VERSION,
            static_cast<ULONG>(controlMask), static_cast<ULONG>(stateMask) };
    }
    result->setProperty("requested", stateValue(requested));
    if (!writePowerState(process, requested, error)) {
        result->setProperty("error", "SET_PROCESS_INFORMATION_FAILED");
        result->setProperty("lastError", static_cast<juce::int64>(error));
        CloseHandle(process);
        printResult(std::move(result));
        return 0;
    }

    PowerState after{};
    if (!readPowerState(process, after, error)) {
        result->setProperty("error", "VERIFY_PROCESS_INFORMATION_FAILED");
        result->setProperty("lastError", static_cast<juce::int64>(error));
        CloseHandle(process);
        printResult(std::move(result));
        return 0;
    }
    result->setProperty("after", stateValue(after));
    if (!sameState(requested, after)) {
        result->setProperty("error", "POWER_STATE_VERIFY_MISMATCH");
        CloseHandle(process);
        printResult(std::move(result));
        return 0;
    }
    result->setProperty("ok", true);
    CloseHandle(process);
    printResult(std::move(result));
    return 0;
}

int runProcessPowerThrottlingSelfTest()
{
    constexpr ULONG unknownFlag = 0x20;
    PowerState state{ PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        PROCESS_POWER_THROTTLING_EXECUTION_SPEED
            | PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION | unknownFlag,
        PROCESS_POWER_THROTTLING_EXECUTION_SPEED
            | PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION };
    if (flagState(state, PROCESS_POWER_THROTTLING_EXECUTION_SPEED) != "enabled"
        || flagState(state, PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION) != "enabled") return 1;
    const auto disabled = disableTimerThrottling(state);
    if (disabled.controlMask != state.controlMask
        || (disabled.stateMask & PROCESS_POWER_THROTTLING_EXECUTION_SPEED) == 0
        || (disabled.stateMask & PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION) != 0
        || (disabled.controlMask & unknownFlag) == 0
        || flagState(disabled, PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION) != "disabled") return 2;
    PowerState unset{ PROCESS_POWER_THROTTLING_CURRENT_VERSION, 0, 0 };
    if (flagState(unset, PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION) != "unset") return 3;

    // Exercise the actual Windows API only against this short-lived test
    // process. This proves the write/read/restore sequence without touching an
    // audio device, another application, or any persistent system setting.
    DWORD error = ERROR_SUCCESS;
    PowerState original{};
    if (!readPowerState(GetCurrentProcess(), original, error)) return 4;
    const auto requested = disableTimerThrottling(original);
    if (!writePowerState(GetCurrentProcess(), requested, error)) return 5;
    PowerState applied{};
    if (!readPowerState(GetCurrentProcess(), applied, error) || !sameState(requested, applied)) {
        writePowerState(GetCurrentProcess(), original, error);
        return 6;
    }
    if (!writePowerState(GetCurrentProcess(), original, error)) return 7;
    PowerState restored{};
    if (!readPowerState(GetCurrentProcess(), restored, error) || !sameState(original, restored)) return 8;
    std::cout << "{\"ok\":true,\"test\":\"process-power-throttling-state\"," 
                 "\"windowsApiRoundTrip\":true}" << std::endl;
    return 0;
}

#else

#include <iostream>

int runProcessPowerThrottlingCommand(int, char**)
{
    std::cout << "{\"schemaVersion\":1,\"ok\":false,\"supported\":false,"
                 "\"error\":\"WINDOWS_ONLY\",\"lastError\":0}" << std::endl;
    return 0;
}

int runProcessPowerThrottlingSelfTest()
{
    std::cout << "{\"ok\":true,\"test\":\"process-power-throttling-non-windows\"}" << std::endl;
    return 0;
}

#endif
