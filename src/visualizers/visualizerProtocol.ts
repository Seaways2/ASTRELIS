import type { MeterSnapshot } from "../types/audio";
import type { VisualizerLayout, VisualizerPointer, VisualizerSceneOptions } from "./visualizerScene";

/**
 * Page → visualizer worker. One worker serves every visualizer canvas (a mode
 * switch mounts a new canvas for its transition); `id` names the canvas.
 */
export type VisualizerWorkerRequest =
  | { type: "attach"; id: number; canvas: OffscreenCanvas }
  | { type: "configure"; id: number; options: VisualizerSceneOptions }
  | { type: "layout"; id: number; layout: VisualizerLayout }
  | { type: "lens"; id: number; image?: ImageBitmap }
  | { type: "stop"; id: number }
  | { type: "pointer"; id: number; pointer: VisualizerPointer }
  | { type: "detach"; id: number }
  | { type: "audio"; frequency: Uint8Array; meters: MeterSnapshot };

/** Visualizer worker → page. */
export type VisualizerWorkerEvent = { type: "fps"; id: number; fps: number };
