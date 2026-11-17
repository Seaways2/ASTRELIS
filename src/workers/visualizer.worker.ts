import type { MeterSnapshot } from "../types/audio";
import type { VisualizerWorkerEvent, VisualizerWorkerRequest } from "../visualizers/visualizerProtocol";
import { createVisualizerScene, type VisualizerAudioSource, type VisualizerLayout, type VisualizerScene } from "../visualizers/visualizerScene";

// The app's shared TS configuration includes DOM rather than WebWorker types.
interface VisualizerWorkerScope {
  onmessage: ((event: MessageEvent<VisualizerWorkerRequest>) => void) | null;
  postMessage(message: VisualizerWorkerEvent): void;
  requestAnimationFrame(callback: FrameRequestCallback): number;
}
const scope = globalThis as unknown as VisualizerWorkerScope;

interface Surface {
  canvas: OffscreenCanvas;
  scene?: VisualizerScene;
  layout?: VisualizerLayout;
  lens?: ImageBitmap;
  running: boolean;
}

const surfaces = new Map<number, Surface>();
const silentMeters: MeterSnapshot = { left: 0, right: 0, peak: 0, rms: 0, low: 0, mid: 0, high: 0, sampleRate: 48000 };
const latest: { frequency?: Uint8Array; meters: MeterSnapshot } = { meters: silentMeters };
const audio: VisualizerAudioSource = {
  getFrequencyData: () => latest.frequency!,
  meters: () => latest.meters
};
let frame = 0;

// The worker keeps its own frame clock: when the page's main thread is busy,
// the animation keeps moving with the most recent analyser frame instead of
// freezing until the page catches up. Each scene paces itself.
const tick = (now: number) => {
  frame = 0;
  let active = false;
  for (const surface of surfaces.values()) {
    if (!surface.running) continue;
    active = true;
    if (surface.scene && surface.layout && latest.frequency) surface.scene.draw(now, audio);
  }
  if (active) frame = scope.requestAnimationFrame(tick);
};
const wake = () => {
  if (!frame) frame = scope.requestAnimationFrame(tick);
};

scope.onmessage = ({ data }) => {
  if (data.type === "audio") {
    latest.frequency = data.frequency;
    latest.meters = data.meters;
    return;
  }
  if (data.type === "attach") {
    surfaces.set(data.id, { canvas: data.canvas, running: false });
    return;
  }
  const surface = surfaces.get(data.id);
  if (!surface) {
    if (data.type === "lens") data.image?.close();
    return;
  }
  switch (data.type) {
    case "configure":
      surface.scene = createVisualizerScene(surface.canvas, data.options, fps => scope.postMessage({ type: "fps", id: data.id, fps }));
      if (surface.layout) surface.scene.resize(surface.layout);
      surface.scene.setLensImage(surface.lens);
      surface.running = true;
      wake();
      break;
    case "layout":
      surface.layout = data.layout;
      surface.scene?.resize(data.layout);
      break;
    case "lens":
      surface.lens?.close();
      surface.lens = data.image;
      surface.scene?.setLensImage(data.image);
      break;
    case "stop":
      surface.running = false;
      break;
    case "pointer":
      surface.scene?.pointer(data.pointer);
      break;
    case "detach":
      surface.lens?.close();
      surfaces.delete(data.id);
      break;
  }
};
