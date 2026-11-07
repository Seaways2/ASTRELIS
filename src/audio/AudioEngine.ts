import type { MeterSnapshot, OutputDevice } from "../types/audio";
import { smoothFrequencyFrame } from "../utils/frequencySmoothing";

type Listener = () => void;
const ANALYSIS_OUTPUT_BINS = 256;

const nativePcmWorkletSource = `
class AuralisRendererPcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frames = 0;
    this.block = new Float32Array(4096);
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    for (const channel of output) channel.fill(0);
    if (!input || !input.length) return true;
    const left = input[0];
    const right = input[1] || left;
    for (let i = 0; i < left.length; ++i) {
      const offset = this.frames * 2;
      this.block[offset] = left[i] || 0;
      this.block[offset + 1] = right[i] || 0;
      if (++this.frames === 2048) {
        const packet = this.block;
        this.port.postMessage({ pcm: packet, frames: 2048 }, [packet.buffer]);
        this.block = new Float32Array(4096);
        this.frames = 0;
      }
    }
    return true;
  }
}
registerProcessor('auralis-renderer-pcm-tap', AuralisRendererPcmTap);
`;

class AudioEngine {
  private readonly elements = [new Audio()];
  private activeDeck = 0;
  private listeners = new Map<string, Set<Listener>>();
  private context?: AudioContext;
  private sources: MediaElementAudioSourceNode[] = [];
  private deckGains: GainNode[] = [];
  private analyser?: AnalyserNode;
  private leftAnalyser?: AnalyserNode;
  private rightAnalyser?: AnalyserNode;
  private splitter?: ChannelSplitterNode;
  private master?: GainNode;
  private analysisBus?: GainNode;
  private analysisKeepAlive?: GainNode;
  private transitionGain?: GainNode;
  private fadeMs = 0;
  private pauseTimer?: number;
  private resolvePendingPause?: () => void;
  private frequency?: Uint8Array<ArrayBuffer>;
  private timeLeft?: Float32Array<ArrayBuffer>;
  private timeRight?: Float32Array<ArrayBuffer>;
  private onlineFrequency = new Uint8Array(256);
  private onlineTimeLeft = new Float32Array(1024);
  private onlineTimeRight = new Float32Array(1024);
  private onlineSampleRate = 0;
  private onlineAnalysisRevision = 0;
  private nativeFrequency = new Uint8Array(256);
  private nativeTimeLeft = new Float32Array(256);
  private nativeTimeRight = new Float32Array(256);
  private nativePeak = 0;
  private nativeRms = 0;
  private nativeSampleRate = 0;
  private nativeAnalysisRevision = 0;
  private meterCacheKey = "";
  private cachedMeter?: MeterSnapshot;
  private frequencyReadFrame = -1;
  private frequencyReadSource?: "local" | "online" | "native";
  private smoothedFrequency?: Uint8Array<ArrayBuffer>;
  private frequencySmoothedAt = 0;
  private nativeFrequencyRevision = 0;
  private smoothedNativeFrequencyRevision = -1;
  private waveformReadFrame = -1;
  private cachedWaveform?: Uint8Array<ArrayBuffer>;
  private analysisSourceValue: "local" | "online" | "native" = "local";
  private get analysisSource() { return this.analysisSourceValue; }
  private set analysisSource(source: "local" | "online" | "native") {
    if (source === this.analysisSourceValue) return;
    this.analysisSourceValue = source;
    this.listeners.get("analysisratechange")?.forEach(listener => listener());
  }
  get analysisSampleRate() {
    if (this.analysisSource === "native" && this.nativeSampleRate) return this.nativeSampleRate;
    if (this.analysisSource === "online" && this.onlineSampleRate) return this.onlineSampleRate;
    return this.context?.sampleRate || 0;
  }
  private analysisDemand = true;
  private analysisConnected = true;
  private analysisStopped = false;
  private analysisFftSize = 2048;
  private analysisSmoothing = .76;
  private nativePcmWorklet?: AudioWorkletNode;
  private nativePcmModuleLoaded = false;
  private nativePcmActive = false;
  private requestedVolume = 1;
  private requestedMuted = false;

  constructor() {
    (["timeupdate", "loadedmetadata", "ended", "play", "pause"] as const).forEach((event) => {
      this.elements.forEach((element, deck) => element.addEventListener(event, () => {
        if (deck !== this.activeDeck) return;
        this.listeners.get(event)?.forEach((listener) => listener());
      }));
    });
  }

  get element() { return this.elements[this.activeDeck]; }

  private cancelPendingPause() {
    if (this.pauseTimer !== undefined) window.clearTimeout(this.pauseTimer);
    this.pauseTimer = undefined;
    const resolve = this.resolvePendingPause;
    this.resolvePendingPause = undefined;
    resolve?.();
  }

  ensureGraph() {
    if (this.context) return;
    this.context = new AudioContext({ latencyHint: "interactive" });
    this.sources = this.elements.map((element) => this.context!.createMediaElementSource(element));
    this.deckGains = this.elements.map(() => this.context!.createGain());
    this.deckGains[0].gain.value = 1;
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = this.analysisFftSize;
    this.analyser.smoothingTimeConstant = 0;
    this.analyser.minDecibels = -90;
    this.analyser.maxDecibels = -10;
    this.splitter = this.context.createChannelSplitter(2);
    this.leftAnalyser = this.context.createAnalyser();
    this.rightAnalyser = this.context.createAnalyser();
    this.leftAnalyser.fftSize = this.rightAnalyser.fftSize = 1024;
    this.master = this.context.createGain();
    this.analysisBus = this.context.createGain();
    this.analysisKeepAlive = this.context.createGain();
    this.analysisKeepAlive.gain.value = 0;
    this.transitionGain = this.context.createGain();
    // Dry path by product design. Fade is the only user processing stage;
    // analysis taps and master volume do not alter source tone or dynamics.
    this.sources.forEach((source, index) => source.connect(this.deckGains[index]).connect(this.transitionGain!));
    this.transitionGain.connect(this.analysisBus);
    // Audible path stays independent from all analysis nodes.
    this.analysisBus.connect(this.master).connect(this.context.destination);
    // Analysis is a side-chain. A zero-gain destination keeps Chromium pulling
    // the graph even when analyser outputs are otherwise not audible.
    this.analysisBus.connect(this.analyser);
    this.analysisBus.connect(this.splitter);
    this.splitter.connect(this.leftAnalyser, 0);
    this.splitter.connect(this.rightAnalyser, 1);
    this.analyser.connect(this.analysisKeepAlive);
    this.leftAnalyser.connect(this.analysisKeepAlive);
    this.rightAnalyser.connect(this.analysisKeepAlive);
    this.analysisKeepAlive.connect(this.context.destination);
    this.frequency = new Uint8Array(this.analyser.frequencyBinCount);
    this.setAnalysisDemand(this.analysisDemand);
    this.timeLeft = new Float32Array(this.leftAnalyser.fftSize);
    this.timeRight = new Float32Array(this.rightAnalyser.fftSize);
  }

  async play() {
    this.ensureGraph();
    this.analysisSource = "local";
    this.cancelPendingPause();
    const now = this.context!.currentTime;
    this.transitionGain!.gain.cancelScheduledValues(now);
    if (this.fadeMs > 0) {
      this.transitionGain!.gain.setValueAtTime(0, now);
      this.transitionGain!.gain.linearRampToValueAtTime(1, now + this.fadeMs / 1000);
    } else {
      this.transitionGain!.gain.setValueAtTime(1, now);
    }
    await this.context?.resume();
    await this.element.play();
  }

  async pause() {
    this.ensureGraph();
    this.cancelPendingPause();
    if (this.element.paused || this.fadeMs <= 0) { this.element.pause(); return; }
    const now = this.context!.currentTime;
    this.transitionGain!.gain.cancelScheduledValues(now);
    this.transitionGain!.gain.setValueAtTime(this.transitionGain!.gain.value, now);
    this.transitionGain!.gain.linearRampToValueAtTime(0, now + this.fadeMs / 1000);
    await new Promise<void>(resolve => {
      this.resolvePendingPause = resolve;
      this.pauseTimer = window.setTimeout(() => {
        this.pauseTimer = undefined;
        this.resolvePendingPause = undefined;
        this.element.pause();
        this.transitionGain!.gain.value = 1;
        resolve();
      }, this.fadeMs);
    });
  }
  stop() {
    this.ensureGraph();
    this.cancelPendingPause();
    this.elements.forEach(element => {
      element.pause();
      try { element.currentTime = 0; } catch { /* Media metadata may not be ready yet. */ }
    });
    if (this.transitionGain && this.context) {
      this.transitionGain.gain.cancelScheduledValues(this.context.currentTime);
      this.transitionGain.gain.value = 1;
    }
    this.resetAnalysis();
  }
  resetAnalysis() {
    this.analysisStopped = true;
    this.cachedMeter = undefined;
    this.frequency?.fill(0);
    this.onlineFrequency.fill(0);
    this.onlineTimeLeft.fill(0);
    this.onlineTimeRight.fill(0);
    this.cachedWaveform?.fill(128);
    this.nativeFrequency.fill(0);
    this.nativeTimeLeft.fill(0);
    this.nativeTimeRight.fill(0);
    this.nativePeak = 0;
    this.nativeRms = 0;
    this.frequencyReadFrame = -1;
    this.frequencyReadSource = undefined;
    this.smoothedFrequency = undefined;
    this.frequencySmoothedAt = 0;
    this.smoothedNativeFrequencyRevision = -1;
    this.waveformReadFrame = -1;
  }
  setAnalysisDemand(enabled: boolean) {
    this.analysisDemand = enabled;
    if (!this.analysisBus || !this.analyser || !this.splitter || enabled === this.analysisConnected) return;
    this.analysisConnected = enabled;
    if (enabled) {
      this.analysisBus.connect(this.analyser);
      this.analysisBus.connect(this.splitter);
    } else {
      this.analysisBus.disconnect(this.analyser);
      this.analysisBus.disconnect(this.splitter);
    }
  }
  resumeAnalysis() { this.analysisStopped = false; }
  load(url: string) {
    this.ensureGraph();
    this.element.src = url;
    this.element.load();
  }
  seek(time: number) {
    const element = this.element;
    const apply = () => {
      const duration = Number.isFinite(element.duration) ? element.duration : time;
      element.currentTime = Math.max(0, Math.min(duration, time));
    };
    if (element.readyState >= HTMLMediaElement.HAVE_METADATA) apply();
    else element.addEventListener("loadedmetadata", apply, { once: true });
  }
  setVolume(volume: number, muted: boolean) {
    this.ensureGraph();
    this.requestedVolume = Math.max(0, Math.min(1, volume));
    this.requestedMuted = muted;
    if (this.master) this.master.gain.setTargetAtTime(
      this.nativePcmActive || muted ? 0 : this.requestedVolume,
      this.context!.currentTime,
      0.012
    );
  }

  async startNativePcmCapture() {
    this.ensureGraph();
    if (this.nativePcmActive) return;
    if (!window.desktop?.nativeAudio?.pushPcm) throw new Error("RENDERER_PCM_BRIDGE_UNAVAILABLE");
    await this.context!.resume();
    if (!this.nativePcmModuleLoaded) {
      const moduleUrl = URL.createObjectURL(new Blob([nativePcmWorkletSource], { type: "text/javascript" }));
      try { await this.context!.audioWorklet.addModule(moduleUrl); }
      finally { URL.revokeObjectURL(moduleUrl); }
      this.nativePcmModuleLoaded = true;
    }
    const node = new AudioWorkletNode(this.context!, "auralis-renderer-pcm-tap", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });
    node.port.onmessage = event => {
      const packet = event.data as { pcm?: Float32Array; frames?: number } | undefined;
      if (!this.nativePcmActive || !(packet?.pcm instanceof Float32Array)) return;
      window.desktop?.nativeAudio.pushPcm({
        sampleRate: this.context!.sampleRate,
        channels: 2,
        frames: Number(packet.frames) || 0,
        pcm: packet.pcm.buffer
      });
    };
    this.nativePcmWorklet = node;
    this.nativePcmActive = true;
    // Keep Chromium pulling the worklet, but make its output silent. The only
    // audible copy is returned by the JUCE/VST rack through the selected sink.
    this.analysisBus!.connect(node);
    node.connect(this.context!.destination);
    this.master!.gain.cancelScheduledValues(this.context!.currentTime);
    this.master!.gain.setTargetAtTime(0, this.context!.currentTime, 0.006);
  }

  stopNativePcmCapture() {
    if (!this.nativePcmActive && !this.nativePcmWorklet) return;
    this.nativePcmActive = false;
    const node = this.nativePcmWorklet;
    this.nativePcmWorklet = undefined;
    if (node) {
      node.port.onmessage = null;
      try { this.analysisBus?.disconnect(node); } catch { /* Already disconnected during shutdown. */ }
      try { node.disconnect(); } catch { /* Already disconnected during shutdown. */ }
    }
    if (this.master && this.context) {
      const target = this.requestedMuted ? 0 : this.requestedVolume;
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setTargetAtTime(target, this.context.currentTime, 0.012);
    }
  }

  get isNativePcmCaptureActive() { return this.nativePcmActive; }

  setFade(durationMs: number) {
    this.fadeMs = Math.max(0, Math.min(5000, durationMs));
  }

  setAnalysisConfig(fftSize: number, smoothing: number) {
    const allowed = [512, 1024, 2048, 4096, 8192];
    this.analysisFftSize = allowed.includes(fftSize) ? fftSize : 2048;
    this.analysisSmoothing = Math.max(0, Math.min(.98, smoothing));
    this.ensureGraph();
    [this.analyser].forEach((analyser) => {
      if (!analyser) return;
      analyser.fftSize = this.analysisFftSize;
      // Every source is smoothed after acquisition so Web Audio and Native FFT
      // data share the same frame-rate-independent response curve.
      analyser.smoothingTimeConstant = 0;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
    });
    this.frequency = new Uint8Array(this.analyser!.frequencyBinCount);
  }

  getFrequencyData() {
    this.ensureGraph();
    if (this.analysisStopped) {
      return new Uint8Array(ANALYSIS_OUTPUT_BINS);
    }
    if (this.analysisSource === "native") {
      if (this.frequencyReadSource === "native" && this.smoothedNativeFrequencyRevision === this.nativeFrequencyRevision && this.smoothedFrequency)
        return this.smoothedFrequency;
      this.smoothedNativeFrequencyRevision = this.nativeFrequencyRevision;
      return this.applyFrequencySmoothing(this.nativeFrequency);
    }
    if (this.analysisSource === "online") {
      if (this.frequencyReadSource === "online" && this.smoothedNativeFrequencyRevision === this.onlineAnalysisRevision && this.smoothedFrequency)
        return this.smoothedFrequency;
      this.smoothedNativeFrequencyRevision = this.onlineAnalysisRevision;
      return this.applyFrequencySmoothing(this.onlineFrequency);
    }
    const analyser = this.analyser!;
    const data = this.frequency!;
    const readFrame = Math.floor(performance.now() / 16);
    if (this.frequencyReadFrame === readFrame && this.frequencyReadSource === this.analysisSource && this.smoothedFrequency)
      return this.smoothedFrequency;
    this.frequencyReadFrame = readFrame;
    analyser.getByteFrequencyData(data);
    return this.applyFrequencySmoothing(data);
  }

  private applyFrequencySmoothing(input: Uint8Array<ArrayBuffer>) {
    const normalized = this.normalizeFrequency(input);
    const now = performance.now();
    const sourceChanged = this.frequencyReadSource !== this.analysisSource;
    const elapsedMs = sourceChanged || this.frequencySmoothedAt <= 0 ? 0 : now - this.frequencySmoothedAt;
    this.smoothedFrequency = smoothFrequencyFrame(
      normalized,
      sourceChanged ? undefined : this.smoothedFrequency,
      this.analysisSmoothing,
      elapsedMs
    );
    this.frequencyReadSource = this.analysisSource;
    this.frequencySmoothedAt = now;
    return this.smoothedFrequency;
  }

  private normalizeFrequency(input: Uint8Array<ArrayBuffer>) {
    if (input.length === ANALYSIS_OUTPUT_BINS) return input;
    const output = new Uint8Array(ANALYSIS_OUTPUT_BINS);
    for (let index = 0; index < output.length; index++) {
      const start = Math.floor(index * input.length / output.length);
      const end = Math.max(start + 1, Math.floor((index + 1) * input.length / output.length));
      let sum = 0;
      for (let source = start; source < Math.min(end, input.length); source++) sum += input[source];
      output[index] = Math.round(sum / Math.max(1, Math.min(end, input.length) - start));
    }
    return output;
  }

  private waveformFromFloat(input: Float32Array<ArrayBuffer>) {
    const data = new Uint8Array(ANALYSIS_OUTPUT_BINS);
    for (let index = 0; index < data.length; index++) {
      const start = Math.floor(index * input.length / data.length);
      const end = Math.max(start + 1, Math.floor((index + 1) * input.length / data.length));
      let sum = 0;
      for (let source = start; source < Math.min(end, input.length); source++) sum += input[source];
      const sample = Math.max(-1, Math.min(1, sum / Math.max(1, Math.min(end, input.length) - start)));
      data[index] = Math.round((sample * .5 + .5) * 255);
    }
    return data;
  }

  getWaveformData() {
    this.ensureGraph();
    if (this.analysisStopped) {
      const silent = new Uint8Array(ANALYSIS_OUTPUT_BINS);
      silent.fill(128);
      return silent;
    }
    if (this.analysisSource === "native" || this.analysisSource === "online") {
      const input = this.analysisSource === "native" ? this.nativeTimeLeft : this.onlineTimeLeft;
      return this.waveformFromFloat(input);
    }
    const analyser = this.analyser!;
    const readFrame = Math.floor(performance.now() / 16);
    if (this.waveformReadFrame === readFrame && this.cachedWaveform) return this.cachedWaveform;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    this.waveformReadFrame = readFrame;
    const normalized = new Uint8Array(ANALYSIS_OUTPUT_BINS);
    for (let index = 0; index < normalized.length; index++) {
      const start = Math.floor(index * data.length / normalized.length);
      const end = Math.max(start + 1, Math.floor((index + 1) * data.length / normalized.length));
      let sum = 0;
      for (let source = start; source < Math.min(end, data.length); source++) sum += data[source];
      normalized[index] = Math.round(sum / Math.max(1, Math.min(end, data.length) - start));
    }
    this.cachedWaveform = normalized;
    return normalized;
  }

  meters(): MeterSnapshot {
    this.ensureGraph();
    const sampleRate = this.analysisSampleRate || this.context!.sampleRate;
    const revision = this.analysisStopped ? "stopped" : this.analysisSource === "native"
      ? this.nativeAnalysisRevision : this.analysisSource === "online"
        ? this.onlineAnalysisRevision : Math.floor(performance.now() / 16);
    const key = `${this.analysisSource}:${sampleRate}:${revision}`;
    if (this.cachedMeter && this.meterCacheKey === key) return this.cachedMeter;
    this.meterCacheKey = key;
    this.cachedMeter = this.readMeters(sampleRate);
    return this.cachedMeter;
  }

  private readMeters(sampleRate: number): MeterSnapshot {
    if (this.analysisStopped) return { left: 0, right: 0, peak: 0, rms: 0, low: 0, mid: 0, high: 0, sampleRate };
    // Channel meters follow short peaks as well as average energy. A pure RMS
    // display barely moves on mastered material and hides drum transients.
    const channelMeterLevel = ({ rms, peak }: { rms: number; peak: number }) =>
      Math.min(1, Math.max(rms * 2.1, peak * .92));
    const band = (frequency: Uint8Array, sampleRate: number, from: number, to: number) => {
      const nyquist = sampleRate / 2;
      const a = Math.max(0, Math.floor((from / nyquist) * frequency.length));
      const b = Math.min(frequency.length, Math.ceil((to / nyquist) * frequency.length));
      let sum = 0;
      for (let i = a; i < b; i++) sum += frequency[i];
      return b > a ? sum / (b - a) / 255 : 0;
    };
    if (this.analysisSource === "native" || this.analysisSource === "online") {
      const timeLeft = this.analysisSource === "native" ? this.nativeTimeLeft : this.onlineTimeLeft;
      const timeRight = this.analysisSource === "native" ? this.nativeTimeRight : this.onlineTimeRight;
      const frequency = this.analysisSource === "native" ? this.nativeFrequency : this.onlineFrequency;
      const level = (data: Float32Array) => {
        let sum = 0, peak = 0;
        for (const sample of data) { sum += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
        return { rms: Math.sqrt(sum / Math.max(1, data.length)), peak };
      };
      const left = level(timeLeft), right = level(timeRight);
      return {
        left: channelMeterLevel(left), right: channelMeterLevel(right),
        peak: this.analysisSource === "native" ? this.nativePeak || Math.max(left.peak, right.peak) : Math.max(left.peak, right.peak),
        rms: this.analysisSource === "native" ? this.nativeRms || (left.rms + right.rms) / 2 : (left.rms + right.rms) / 2,
        low: band(frequency, sampleRate, 20, 250), mid: band(frequency, sampleRate, 250, 4000),
        high: band(frequency, sampleRate, 4000, 16000), sampleRate
      };
    }
    const leftAnalyser = this.leftAnalyser!;
    const rightAnalyser = this.rightAnalyser!;
    const leftData = this.timeLeft!;
    const rightData = this.timeRight!;
    leftAnalyser.getFloatTimeDomainData(leftData);
    rightAnalyser.getFloatTimeDomainData(rightData);
    const level = (data: Float32Array<ArrayBuffer>) => {
      let sum = 0, peak = 0;
      for (const sample of data) { const abs = Math.abs(sample); sum += sample * sample; peak = Math.max(peak, abs); }
      return { rms: Math.sqrt(sum / data.length), peak };
    };
    const l = level(leftData), r = level(rightData);
    const freq = this.getFrequencyData();
    return {
      left: channelMeterLevel(l), right: channelMeterLevel(r),
      peak: Math.max(l.peak, r.peak), rms: (l.rms + r.rms) / 2,
      low: band(freq, sampleRate, 20, 250), mid: band(freq, sampleRate, 250, 4000), high: band(freq, sampleRate, 4000, 16000),
      sampleRate
    };
  }

  on(event: "timeupdate" | "loadedmetadata" | "ended" | "play" | "pause" | "analysisratechange", listener: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return () => this.listeners.get(event)?.delete(listener);
  }

  async listOutputs(): Promise<OutputDevice[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "audiooutput")
      .filter((device) => {
        const id = device.deviceId.toLocaleLowerCase();
        return id !== "default" && id !== "communications"
          && !/^(?:default|communications?|默认|通信|通讯)\s*[-–—:]\s*/i.test(device.label);
      })
      .map((device, index) => ({ id: device.deviceId, label: device.label || `音频输出 ${index + 1}` }));
  }

  async setOutput(deviceId: string) {
    this.ensureGraph();
    if (!this.context?.setSinkId) throw new Error("当前 Electron/Chromium 版本不支持音频输出切换");
    const sinkId = deviceId === "default" ? "" : deviceId;
    await this.context.setSinkId(sinkId);
  }

  setOnlineAnalysis(frame: OnlineAnalysisFrame) {
    const sampleRate = Number(frame.sampleRate);
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) return;
    const frequency = frame.frequency instanceof Uint8Array
      ? frame.frequency : new Uint8Array(frame.frequency);
    const left = frame.left instanceof Float32Array ? frame.left : new Float32Array(frame.left);
    const right = frame.right instanceof Float32Array ? frame.right : new Float32Array(frame.right);
    if (!frequency.length || !left.length || left.length !== right.length) return;
    const previousRate = this.analysisSampleRate;
    this.onlineFrequency = Uint8Array.from(frequency);
    this.onlineTimeLeft = Float32Array.from(left);
    this.onlineTimeRight = Float32Array.from(right);
    this.onlineSampleRate = sampleRate;
    this.onlineAnalysisRevision++;
    this.analysisStopped = false;
    this.analysisSource = "online";
    if (previousRate && previousRate !== sampleRate)
      this.listeners.get("analysisratechange")?.forEach(listener => listener());
  }

  clearOnlineAnalysis() {
    this.onlineFrequency.fill(0);
    this.onlineTimeLeft.fill(0);
    this.onlineTimeRight.fill(0);
    this.onlineAnalysisRevision++;
    if (this.analysisSource === "online") this.analysisSource = "local";
  }

  useOnlineAnalysis() {
    this.ensureGraph();
    this.analysisSource = "online";
  }

  useLocalAnalysis() {
    this.ensureGraph();
    this.analysisSource = "local";
  }

  setNativeAnalysis(status: NativeAudioStatus) {
    const wasNative = this.analysisSource === "native";
    const previousRate = this.analysisSampleRate;
    const sampleRate = status.analysisSampleRate || status.sampleRate;
    if (typeof sampleRate === "number" && Number.isFinite(sampleRate) && sampleRate > 0 && sampleRate <= 768000)
      this.nativeSampleRate = sampleRate;
    this.nativeAnalysisRevision++;
    if (status.nativeFrequency?.length) {
      this.nativeFrequency = Uint8Array.from(status.nativeFrequency);
      this.nativeFrequencyRevision++;
    }
    if (status.nativeLeft?.length) this.nativeTimeLeft = Float32Array.from(status.nativeLeft);
    if (status.nativeRight?.length) this.nativeTimeRight = Float32Array.from(status.nativeRight);
    this.nativePeak = status.nativePeak || 0;
    this.nativeRms = status.nativeRms || 0;
    this.analysisSource = "native";
    if (wasNative && previousRate !== this.analysisSampleRate)
      this.listeners.get("analysisratechange")?.forEach(listener => listener());
  }

  useNativeAnalysis() {
    this.ensureGraph();
    this.analysisSource = "native";
  }

  get analysisMode() { return this.analysisSource; }

  dispose() {
    if (this.pauseTimer) window.clearTimeout(this.pauseTimer);
    this.stopNativePcmCapture();
    this.clearOnlineAnalysis();
    this.elements.forEach((element) => {
      element.pause();
      element.removeAttribute("src");
      element.load();
    });
    void this.context?.close().catch(() => undefined);
  }
}

export const audioEngine = new AudioEngine();
window.addEventListener("beforeunload", () => audioEngine.dispose(), { once: true });
