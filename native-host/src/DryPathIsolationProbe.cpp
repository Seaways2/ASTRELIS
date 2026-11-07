#include "DryPathIsolationProbe.h"

#if defined(_WIN32)

#include "ProcessLoopbackCapture.h"
#include <audiopolicy.h>
#include <endpointvolume.h>
#include <mmdeviceapi.h>
#include <windows.h>
#include <wrl.h>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <iostream>
#include <limits>
#include <thread>
#include <vector>

using Microsoft::WRL::ComPtr;

namespace {
enum class IsolationMethod { sessionMute, sessionVolumeZero, sessionVolumeLow };
constexpr float lowSessionVolume = 0.001f;

struct SessionTarget
{
    ComPtr<IAudioSessionControl> control;
    ComPtr<IAudioSessionControl2> control2;
    ComPtr<ISimpleAudioVolume> volume;
    juce::String instanceIdentifier;
    AudioSessionState state = AudioSessionStateExpired;
    float peak = 0.0f;
};

juce::String hresultString(HRESULT value)
{
    return "0x" + juce::String::toHexString(static_cast<juce::int64>(static_cast<unsigned long>(value)))
        .paddedLeft('0', 8);
}

juce::String takeAndFree(LPWSTR value)
{
    if (value == nullptr) return {};
    const juce::String result(value);
    CoTaskMemFree(value);
    return result;
}

void emit(juce::DynamicObject* object)
{
    std::cout << juce::JSON::toString(juce::var(object), true).toStdString() << std::endl;
}

HRESULT openSessionManager(ComPtr<IAudioSessionManager2>& manager)
{
    ComPtr<IMMDeviceEnumerator> deviceEnumerator;
    ComPtr<IMMDevice> endpoint;
    auto result = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                   IID_PPV_ARGS(&deviceEnumerator));
    if (SUCCEEDED(result))
        result = deviceEnumerator->GetDefaultAudioEndpoint(eRender, eConsole, &endpoint);
    if (SUCCEEDED(result))
        result = endpoint->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr,
                                    reinterpret_cast<void**>(manager.GetAddressOf()));
    return result;
}

std::vector<SessionTarget> findSessions(IAudioSessionManager2& manager, DWORD processId)
{
    std::vector<SessionTarget> matches;
    ComPtr<IAudioSessionEnumerator> enumerator;
    if (FAILED(manager.GetSessionEnumerator(&enumerator))) return matches;
    int count = 0;
    if (FAILED(enumerator->GetCount(&count))) return matches;
    for (int index = 0; index < count; ++index)
    {
        SessionTarget target;
        DWORD candidatePid = 0;
        if (FAILED(enumerator->GetSession(index, &target.control))
            || FAILED(target.control.As(&target.control2))
            || FAILED(target.control2->GetProcessId(&candidatePid))
            || candidatePid != processId
            || target.control2->IsSystemSoundsSession() == S_OK
            || FAILED(target.control.As(&target.volume)))
            continue;

        LPWSTR instanceRaw = nullptr;
        target.control2->GetSessionInstanceIdentifier(&instanceRaw);
        target.instanceIdentifier = takeAndFree(instanceRaw);
        target.control2->GetState(&target.state);
        ComPtr<IAudioMeterInformation> meter;
        if (SUCCEEDED(target.control.As(&meter))) meter->GetPeakValue(&target.peak);
        matches.push_back(std::move(target));
    }
    std::sort(matches.begin(), matches.end(), [](const auto& left, const auto& right) {
        if (left.state != right.state) return left.state == AudioSessionStateActive;
        return left.peak > right.peak;
    });
    return matches;
}

SessionTarget findSessionByIdentity(IAudioSessionManager2& manager, DWORD processId,
                                    const juce::String& identity)
{
    auto sessions = findSessions(manager, processId);
    const auto found = std::find_if(sessions.begin(), sessions.end(), [&](const auto& session) {
        return session.instanceIdentifier == identity;
    });
    return found != sessions.end() ? *found : SessionTarget{};
}

juce::String phaseName(double elapsed, int preSeconds, int appliedSeconds)
{
    if (elapsed < preSeconds) return "before";
    if (elapsed < preSeconds + appliedSeconds) return "isolated";
    return "restored";
}
}

int runDryPathIsolationProbe(unsigned int processId, const juce::String& requestedMethod,
                             int preSeconds, int appliedSeconds, int postSeconds,
                             double requestedSampleRate)
{
    if (processId == 0) {
        std::cerr << "DRY_PATH_PROBE_INVALID_PID" << std::endl;
        return 40;
    }
    const auto normalizedMethod = requestedMethod.trim().toLowerCase();
    const auto method = normalizedMethod == "session-mute" ? IsolationMethod::sessionMute
        : normalizedMethod == "session-volume-zero" ? IsolationMethod::sessionVolumeZero
        : normalizedMethod == "session-volume-low" ? IsolationMethod::sessionVolumeLow
        : IsolationMethod::sessionMute;
    if (normalizedMethod != "session-mute" && normalizedMethod != "session-volume-zero"
        && normalizedMethod != "session-volume-low") {
        std::cerr << "DRY_PATH_PROBE_INVALID_METHOD" << std::endl;
        return 41;
    }
    preSeconds = std::clamp(preSeconds, 2, 60);
    appliedSeconds = std::clamp(appliedSeconds, 5, 300);
    postSeconds = std::clamp(postSeconds, 2, 60);
    requestedSampleRate = std::clamp(requestedSampleRate, 8000.0, 384000.0);

    const auto comResult = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    const bool uninitialiseCom = comResult == S_OK || comResult == S_FALSE;
    if (FAILED(comResult) && comResult != RPC_E_CHANGED_MODE) {
        std::cerr << "DRY_PATH_PROBE_COM_INIT_FAILED: " << hresultString(comResult).toStdString() << std::endl;
        return 42;
    }

    ComPtr<IAudioSessionManager2> sessionManager;
    auto result = openSessionManager(sessionManager);
    if (FAILED(result)) {
        std::cerr << "DRY_PATH_PROBE_SESSION_MANAGER_FAILED: " << hresultString(result).toStdString() << std::endl;
        if (uninitialiseCom) CoUninitialize();
        return 43;
    }
    auto candidates = findSessions(*sessionManager.Get(), static_cast<DWORD>(processId));
    if (candidates.empty()) {
        std::cerr << "DRY_PATH_PROBE_SESSION_NOT_FOUND" << std::endl;
        if (uninitialiseCom) CoUninitialize();
        return 44;
    }
    auto target = candidates.front();
    float originalVolume = 0.0f;
    BOOL originalMuted = FALSE;
    if (FAILED(target.volume->GetMasterVolume(&originalVolume))
        || FAILED(target.volume->GetMute(&originalMuted))) {
        std::cerr << "DRY_PATH_PROBE_STATE_READ_FAILED" << std::endl;
        if (uninitialiseCom) CoUninitialize();
        return 45;
    }
    if ((method == IsolationMethod::sessionMute && originalMuted)
        || (method == IsolationMethod::sessionVolumeZero && originalVolume <= 0.001f)
        || (method == IsolationMethod::sessionVolumeLow && originalVolume <= lowSessionVolume + 0.00001f)) {
        std::cerr << "DRY_PATH_PROBE_PRECONDITION_ALREADY_ISOLATED" << std::endl;
        if (uninitialiseCom) CoUninitialize();
        return 46;
    }

    GUID eventContext{};
    CoCreateGuid(&eventContext);
    const auto generation = static_cast<juce::int64>(GetTickCount64());
    auto capture = Microsoft::WRL::Make<ProcessLoopbackCapture>();
    result = capture->start(static_cast<DWORD>(processId), requestedSampleRate);
    if (FAILED(result)) {
        std::cerr << "DRY_PATH_PROBE_CAPTURE_FAILED: " << hresultString(result).toStdString() << std::endl;
        if (uninitialiseCom) CoUninitialize();
        return 47;
    }

    auto begin = std::make_unique<juce::DynamicObject>();
    begin->setProperty("type", "dry-path-isolation-begin");
    begin->setProperty("targetPid", static_cast<juce::int64>(processId));
    begin->setProperty("method", normalizedMethod);
    begin->setProperty("generation", generation);
    begin->setProperty("candidateSessions", static_cast<int>(candidates.size()));
    begin->setProperty("sessionInstanceIdentifier", target.instanceIdentifier);
    begin->setProperty("originalMuted", originalMuted != FALSE);
    begin->setProperty("originalVolume", originalVolume);
    begin->setProperty("selectedPeak", target.peak);
    emit(begin.release());

    bool isolationApplied = false;
    bool restoreAttempted = false;
    bool restoreSucceeded = false;
    bool restoreSkippedStale = false;
    HRESULT applyResult = E_PENDING;
    HRESULT restoreResult = E_PENDING;
    int beforeAudibleReports = 0, isolatedAudibleReports = 0, restoredAudibleReports = 0;
    int beforeReports = 0, isolatedReports = 0, restoredReports = 0;
    const auto startedAt = std::chrono::steady_clock::now();
    auto lastReportAt = startedAt;
    uint64_t lastFrames = 0;
    const auto totalSeconds = preSeconds + appliedSeconds + postSeconds;

    const auto restore = [&]() {
        if (restoreAttempted || !isolationApplied) return;
        restoreAttempted = true;
        auto current = findSessionByIdentity(*sessionManager.Get(), static_cast<DWORD>(processId),
                                             target.instanceIdentifier);
        if (current.volume == nullptr) {
            restoreSkippedStale = true;
            restoreResult = HRESULT_FROM_WIN32(ERROR_NOT_FOUND);
            return;
        }
        BOOL currentMuted = FALSE;
        float currentVolume = 0.0f;
        if (FAILED(current.volume->GetMute(&currentMuted))
            || FAILED(current.volume->GetMasterVolume(&currentVolume))) {
            restoreResult = E_FAIL;
            return;
        }
        const bool stillOwnsMutation = method == IsolationMethod::sessionMute
            ? currentMuted != FALSE
            : method == IsolationMethod::sessionVolumeZero
                ? std::abs(currentVolume) <= 0.0001f
                : std::abs(currentVolume - lowSessionVolume) <= 0.00001f;
        if (!stillOwnsMutation) {
            restoreSkippedStale = true;
            restoreResult = HRESULT_FROM_WIN32(ERROR_REVISION_MISMATCH);
            return;
        }
        restoreResult = method == IsolationMethod::sessionMute
            ? current.volume->SetMute(originalMuted, &eventContext)
            : current.volume->SetMasterVolume(originalVolume, &eventContext);
        restoreSucceeded = SUCCEEDED(restoreResult);
    };

    while (capture->isRunning())
    {
        capture->discardBufferedFrames(capture->bufferedFrameCount());
        const auto now = std::chrono::steady_clock::now();
        const auto elapsed = std::chrono::duration<double>(now - startedAt).count();
        if (!isolationApplied && elapsed >= preSeconds) {
            applyResult = method == IsolationMethod::sessionMute
                ? target.volume->SetMute(TRUE, &eventContext)
                : target.volume->SetMasterVolume(method == IsolationMethod::sessionVolumeLow
                    ? lowSessionVolume : 0.0f, &eventContext);
            isolationApplied = SUCCEEDED(applyResult);
            auto event = std::make_unique<juce::DynamicObject>();
            event->setProperty("type", "dry-path-isolation-applied");
            event->setProperty("generation", generation);
            event->setProperty("method", normalizedMethod);
            event->setProperty("result", hresultString(applyResult));
            emit(event.release());
            if (!isolationApplied) break;
        }
        if (!restoreAttempted && elapsed >= preSeconds + appliedSeconds) {
            restore();
            auto event = std::make_unique<juce::DynamicObject>();
            event->setProperty("type", "dry-path-isolation-restored");
            event->setProperty("generation", generation);
            event->setProperty("succeeded", restoreSucceeded);
            event->setProperty("skippedStale", restoreSkippedStale);
            event->setProperty("result", hresultString(restoreResult));
            emit(event.release());
        }
        if (elapsed >= totalSeconds) break;
        const auto reportElapsed = std::chrono::duration<double>(now - lastReportAt).count();
        if (reportElapsed >= 1.0) {
            const auto frames = capture->capturedFrameCount();
            const auto intervalRatio = static_cast<double>(frames - lastFrames)
                / reportElapsed / requestedSampleRate;
            const auto rms = capture->recentRawRms();
            const bool audible = rms > 1.0e-6f || capture->recentPeak() > 1.0e-6f;
            const auto phase = phaseName(elapsed, preSeconds, appliedSeconds);
            int* reports = phase == "before" ? &beforeReports
                : phase == "isolated" ? &isolatedReports : &restoredReports;
            int* audibleReports = phase == "before" ? &beforeAudibleReports
                : phase == "isolated" ? &isolatedAudibleReports : &restoredAudibleReports;
            ++*reports;
            if (audible) ++*audibleReports;
            auto sample = std::make_unique<juce::DynamicObject>();
            sample->setProperty("type", "dry-path-isolation-sample");
            sample->setProperty("elapsedMs", static_cast<juce::int64>(elapsed * 1000.0));
            sample->setProperty("phase", phase);
            sample->setProperty("audible", audible);
            sample->setProperty("captureRawRms", rms);
            sample->setProperty("captureCompensatedRms",
                phase == "isolated" && method == IsolationMethod::sessionVolumeLow
                    ? rms / lowSessionVolume : rms);
            sample->setProperty("captureRateRatio", intervalRatio);
            sample->setProperty("capturePacketMaxGapMs", capture->maximumPacketGapMs());
            sample->setProperty("discontinuities", static_cast<juce::int64>(capture->discontinuityCount()));
            sample->setProperty("overruns", static_cast<juce::int64>(capture->overrunCount()));
            emit(sample.release());
            lastFrames = frames;
            lastReportAt = now;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }

    restore();
    capture->discardBufferedFrames(capture->bufferedFrameCount());
    capture->stop();
    auto summary = std::make_unique<juce::DynamicObject>();
    summary->setProperty("type", "dry-path-isolation-summary");
    summary->setProperty("targetPid", static_cast<juce::int64>(processId));
    summary->setProperty("method", normalizedMethod);
    summary->setProperty("generation", generation);
    summary->setProperty("sessionInstanceIdentifier", target.instanceIdentifier);
    summary->setProperty("originalMuted", originalMuted != FALSE);
    summary->setProperty("originalVolume", originalVolume);
    summary->setProperty("appliedVolume", method == IsolationMethod::sessionMute
        ? originalVolume : method == IsolationMethod::sessionVolumeLow ? lowSessionVolume : 0.0f);
    summary->setProperty("applyResult", hresultString(applyResult));
    summary->setProperty("restoreResult", hresultString(restoreResult));
    summary->setProperty("restoreSucceeded", restoreSucceeded);
    summary->setProperty("restoreSkippedStale", restoreSkippedStale);
    summary->setProperty("beforeReports", beforeReports);
    summary->setProperty("beforeAudibleReports", beforeAudibleReports);
    summary->setProperty("isolatedReports", isolatedReports);
    summary->setProperty("isolatedAudibleReports", isolatedAudibleReports);
    summary->setProperty("restoredReports", restoredReports);
    summary->setProperty("restoredAudibleReports", restoredAudibleReports);
    summary->setProperty("captureFrames", static_cast<juce::int64>(capture->capturedFrameCount()));
    summary->setProperty("captureFramesPerSecond", capture->capturedFramesPerSecond());
    summary->setProperty("captureRateRatio", capture->captureRateRatio());
    summary->setProperty("capturePacketMaxGapMs", capture->maximumPacketGapMs());
    summary->setProperty("discontinuities", static_cast<juce::int64>(capture->discontinuityCount()));
    summary->setProperty("overruns", static_cast<juce::int64>(capture->overrunCount()));
    emit(summary.release());
    capture.Reset();
    if (uninitialiseCom) CoUninitialize();
    return isolationApplied && restoreSucceeded ? 0 : 48;
}

#else

int runDryPathIsolationProbe(unsigned int, const juce::String&, int, int, int, double) { return 49; }

#endif
