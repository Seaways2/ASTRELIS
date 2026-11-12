import type { VisualizerMode } from "../types/audio";

/** Shown on first launch and in place of retired modes (overview, waterfall, levels). */
export const DEFAULT_VISUALIZER_MODE: VisualizerMode = "waveform";
export const VISUALIZER_MODES: readonly VisualizerMode[] = ["waveform", "particles", "pulse", "spectrum", "mirror", "radial"];
export function normalizeVisualizerMode(value: unknown): VisualizerMode {
  return VISUALIZER_MODES.includes(value as VisualizerMode) ? value as VisualizerMode : DEFAULT_VISUALIZER_MODE;
}
