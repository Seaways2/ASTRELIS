import { monitorEventLoopDelay, performance } from "node:perf_hooks";

export interface PcmPacketMetadata {
  protocolVersion?: number;
  mediaSessionId?: number;
  sequence?: number;
  sourceFrameCounter?: number;
  producerTimestamp?: number;
  producerTimestampUs?: number;
  workletProcessCalls?: number;
  workletPacketsProduced?: number;
  workletMaxPacketGap?: number;
  workletCurrentFrameGap?: number;
  workletLastSequence?: number;
}

export interface RendererPcmDiagnostics extends PcmPacketMetadata {
  rendererPacketsReceived?: number;
  rendererLastSequence?: number;
  rendererSequenceGaps?: number;
  rendererMaxInterArrivalMs?: number;
  pageVisibilityState?: string;
  mediaElementPaused?: boolean;
  mediaElementEnded?: boolean;
  captureMode?: string;
}

/** A healthy stream is logged this often; trouble is logged as soon as it is sampled. */
export const PCM_DIAG_HEALTHY_INTERVAL_MS = 30000;
const PCM_DIAG_SLOW_EVENT_LOOP_MS = 50;

function finiteInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function round(value: number, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export class PcmDiagnostics {
  private readonly eventLoop = monitorEventLoopDelay({ resolution: 20 });
  private timer: NodeJS.Timeout | undefined;
  private mediaSessionId = 0;
  private lastSequence = 0;
  private lastArrivalMs = 0;
  private mainPcmPackets = 0;
  private mainSequenceGaps = 0;
  private mainMaxPcmArrivalGapMs = 0;
  private base64EncodeTimeAggregateMs = 0;
  private jsonSerializeTimeAggregateMs = 0;
  private stdinWritableLengthHighWater = 0;
  private stdinDrainCount = 0;
  private stdinWriteBackpressureCount = 0;
  private renderer: RendererPcmDiagnostics = {};
  private nativeStatus: Record<string, unknown> = {};
  private nativeStatusAtMs = 0;
  private lastFlushedPacketCount = 0;
  private lastMainEventLoopP95 = 0;
  private lastReportAtMs = 0;
  private lastReportedTrouble = "";

  constructor(
    private readonly emit: (message: string) => void,
    private readonly onlineWindowState: () => Record<string, unknown>
  ) {}

  start() {
    if (this.timer) return;
    this.eventLoop.enable();
    this.timer = setInterval(() => this.flush(), 2000);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.eventLoop.disable();
  }

  beginOnlineSession() {
    this.mediaSessionId = 0;
    this.lastSequence = 0;
    this.lastArrivalMs = 0;
    this.mainPcmPackets = 0;
    this.mainSequenceGaps = 0;
    this.mainMaxPcmArrivalGapMs = 0;
    this.base64EncodeTimeAggregateMs = 0;
    this.jsonSerializeTimeAggregateMs = 0;
    this.stdinWritableLengthHighWater = 0;
    this.stdinDrainCount = 0;
    this.stdinWriteBackpressureCount = 0;
    this.lastFlushedPacketCount = 0;
    this.renderer = {};
  }

  recordMainPacket(packet: PcmPacketMetadata) {
    const now = performance.now();
    const session = finiteInteger(packet.mediaSessionId);
    const sequence = finiteInteger(packet.sequence);
    if (session > 0 && session !== this.mediaSessionId) {
      this.mediaSessionId = session;
      this.lastSequence = 0;
      this.lastArrivalMs = 0;
      this.mainSequenceGaps = 0;
      this.mainMaxPcmArrivalGapMs = 0;
    }
    if (sequence > 0 && this.lastSequence > 0 && sequence !== this.lastSequence + 1)
      this.mainSequenceGaps += sequence > this.lastSequence ? sequence - this.lastSequence - 1 : 1;
    if (sequence > 0) this.lastSequence = sequence;
    if (this.lastArrivalMs > 0)
      this.mainMaxPcmArrivalGapMs = Math.max(this.mainMaxPcmArrivalGapMs, now - this.lastArrivalMs);
    this.lastArrivalMs = now;
    this.mainPcmPackets++;
  }

  recordSerialization(base64Ms: number, jsonMs: number) {
    this.base64EncodeTimeAggregateMs += Math.max(0, base64Ms);
    this.jsonSerializeTimeAggregateMs += Math.max(0, jsonMs);
  }

  recordStdinWritableLength(length: number) {
    this.stdinWritableLengthHighWater = Math.max(this.stdinWritableLengthHighWater, Math.max(0, length));
  }

  recordStdinBackpressure() { this.stdinWriteBackpressureCount++; }
  recordStdinDrain() { this.stdinDrainCount++; }

  recordRenderer(snapshot: RendererPcmDiagnostics) {
    this.renderer = { ...snapshot };
  }

  recordNativeStatus(status: Record<string, unknown>) {
    this.nativeStatus = { ...status };
    this.nativeStatusAtMs = performance.now();
  }

  currentNativeStatus() { return { ...this.nativeStatus }; }
  currentMainEventLoopP95() { return this.lastMainEventLoopP95; }

  private eventLoopMs(percentile: number) {
    const nanoseconds = this.eventLoop.percentile(percentile);
    return Number.isFinite(nanoseconds) ? round(nanoseconds / 1_000_000) : 0;
  }

  private flush() {
    const native = this.nativeStatus;
    const windowState = this.onlineWindowState();
    if (this.mainPcmPackets === this.lastFlushedPacketCount) {
      this.eventLoop.reset();
      return;
    }
    this.lastMainEventLoopP95 = this.eventLoopMs(95);
    // Sampled every 2 s, but a ~2 KB line every 2 s grew the log by ~5 MB an
    // hour. A healthy stream is reported every 30 s; any new trouble at once.
    const trouble = [
      this.mainSequenceGaps, this.stdinWriteBackpressureCount, native.captureUnderruns, native.captureDiscontinuities,
      native.pcmPacketsRejected, native.nativeSequenceGaps, native.nativeSessionDrops, native.pipeReadFailures,
      this.lastMainEventLoopP95 > PCM_DIAG_SLOW_EVENT_LOOP_MS
    ].map(value => String(value ?? 0)).join(",");
    const now = performance.now();
    if (trouble === this.lastReportedTrouble && now - this.lastReportAtMs < PCM_DIAG_HEALTHY_INTERVAL_MS) {
      // Still counts as flushed: a stream that stops now must not be reported later.
      this.lastFlushedPacketCount = this.mainPcmPackets;
      this.eventLoop.reset();
      return;
    }
    this.lastReportedTrouble = trouble;
    this.lastReportAtMs = now;
    const report = {
      protocolVersion: 1,
      main: {
        mainEventLoopP50: this.eventLoopMs(50),
        mainEventLoopP95: this.lastMainEventLoopP95,
        mainEventLoopP99: this.eventLoopMs(99),
        mainEventLoopMax: round(this.eventLoop.max / 1_000_000),
        mainPcmPackets: this.mainPcmPackets,
        mainPcmPacketCount: this.mainPcmPackets,
        mainSequenceGaps: this.mainSequenceGaps,
        mainMaxPcmArrivalGapMs: round(this.mainMaxPcmArrivalGapMs),
        base64EncodeTimeAggregate: round(this.base64EncodeTimeAggregateMs),
        jsonSerializeTimeAggregate: round(this.jsonSerializeTimeAggregateMs),
        base64EncodeTimeAggregateMs: round(this.base64EncodeTimeAggregateMs),
        jsonSerializeTimeAggregateMs: round(this.jsonSerializeTimeAggregateMs),
        stdinWritableLengthHighWater: this.stdinWritableLengthHighWater,
        stdinDrainCount: this.stdinDrainCount,
        stdinWriteBackpressureCount: this.stdinWriteBackpressureCount,
        onlineWindowState: windowState
      },
      renderer: this.renderer,
      native: {
        statusAgeMs: this.nativeStatusAtMs > 0 ? round(performance.now() - this.nativeStatusAtMs) : null,
        targetPid: native.captureTargetPid ?? native.captureProcessId,
        targetPidRole: native.captureTargetPidRole,
        capturePackets: native.capturePackets,
        producerFrames: native.capturedFrames,
        consumedFrames: native.captureConsumedFrames,
        captureFramesPerSecond: native.captureFramesPerSecond,
        captureRateRatio: native.captureRateRatio,
        capturePacketMaxGapMs: native.capturePacketMaxGapMs,
        silentFrames: native.captureSilentFrames,
        discontinuities: native.captureDiscontinuities,
        fifoFrames: native.captureFifoFrames ?? native.captureBufferFrames,
        fifoTargetFrames: native.captureFifoTargetFrames ?? native.captureTargetFrames,
        underruns: native.captureUnderruns,
        overruns: native.captureOverruns,
        driftPpm: native.captureDriftPpm,
        inputSampleRate: native.inputSampleRate ?? native.captureSourceRate,
        outputSampleRate: native.outputSampleRate ?? native.sourceOutputRate,
        pluginLatencySamples: native.pluginLatencySamples,
        estimatedTotalLatencyMs: native.estimatedTotalLatencyMs,
        lastMediaSessionId: native.lastMediaSessionId,
        lastSequence: native.lastSequence,
        sequenceGapCount: native.sequenceGapCount,
        maxPacketArrivalGapUs: native.maxPacketArrivalGapUs,
        base64DecodeTimeAggregate: native.base64DecodeTimeAggregate,
        base64DecodeTimeAggregateUs: native.base64DecodeTimeAggregateUs,
        pcmPacketsAccepted: native.pcmPacketsAccepted,
        pcmPacketsRejected: native.pcmPacketsRejected,
        callbackCount: native.callbackCount,
        callbackMaxGapUs: native.callbackMaxGapUs,
        captureBufferMinFrames: native.captureBufferMinFrames,
        captureBufferMaxFrames: native.captureBufferMaxFrames,
        captureBufferP50: native.captureBufferP50,
        captureBufferP95: native.captureBufferP95,
        captureBufferP99: native.captureBufferP99,
        primingCount: native.primingCount,
        underrunCount: native.captureUnderruns,
        hardRecoveryCount: native.hardRecoveryCount,
        captureRestartCount: native.captureRestartCount,
        outputBlockSize: native.sourceBlockSize,
        nativePackets: native.nativePackets,
        nativeSequenceGaps: native.nativeSequenceGaps,
        nativeSessionDrops: native.nativeSessionDrops,
        nativeDiscontinuities: native.nativeDiscontinuities,
        pipeConnections: native.pipeConnections,
        pipeReadFailures: native.pipeReadFailures,
        pipeInvalidPackets: native.pipeInvalidPackets
      }
    };
    this.emit(`[PCM-DIAG] ${JSON.stringify(report)}`);
    this.lastFlushedPacketCount = this.mainPcmPackets;
    this.eventLoop.reset();
  }
}
