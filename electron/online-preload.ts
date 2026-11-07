import { ipcRenderer } from "electron";

const TRUSTED_ONLINE_ORIGIN = "https://music.youtube.com";
const isTrustedOnlinePage = () => window.location.origin === TRUSTED_ONLINE_ORIGIN;
const allowedFftSizes = new Set([512, 1024, 2048, 4096, 8192]);

type AnalysisConfig = { enabled: boolean; fftSize: number; sampleRate: number };
type CapturableMedia = HTMLMediaElement & { captureStream?: () => MediaStream };
type AnalysisGraph = {
  media: HTMLMediaElement;
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  leftAnalyser: AnalyserNode;
  rightAnalyser: AnalyserNode;
  splitter: ChannelSplitterNode;
  silent: GainNode;
};

let config: AnalysisConfig = { enabled: true, fftSize: 2048, sampleRate: 48000 };
let graph: AnalysisGraph | null = null;
let graphStart: Promise<AnalysisGraph | null> | null = null;
let graphGeneration = 0;
let lastFrameAt = 0;
let resetPublished = false;

function currentMedia() {
  const media = Array.from(document.querySelectorAll<HTMLMediaElement>("video, audio"));
  return media.find(item => !item.paused && !item.ended && item.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)
    || media.find(item => !item.ended && item.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)
    || null;
}

function publishReset() {
  if (resetPublished || !isTrustedOnlinePage()) return;
  resetPublished = true;
  ipcRenderer.send("online:analysis-reset");
}

function releaseGraph(active: AnalysisGraph) {
  try { active.source.disconnect(); } catch {}
  try { active.analyser.disconnect(); } catch {}
  try { active.leftAnalyser.disconnect(); } catch {}
  try { active.rightAnalyser.disconnect(); } catch {}
  try { active.splitter.disconnect(); } catch {}
  try { active.silent.disconnect(); } catch {}
  active.stream.getTracks().forEach(track => track.stop());
  void active.context.close().catch(() => undefined);
}

function destroyGraph(publish = true) {
  graphGeneration++;
  const active = graph;
  graph = null;
  if (active) {
    releaseGraph(active);
  }
  if (publish) publishReset();
}

async function createGraph(media: HTMLMediaElement) {
  const captureStream = (media as CapturableMedia).captureStream;
  if (typeof captureStream !== "function") return null;
  const stream = captureStream.call(media);
  if (!stream.getAudioTracks().length) {
    stream.getTracks().forEach(track => track.stop());
    return null;
  }
  const requestedRate = Math.max(8000, Math.min(192000, Math.round(config.sampleRate) || 48000));
  const context = new AudioContext({ latencyHint: "interactive", sampleRate: requestedRate });
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  const leftAnalyser = context.createAnalyser();
  const rightAnalyser = context.createAnalyser();
  const splitter = context.createChannelSplitter(2);
  const silent = context.createGain();
  analyser.fftSize = config.fftSize;
  analyser.smoothingTimeConstant = 0;
  analyser.minDecibels = -90;
  analyser.maxDecibels = -10;
  leftAnalyser.fftSize = rightAnalyser.fftSize = 1024;
  leftAnalyser.smoothingTimeConstant = rightAnalyser.smoothingTimeConstant = 0;
  silent.gain.value = 0;
  source.connect(analyser);
  source.connect(splitter);
  splitter.connect(leftAnalyser, 0);
  splitter.connect(rightAnalyser, 1);
  analyser.connect(silent);
  leftAnalyser.connect(silent);
  rightAnalyser.connect(silent);
  silent.connect(context.destination);
  await context.resume();
  return { media, stream, context, source, analyser, leftAnalyser, rightAnalyser, splitter, silent };
}

async function ensureGraph() {
  if (!config.enabled || !isTrustedOnlinePage()) {
    destroyGraph();
    return null;
  }
  const media = currentMedia();
  if (!media || media.paused || media.ended) {
    destroyGraph();
    return null;
  }
  if (graph?.media === media && graph.context.state !== "closed"
    && graph.stream.getAudioTracks().some(track => track.readyState === "live")) {
    graph.analyser.fftSize = config.fftSize;
    if (graph.context.state === "suspended") await graph.context.resume();
    return graph;
  }
  if (graphStart) return graphStart;
  destroyGraph(false);
  const generation = graphGeneration;
  graphStart = (async () => {
    try {
      const created = await createGraph(media);
      if (created && (generation !== graphGeneration || !config.enabled || currentMedia() !== media)) {
        releaseGraph(created);
        return null;
      }
      graph = created;
      if (graph) resetPublished = false;
      else publishReset();
      return graph;
    } catch {
      graph = null;
      publishReset();
      return null;
    } finally {
      graphStart = null;
    }
  })();
  return graphStart;
}

async function sample() {
  const active = await ensureGraph();
  if (!active || performance.now() - lastFrameAt < 30) return;
  lastFrameAt = performance.now();
  const frequency = new Uint8Array(active.analyser.frequencyBinCount);
  const left = new Float32Array(active.leftAnalyser.fftSize);
  const right = new Float32Array(active.rightAnalyser.fftSize);
  active.analyser.getByteFrequencyData(frequency);
  active.leftAnalyser.getFloatTimeDomainData(left);
  active.rightAnalyser.getFloatTimeDomainData(right);
  ipcRenderer.send("online:analysis-frame", {
    sampleRate: active.context.sampleRate,
    fftSize: active.analyser.fftSize,
    frequency,
    left,
    right
  });
}

ipcRenderer.on("online:analysis-config", (_event, next: Partial<AnalysisConfig>) => {
  const fftSize = Number(next?.fftSize);
  const sampleRate = Number(next?.sampleRate);
  const previousRate = config.sampleRate;
  config = {
    enabled: next?.enabled !== false,
    fftSize: allowedFftSizes.has(fftSize) ? fftSize : 2048,
    sampleRate: Number.isFinite(sampleRate) && sampleRate >= 8000 && sampleRate <= 192000 ? sampleRate : 48000
  };
  if (!config.enabled || config.sampleRate !== previousRate) destroyGraph();
  void sample();
});

window.addEventListener("message", event => {
  if (!isTrustedOnlinePage() || event.source !== window || event.origin !== TRUSTED_ONLINE_ORIGIN) return;
  const message = event.data;
  if (!message?.__auralisPlayerTimeline || !message.state) return;
  const state = message.state;
  if (!Number.isFinite(state.currentTime) || !Number.isFinite(state.duration)) return;
  ipcRenderer.send("online:media-state", state);
  void sample();
});

const analysisTimer = window.setInterval(() => { void sample(); }, 33);
window.addEventListener("pagehide", () => {
  window.clearInterval(analysisTimer);
  destroyGraph(false);
}, { once: true });
