import { useEffect, useRef, useState } from "react";
import type { VisualizerMode, VisualizerRenderSettings } from "../types/audio";
import { acquireVisualizerHost, releaseVisualizerHost, type VisualizerHost } from "./visualizerHost";

export { PARTICLE_EFFECT_UNIT_CAP } from "./visualizerScene";

interface VisualizerCanvasProps {
  mode: VisualizerMode;
  accent: string;
  settings: VisualizerRenderSettings;
  glowStrength?: number;
  onFps?: (fps: number) => void;
  playbackActive?: boolean;
  visible?: boolean;
  backgroundUrl?: string;
  backgroundBrightness?: number;
  backgroundOpacity?: number;
}

/** The scene itself lives in visualizerScene.ts and normally draws in a worker (see VisualizerHost). */
export function VisualizerCanvas({
  mode,
  accent,
  settings,
  glowStrength = 1,
  onFps,
  playbackActive = true,
  visible = true,
  backgroundUrl,
  backgroundBrightness = 1,
  backgroundOpacity = 1
}: VisualizerCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const host = useRef<VisualizerHost>();
  const fpsListener = useRef(onFps);
  fpsListener.current = onFps;
  // Bumped when a canvas element cannot be used, so React mounts a new one.
  const [canvasGeneration, setCanvasGeneration] = useState(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const current = acquireVisualizerHost(canvas);
    if (!current) {
      if (canvasGeneration < 3) setCanvasGeneration(canvasGeneration + 1);
      return;
    }
    current.onFps = fps => fpsListener.current?.(fps);
    host.current = current;
    return () => {
      host.current = undefined;
      releaseVisualizerHost(canvas);
    };
  }, [canvasGeneration]);

  // Only the fields the scene reads restart it.
  const { smoothing, sensitivity, barCount, barOpacity, lineWidth, animationSpeed, decaySpeed, peakHoldMs, lowPerformance } = settings;
  useEffect(() => {
    const current = host.current;
    if (!current || !visible) return;
    current.configure({
      mode, accent, glowStrength, playbackActive, backgroundBrightness, backgroundOpacity,
      settings: { smoothing, sensitivity, barCount, barOpacity, lineWidth, animationSpeed, decaySpeed, peakHoldMs, lowPerformance }
    });
    return () => current.stop();
  }, [
    mode, accent, glowStrength, backgroundBrightness, backgroundOpacity, playbackActive, visible,
    smoothing, sensitivity, barCount, barOpacity, lineWidth, animationSpeed, decaySpeed, peakHoldMs, lowPerformance,
    canvasGeneration
  ]);

  useEffect(() => {
    host.current?.setBackground(backgroundUrl);
  }, [backgroundUrl, canvasGeneration]);

  return <canvas ref={ref} key={canvasGeneration} className="visualizer-canvas" />;
}
