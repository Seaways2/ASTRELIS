import { audioEngine } from "../audio/AudioEngine";
import { frameIsDue, nextFrameDue } from "./framePacing";
import type { VisualizerWorkerEvent, VisualizerWorkerRequest } from "./visualizerProtocol";
import {
  createVisualizerScene, visualizerTargetFps,
  type VisualizerLayout, type VisualizerPointer, type VisualizerScene, type VisualizerSceneOptions
} from "./visualizerScene";

// The canvas size comes from ResizeObserver; this periodic re-read is only a
// safety net and must not run every frame (it forces a synchronous layout).
const CANVAS_SIZE_RECHECK_MS = 1000;
const MAX_BACKING_RATIO = 1.6;

const sameLayout = (a: VisualizerLayout | undefined, b: VisualizerLayout) => Boolean(a)
  && (Object.keys(b) as (keyof VisualizerLayout)[]).every(key => a![key] === b[key]);

// One worker draws every visualizer canvas: a mode switch mounts a new canvas
// for its transition, and starting a worker each time would delay its first frame.
let sharedWorker: Worker | null | undefined;
const fpsListeners = new Map<number, (fps: number) => void>();
let nextSurfaceId = 1;
let lastAudioPost = -1;

function visualizerWorker() {
  if (sharedWorker !== undefined) return sharedWorker;
  try {
    const worker = new Worker(new URL("../workers/visualizer.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<VisualizerWorkerEvent>) => {
      if (data.type === "fps") fpsListeners.get(data.id)?.(data.fps);
    };
    worker.onerror = event => console.error("[visualizer] worker failed:", event.message);
    sharedWorker = worker;
  } catch (error) {
    console.warn("[visualizer] drawing on the page:", error);
    sharedWorker = null;
  }
  return sharedWorker;
}

/**
 * Drives one visualizer canvas. The drawing runs in a worker on an
 * OffscreenCanvas, so library scrolling, mosaic layout and React renders no
 * longer share a thread with the particle effects; the page only measures the
 * canvas and posts the analyser frames. Without OffscreenCanvas support the
 * same scene draws on the page.
 */
export class VisualizerHost {
  onFps?: (fps: number) => void;
  private readonly worker?: Worker;
  private readonly id = nextSurfaceId++;
  /** Page-side scene, used only when the canvas could not move to the worker. */
  private scene?: VisualizerScene;
  private options?: VisualizerSceneOptions;
  private layout?: VisualizerLayout;
  /** Page-side lens image; the worker keeps its own transferred copy. */
  private lens?: ImageBitmap;
  private lensRequest = 0;
  private frame = 0;
  private resizeFrame = 0;
  private nextDue = 0;
  private lastSizeCheck = 0;
  private disposed = false;
  private readonly observer: ResizeObserver;

  constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.style.background = "transparent";
    const worker = typeof canvas.transferControlToOffscreen === "function" ? visualizerWorker() : null;
    if (worker) {
      const offscreen = canvas.transferControlToOffscreen();
      fpsListeners.set(this.id, fps => this.onFps?.(fps));
      worker.postMessage({ type: "attach", id: this.id, canvas: offscreen } satisfies VisualizerWorkerRequest, [offscreen]);
      this.worker = worker;
    }
    this.observer = new ResizeObserver(this.scheduleLayout);
    this.observer.observe(canvas.parentElement ?? canvas);
    window.addEventListener("resize", this.syncLayout);
  }

  configure(options: VisualizerSceneOptions) {
    this.options = options;
    if (this.worker) this.post({ type: "configure", id: this.id, options });
    else {
      this.scene = createVisualizerScene(this.canvas, options, fps => this.onFps?.(fps));
      this.scene.setLensImage(this.lens);
      if (this.layout) this.scene.resize(this.layout);
    }
    this.syncLayout();
    // CSS grid and media-query layout can settle a frame or two after mount.
    this.scheduleLayout();
    this.nextDue = 0;
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }

  stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.worker) this.post({ type: "stop", id: this.id });
    else this.scene = undefined;
  }

  /** The pointer over the canvas, for scenes configured as interactive. */
  pointer(state: VisualizerPointer) {
    if (this.worker) this.post({ type: "pointer", id: this.id, pointer: state });
    else this.scene?.pointer(state);
  }

  /** The black-hole lens re-samples the page wallpaper around the event horizon. */
  setBackground(url: string | undefined) {
    const request = ++this.lensRequest;
    this.applyLens(undefined);
    if (!url) return;
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    void image.decode()
      .then(() => createImageBitmap(image))
      .then(bitmap => {
        if (this.disposed || request !== this.lensRequest) bitmap.close();
        else this.applyLens(bitmap);
      })
      .catch(() => undefined);
  }

  dispose() {
    this.stop();
    this.disposed = true;
    this.observer.disconnect();
    window.removeEventListener("resize", this.syncLayout);
    cancelAnimationFrame(this.resizeFrame);
    if (this.worker) {
      this.post({ type: "detach", id: this.id });
      fpsListeners.delete(this.id);
    }
    this.lens?.close();
    this.lens = undefined;
  }

  private post(message: VisualizerWorkerRequest, transfer: Transferable[] = []) {
    this.worker!.postMessage(message, transfer);
  }

  private applyLens(bitmap: ImageBitmap | undefined) {
    if (this.worker) {
      this.post({ type: "lens", id: this.id, image: bitmap }, bitmap ? [bitmap] : []);
      return;
    }
    this.lens?.close();
    this.lens = bitmap;
    this.scene?.setLensImage(bitmap);
  }

  private tick = (now: number) => {
    this.frame = requestAnimationFrame(this.tick);
    if (now - this.lastSizeCheck >= CANVAS_SIZE_RECHECK_MS) {
      this.lastSizeCheck = now;
      this.syncLayout();
    }
    if (!this.worker) {
      this.scene?.draw(now, audioEngine);
      return;
    }
    // Read the analyser at the scene's frame rate, not the display's.
    if (!this.options) return;
    const frameInterval = 1000 / visualizerTargetFps(this.options);
    if (this.nextDue === 0 || now - this.nextDue > frameInterval) this.nextDue = now;
    if (!frameIsDue(now, this.nextDue)) return;
    this.nextDue = nextFrameDue(now, this.nextDue, frameInterval);
    // During a mode transition two canvases run; the worker shares one frame.
    if (now === lastAudioPost) return;
    lastAudioPost = now;
    const frequency = audioEngine.getFrequencyData().slice();
    this.post({ type: "audio", frequency, meters: audioEngine.meters() }, [frequency.buffer]);
  };

  private scheduleLayout = () => {
    cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = requestAnimationFrame(this.syncLayout);
    });
  };

  private syncLayout = () => {
    if (this.disposed) return;
    const ratio = Math.min(devicePixelRatio, MAX_BACKING_RATIO);
    const ownBounds = this.canvas.getBoundingClientRect();
    const parentBounds = this.canvas.parentElement?.getBoundingClientRect();
    // The backing store must describe the actual CSS canvas. Using the
    // BrowserWindow viewport here previously hid a responsive-layout bug:
    // the renderer drew a full-height frame into a canvas clipped to a
    // 68px grid row. The final immersive CSS invariant now owns the layout;
    // this code only mirrors the element it can really paint.
    const cssWidth = ownBounds.width || parentBounds?.width || 0;
    const cssHeight = ownBounds.height || parentBounds?.height || 0;
    // Frameless Windows resizing briefly reports a near-zero canvas. Keep
    // the previous backing store until the surrounding visual surface has
    // a valid size, otherwise a full-screen animation collapses to a sprite.
    if (cssWidth < 32 || cssHeight < 32) return;
    const layout: VisualizerLayout = {
      width: Math.max(1, Math.round(cssWidth * ratio)),
      height: Math.max(1, Math.round(cssHeight * ratio)),
      ratio,
      left: ownBounds.left,
      top: ownBounds.top,
      cssWidth,
      cssHeight,
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight
    };
    if (sameLayout(this.layout, layout)) return;
    this.layout = layout;
    if (this.worker) this.post({ type: "layout", id: this.id, layout });
    else this.scene?.resize(layout);
  };
}

const hosts = new WeakMap<HTMLCanvasElement, { host: VisualizerHost; release?: number }>();

/**
 * One host per canvas element: a canvas handed to the worker cannot be handed
 * over again. Returns undefined when this element already was (a hot-reloaded
 * module lost track of it); the caller then mounts a fresh canvas.
 */
export function acquireVisualizerHost(canvas: HTMLCanvasElement) {
  const entry = hosts.get(canvas);
  if (entry) {
    window.clearTimeout(entry.release);
    entry.release = undefined;
    return entry.host;
  }
  let host: VisualizerHost;
  try { host = new VisualizerHost(canvas); }
  catch (error) {
    console.warn("[visualizer] canvas unavailable, remounting:", error);
    return undefined;
  }
  hosts.set(canvas, { host });
  return host;
}

/**
 * StrictMode and Fast Refresh unmount and remount effects on the same element,
 * so disposal waits one task and a remount picks the same host back up.
 */
export function releaseVisualizerHost(canvas: HTMLCanvasElement) {
  const entry = hosts.get(canvas);
  if (!entry) return;
  window.clearTimeout(entry.release);
  entry.release = window.setTimeout(() => {
    hosts.delete(canvas);
    entry.host.dispose();
  }, 0);
}
