import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { AmbientBackgroundOptions } from "../utils/ambientBackground";
import type { GpuVisualQuality } from "../visualizers/gpuVisualRuntime";

interface Props {
  enabled: boolean;
  accent: string;
  light: boolean;
  lightSurface: string;
  opacity: number;
  customBackground: boolean;
  gpu: boolean;
  quality: GpuVisualQuality;
}
type RenderRequest = {
  id: number; width: number; height: number; options: AmbientBackgroundOptions;
  pixelRatio: number;
  layout: { left: number; top: number; widthDelta: number; heightDelta: number };
};
type RenderResult = { id: number; width: number; height: number; pixels: Uint8ClampedArray; durationMs: number; error?: string };

function colorBytes(color: string): [number, number, number] {
  const parser = document.createElement("canvas");
  parser.width = parser.height = 1;
  const context = parser.getContext("2d", { willReadFrequently: true });
  if (!context) return [57, 217, 233];
  context.fillStyle = "#39d9e9";
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const data = context.getImageData(0, 0, 1, 1).data;
  return [data[0], data[1], data[2]];
}

/** Static window tint is cached by a worker; music modulates existing CSS reflections. */
export function AmbientBackground(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scheduleRef = useRef<(() => void) | null>(null);
  const options = useMemo<AmbientBackgroundOptions>(() => ({
    accent: colorBytes(props.accent),
    top: props.light ? colorBytes(props.lightSurface) : [8, 14, 17],
    bottom: props.light ? colorBytes(props.lightSurface) : [5, 9, 12],
    opacity: props.opacity,
    bottomOpacityScale: props.light ? .92 : .97,
    baseGlow: props.light ? .13 : .07,
    gpuGain: props.gpu ? ({ eco: .09, standard: .18, cosmic: .25 }[props.quality]) : 0,
    customBackground: props.customBackground
  }), [props.accent, props.light, props.lightSurface, props.opacity, props.gpu, props.quality, props.customBackground]);
  const latest = useRef(options);
  latest.current = options;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const shell = canvas?.parentElement;
    if (!props.enabled || !canvas || !shell) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;
    let disposed = false;
    let failed = false;
    let revision = 0;
    let busy: RenderRequest | null = null;
    let timer: number | undefined;
    let committedKey = "";
    let worker: Worker;
    const positionCanvas = (target: HTMLCanvasElement, request: RenderRequest) => {
      target.style.left = `${request.layout.left}px`;
      target.style.top = `${request.layout.top}px`;
      target.style.width = `calc(100% + ${request.layout.widthDelta}px)`;
      target.style.height = `calc(100% + ${request.layout.heightDelta}px)`;
    };
    const fallback = (reason: string) => {
      committedKey = "";
      delete shell.dataset.ambientReady;
      shell.dataset.ambientFallback = reason;
      canvas.hidden = true;
    };
    try {
      worker = new Worker(new URL("../workers/ambientBackground.worker.ts", import.meta.url), { type: "module" });
    } catch {
      fallback("worker-unavailable");
      return () => { delete shell.dataset.ambientFallback; };
    }
    const dispatch = () => {
      timer = undefined;
      if (disposed || failed || busy) return;
      const bounds = shell.getBoundingClientRect();
      const style = getComputedStyle(shell);
      const borderLeft = parseFloat(style.borderLeftWidth) || 0;
      const borderTop = parseFloat(style.borderTopWidth) || 0;
      const paddingWidth = bounds.width - borderLeft - (parseFloat(style.borderRightWidth) || 0);
      const paddingHeight = bounds.height - borderTop - (parseFloat(style.borderBottomWidth) || 0);
      const pixelRatio = devicePixelRatio;
      // clientLeft/clientWidth round CSS pixels; a 1-device-pixel border is
      // fractional CSS at 125%/150% and must retain its fractional geometry.
      const originX = bounds.left + borderLeft;
      const originY = bounds.top + borderTop;
      const pixelX = Math.round(originX * pixelRatio);
      const pixelY = Math.round(originY * pixelRatio);
      const width = Math.round((originX + paddingWidth) * pixelRatio) - pixelX;
      const height = Math.round((originY + paddingHeight) * pixelRatio) - pixelY;
      if (!width || !height) return;
      if (width * height > 16_777_216) { fallback("pixel-limit"); return; }
      const key = JSON.stringify([width, height, latest.current, pixelRatio]);
      if (key === committedKey) return;
      busy = { id: revision, width, height, options: latest.current, pixelRatio, layout: {
        left: pixelX / pixelRatio - originX,
        top: pixelY / pixelRatio - originY,
        widthDelta: width / pixelRatio - paddingWidth,
        heightDelta: height / pixelRatio - paddingHeight
      } };
      worker.postMessage(busy);
    };
    const schedule = () => {
      revision++;
      window.clearTimeout(timer);
      timer = window.setTimeout(dispatch, 60);
    };
    scheduleRef.current = schedule;
    worker.onmessage = (event: MessageEvent<RenderResult>) => {
      const request = busy;
      busy = null;
      if (disposed || !request || event.data.id !== request.id) return;
      // Both pending size and colour changes invalidate an in-flight result.
      if (request.id !== revision) { if (timer === undefined) dispatch(); return; }
      if (event.data.error) { failed = true; fallback("render-error"); worker.terminate(); return; }
      const { width, height, pixels, durationMs } = event.data;
      // Keep coverage during a resize; at commit each edge lands on a physical
      // pixel, avoiding a second interpolated pass at fractional Windows DPI.
      positionCanvas(canvas, request);
      canvas.width = width;
      canvas.height = height;
      context.putImageData(new ImageData(pixels, width, height), 0, 0);
      canvas.hidden = false;
      canvas.dataset.renderId = String(request.id);
      canvas.dataset.renderKey = JSON.stringify([width, height, request.options, request.pixelRatio]);
      canvas.dataset.renderMs = durationMs.toFixed(1);
      committedKey = canvas.dataset.renderKey;
      delete shell.dataset.ambientFallback;
      shell.dataset.ambientReady = "true";
    };
    worker.onerror = () => { failed = true; busy = null; fallback("worker-error"); worker.terminate(); };
    const observer = new ResizeObserver(schedule);
    observer.observe(shell);
    window.addEventListener("resize", schedule);
    let resolution: MediaQueryList;
    const watchResolution = () => {
      resolution?.removeEventListener("change", resolutionChanged);
      resolution = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
      resolution.addEventListener("change", resolutionChanged);
    };
    const resolutionChanged = () => { watchResolution(); schedule(); };
    watchResolution();
    schedule();
    return () => {
      disposed = true;
      scheduleRef.current = null;
      window.clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      resolution.removeEventListener("change", resolutionChanged);
      worker.terminate();
      delete shell.dataset.ambientReady;
      delete shell.dataset.ambientFallback;
    };
  }, [props.enabled]);

  useEffect(() => { scheduleRef.current?.(); }, [options]);
  return props.enabled ? <canvas ref={canvasRef} className="ambient-background-canvas" aria-hidden="true" /> : null;
}
