#include "ProcessLoopbackProbe.h"

#if defined(_WIN32)

#include "ProcessLoopbackCapture.h"
#include <windows.h>
#include <wrl.h>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <iostream>
#include <limits>
#include <thread>

namespace {
juce::String hresultString(HRESULT value)
{
    return "0x" + juce::String::toHexString(static_cast<juce::int64>(static_cast<unsigned long>(value)))
        .paddedLeft('0', 8);
}
}

int runProcessLoopbackProbe(unsigned int processId, const juce::String& processRole,
                            int durationSeconds, double requestedSampleRate)
{
    if (processId == 0) {
        std::cerr << "PROCESS_LOOPBACK_PROBE_INVALID_PID" << std::endl;
        return 30;
    }
    durationSeconds = std::clamp(durationSeconds, 1, 3600);
    requestedSampleRate = std::clamp(requestedSampleRate, 8000.0, 384000.0);
    const auto comResult = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    const bool uninitialiseCom = comResult == S_OK || comResult == S_FALSE;
    if (FAILED(comResult) && comResult != RPC_E_CHANGED_MODE) {
        std::cerr << "PROCESS_LOOPBACK_PROBE_COM_INIT_FAILED: "
                  << hresultString(comResult).toStdString() << std::endl;
        return 31;
    }

    auto capture = Microsoft::WRL::Make<ProcessLoopbackCapture>();
    const auto startResult = capture->start(static_cast<DWORD>(processId), requestedSampleRate);
    if (FAILED(startResult)) {
        std::cerr << "PROCESS_LOOPBACK_PROBE_START_FAILED: "
                  << hresultString(startResult).toStdString() << std::endl;
        if (uninitialiseCom) CoUninitialize();
        return 32;
    }

    const auto role = processRole.isNotEmpty() ? processRole : juce::String("unclassified");
    const auto startedAt = std::chrono::steady_clock::now();
    auto lastReportAt = startedAt;
    uint64_t lastFrames = 0;
    uint64_t lastSilentFrames = 0;
    uint64_t lastZeroFrames = 0;
    uint64_t lastDiscontinuities = 0;
    double ratioSum = 0.0;
    double ratioMinimum = std::numeric_limits<double>::max();
    double ratioMaximum = 0.0;
    int reportCount = 0;
    int audibleReports = 0;
    int silentReports = 0;

    while (capture->isRunning())
    {
        capture->discardBufferedFrames(capture->bufferedFrameCount());
        const auto now = std::chrono::steady_clock::now();
        const auto totalElapsed = std::chrono::duration<double>(now - startedAt).count();
        if (totalElapsed >= durationSeconds) break;
        const auto reportElapsed = std::chrono::duration<double>(now - lastReportAt).count();
        if (reportElapsed >= 1.0)
        {
            const auto frames = capture->capturedFrameCount();
            const auto packets = capture->capturedPacketCount();
            const auto silentFrames = capture->silentFrameCount();
            const auto zeroFrames = capture->zeroDataFrameCount();
            const auto discontinuities = capture->discontinuityCount();
            const auto intervalFrames = frames - lastFrames;
            const auto intervalFramesPerSecond = reportElapsed > 0.0
                ? static_cast<double>(intervalFrames) / reportElapsed : 0.0;
            const auto intervalRatio = requestedSampleRate > 0.0
                ? intervalFramesPerSecond / requestedSampleRate : 0.0;
            const auto rawRms = capture->recentRawRms();
            const bool audible = rawRms > 1.0e-6f || capture->recentPeak() > 1.0e-6f;
            ++reportCount;
            audible ? ++audibleReports : ++silentReports;
            ratioSum += intervalRatio;
            ratioMinimum = std::min(ratioMinimum, intervalRatio);
            ratioMaximum = std::max(ratioMaximum, intervalRatio);

            auto object = std::make_unique<juce::DynamicObject>();
            object->setProperty("type", "process-loopback-probe-sample");
            object->setProperty("elapsedMs", static_cast<juce::int64>(totalElapsed * 1000.0));
            object->setProperty("targetPid", static_cast<juce::int64>(processId));
            object->setProperty("targetPidRole", role);
            object->setProperty("captureRunning", capture->isRunning());
            object->setProperty("captureFrames", static_cast<juce::int64>(frames));
            object->setProperty("capturePackets", static_cast<juce::int64>(packets));
            object->setProperty("intervalFrames", static_cast<juce::int64>(intervalFrames));
            object->setProperty("captureFramesPerSecond", intervalFramesPerSecond);
            object->setProperty("captureRateRatio", intervalRatio);
            object->setProperty("cumulativeFramesPerSecond", capture->capturedFramesPerSecond());
            object->setProperty("cumulativeRateRatio", capture->captureRateRatio());
            object->setProperty("capturePacketMaxGapMs", capture->maximumPacketGapMs());
            object->setProperty("silentFrames", static_cast<juce::int64>(silentFrames));
            object->setProperty("intervalSilentFrames", static_cast<juce::int64>(silentFrames - lastSilentFrames));
            object->setProperty("zeroDataFrames", static_cast<juce::int64>(zeroFrames));
            object->setProperty("intervalZeroDataFrames", static_cast<juce::int64>(zeroFrames - lastZeroFrames));
            object->setProperty("discontinuities", static_cast<juce::int64>(discontinuities));
            object->setProperty("intervalDiscontinuities", static_cast<juce::int64>(discontinuities - lastDiscontinuities));
            object->setProperty("fifoFrames", capture->bufferedFrameCount());
            object->setProperty("fifoCapacityFrames", capture->bufferCapacity());
            object->setProperty("overruns", static_cast<juce::int64>(capture->overrunCount()));
            object->setProperty("capturePeak", capture->recentPeak());
            object->setProperty("captureRawRms", rawRms);
            object->setProperty("audible", audible);
            object->setProperty("inputSampleRate", capture->sourceSampleRate());
            std::cout << juce::JSON::toString(juce::var(object.release()), true).toStdString() << std::endl;

            lastReportAt = now;
            lastFrames = frames;
            lastSilentFrames = silentFrames;
            lastZeroFrames = zeroFrames;
            lastDiscontinuities = discontinuities;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }

    capture->discardBufferedFrames(capture->bufferedFrameCount());
    capture->stop();
    auto summary = std::make_unique<juce::DynamicObject>();
    summary->setProperty("type", "process-loopback-probe-summary");
    summary->setProperty("targetPid", static_cast<juce::int64>(processId));
    summary->setProperty("targetPidRole", role);
    summary->setProperty("durationSeconds", durationSeconds);
    summary->setProperty("reportCount", reportCount);
    summary->setProperty("audibleReports", audibleReports);
    summary->setProperty("silentReports", silentReports);
    summary->setProperty("captureFrames", static_cast<juce::int64>(capture->capturedFrameCount()));
    summary->setProperty("capturePackets", static_cast<juce::int64>(capture->capturedPacketCount()));
    summary->setProperty("captureFramesPerSecond", capture->capturedFramesPerSecond());
    summary->setProperty("captureRateRatio", capture->captureRateRatio());
    summary->setProperty("minimumIntervalRateRatio", reportCount > 0 ? ratioMinimum : 0.0);
    summary->setProperty("maximumIntervalRateRatio", ratioMaximum);
    summary->setProperty("averageIntervalRateRatio", reportCount > 0 ? ratioSum / reportCount : 0.0);
    summary->setProperty("capturePacketMaxGapMs", capture->maximumPacketGapMs());
    summary->setProperty("silentFrames", static_cast<juce::int64>(capture->silentFrameCount()));
    summary->setProperty("zeroDataFrames", static_cast<juce::int64>(capture->zeroDataFrameCount()));
    summary->setProperty("discontinuities", static_cast<juce::int64>(capture->discontinuityCount()));
    summary->setProperty("overruns", static_cast<juce::int64>(capture->overrunCount()));
    summary->setProperty("activationResult", hresultString(capture->lastResult()));
    std::cout << juce::JSON::toString(juce::var(summary.release()), true).toStdString() << std::endl;
    capture.Reset();
    if (uninitialiseCom) CoUninitialize();
    return 0;
}

#else

int runProcessLoopbackProbe(unsigned int, const juce::String&, int, double) { return 33; }

#endif
