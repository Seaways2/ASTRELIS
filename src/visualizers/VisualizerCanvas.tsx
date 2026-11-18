import { useEffect, useRef, useState } from "react";
import type { VisualizerMode, VisualizerRenderSettings } from "../types/audio";
import { acquireVisualizerHost, releaseVisualizerHost, type VisualizerHost } from "./visualizerHost";
import type { VisualizerPointer } from "./visualizerScene";

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
  /** Hover and press effects (see VisualizerPointer); the page turns them off for ECO, OBS and reduced motion. */
  interactive?: boolean;
  /** The page shows this canvas inverted, as ink (the light theme); see VisualizerSceneOptions.ink. */
  ink?: boolean;
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
  backgroundOpacity = 1,
  interactive = false,
  ink = false
}: VisualizerCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const host = useRef<VisualizerHost>();
  const fpsListener = useRef(onFps);
  fpsListener.current = onFps;
  /** The latest pointer state, handed to every new scene so it starts where the pointer is. */
  const pointerState = useRef<VisualizerPointer>({ x: .5, y: .5, inside: false, pressed: false });
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
  const { smoothing, sensitivity, barCount, barOpacity, lineWidth, animationSpeed, decaySpeed, peakHoldMs, lowPerformance,
    flashStrength, glintAmount, accentShare, pointerStrength } = settings;
  useEffect(() => {
    const current = host.current;
    if (!current || !visible) return;
    current.configure({
      mode, accent, glowStrength, playbackActive, backgroundBrightness, backgroundOpacity, interactive, ink,
      settings: { smoothing, sensitivity, barCount, barOpacity, lineWidth, animationSpeed, decaySpeed, peakHoldMs, lowPerformance,
        flashStrength, glintAmount, accentShare, pointerStrength }
    });
    if (interactive) current.pointer({ ...pointerState.current, pressed: false });
    return () => current.stop();
  }, [
    mode, accent, glowStrength, backgroundBrightness, backgroundOpacity, playbackActive, visible, interactive, ink,
    smoothing, sensitivity, barCount, barOpacity, lineWidth, animationSpeed, decaySpeed, peakHoldMs, lowPerformance,
    flashStrength, glintAmount, accentShare, pointerStrength, canvasGeneration
  ]);

  useEffect(() => {
    host.current?.setBackground(backgroundUrl);
  }, [backgroundUrl, canvasGeneration]);

  // The scene gets the pointer as fractions of the canvas box: moves at most
  // once a frame, every press at once. Only the primary button presses;
  // the wheel (mode switch) and right-click (background menu) are untouched.
  useEffect(() => {
    const canvas = ref.current;
    const current = host.current;
    if (!canvas || !current || !interactive || !visible) return;
    const state = pointerState.current;
    let frame = 0;
    const send = (press = false) => current.pointer({ ...state, press });
    const locate = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      state.x = (event.clientX - bounds.left) / Math.max(1, bounds.width);
      state.y = (event.clientY - bounds.top) / Math.max(1, bounds.height);
      state.inside = true;
    };
    const move = (event: PointerEvent) => {
      locate(event);
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; send(); });
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      locate(event);
      state.pressed = true;
      cancelAnimationFrame(frame);
      frame = 0;
      send(true);
    };
    const up = () => {
      if (!state.pressed) return;
      state.pressed = false;
      send();
    };
    const leave = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      state.inside = false;
      state.pressed = false;
      send();
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("pointercancel", leave);
    window.addEventListener("pointerup", up);
    window.addEventListener("blur", leave);
    return () => {
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("pointercancel", leave);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("blur", leave);
      leave();
    };
  }, [interactive, visible, canvasGeneration]);

  return <canvas ref={ref} key={canvasGeneration} className="visualizer-canvas" />;
}
