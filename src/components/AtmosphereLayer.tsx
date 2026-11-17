import { useEffect, useRef, useState } from "react";
import { useAtmosphereStore } from "../stores/atmosphereStore";
import { LIT_SURFACES, coverPalette } from "../utils/atmosphere";
import { ReflectionPulse, pulseDepth, reflectionGain } from "../utils/reflectionPulse";
import { audioEngine } from "../audio/AudioEngine";

/** Brightness steps written to CSS, and the shortest gap between writes: every write repaints the glass. */
const GAIN_STEPS = 50;
const MIN_WRITE_MS = 30;

interface Props { accent: string; cover?: string; trackKey: string; playing: boolean; disabled: boolean; motion: boolean; visible: boolean; }
export function AtmosphereLayer({ accent, cover, trackKey, playing, disabled, motion, visible }: Props) {
  const settings = useAtmosphereStore(state => state.settings);
  const layer = useRef<HTMLDivElement>(null);
  const pulse = useRef<ReflectionPulse | null>(null);
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [palette, setPalette] = useState([accent, accent]);

  const enabled = !disabled && settings.intensity > 0;
  const moving = enabled && motion && !reduced && visible;

  useEffect(() => {
    const shell = layer.current?.parentElement;
    return () => { shell?.style.removeProperty("--fx-reflection-gain"); };
  }, []);

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const commit = (colors: string[]) => {
      if (!cancelled) setPalette(old => old.join() === colors.join() ? old : colors);
    };
    // Clear the previous track's tint immediately while the new artwork loads.
    commit([accent, accent]);
    if (!enabled || !settings.coverColors || !cover) return;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer";
    image.decoding = "async";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 32;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(image, 0, 0, 32, 32);
        commit(coverPalette(ctx.getImageData(0, 0, 32, 32).data, accent));
      } catch { commit([accent, accent]); }
    };
    image.onerror = () => commit([accent, accent]);
    image.src = cover;
    return () => { cancelled = true; image.onload = image.onerror = null; image.removeAttribute("src"); };
  }, [accent, cover, enabled, settings.coverColors]);


  useEffect(() => {
    const shell = layer.current?.parentElement;
    if (!shell) return;
    shell.dataset.fxEdges = String(enabled && settings.glassEdges);
    shell.dataset.fxOrbit = String(enabled && settings.orbitParticles);
    shell.dataset.fxMotion = String(moving);
    shell.style.setProperty("--fx-strength", String(enabled ? settings.intensity : 0));
    shell.style.setProperty("--fx-color-a", palette[0]);
    shell.style.setProperty("--fx-color-b", palette[1]);
    return () => {
      for (const key of ["fxEdges", "fxOrbit", "fxMotion"]) delete shell.dataset[key];
      for (const key of ["--fx-strength", "--fx-color-a", "--fx-color-b"]) shell.style.removeProperty(key);
    };
  }, [enabled, moving, settings, palette]);

  // Brightness follows the song's relative level and its kicks (ReflectionPulse).
  // Analysis runs every frame; CSS is only written when the stepped value changes.
  useEffect(() => {
    const shell = layer.current?.parentElement;
    if (!shell) return;
    const depth = pulseDepth(settings.response);
    if (!moving || !settings.glassEdges || depth === 0) {
      pulse.current = null;
      shell.style.setProperty("--fx-reflection-gain", "1");
      return;
    }
    const reflection = pulse.current ??= new ReflectionPulse();
    let frame = 0, last = performance.now(), written = "", writtenAt = -Infinity;
    const write = (gain: number, now: number) => {
      const value = (Math.round(gain * GAIN_STEPS) / GAIN_STEPS).toFixed(2);
      if (value === written) return;
      written = value;
      writtenAt = now;
      shell.style.setProperty("--fx-reflection-gain", value);
    };
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const value = reflection.update(playing ? audioEngine.getFrequencyData() : null, audioEngine.analysisSampleRate, now / 1000, dt);
      // Paused and settled: rest at the calm level and stop the loop.
      if (!playing && value < .002) { write(reflectionGain(0, depth), now); return; }
      if (now - writtenAt >= MIN_WRITE_MS) write(reflectionGain(value, depth), now);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [moving, playing, settings.glassEdges, settings.response]);

  // The reflection is lit from the pointer: each surface gets the pointer's
  // position in its own coordinates, so a panel near the pointer brightens
  // where the pointer is and one further away only along its nearest edge.
  // Without a pointer every surface keeps the resting top light (50% 30%).
  useEffect(() => {
    const shell = layer.current?.parentElement;
    if (!shell || !moving || !settings.glassEdges) return;
    let frame = 0;
    let pointer: { x: number; y: number } | null = null;
    let lit = new Set<HTMLElement>();
    const unlight = (surface: HTMLElement) => {
      surface.style.removeProperty("--fx-light-x");
      surface.style.removeProperty("--fx-light-y");
    };
    const place = () => {
      frame = 0;
      if (!pointer) return;
      // Measure every surface first, then write: a read after each write
      // would force a style recalculation per surface.
      const placed: Array<[HTMLElement, DOMRect]> = [];
      for (const surface of shell.querySelectorAll<HTMLElement>(LIT_SURFACES)) {
        // A surface inside another is no second sheet of glass and draws no reflection.
        if (surface.parentElement?.closest(LIT_SURFACES)) continue;
        const box = surface.getBoundingClientRect();
        if (box.width && box.height && box.bottom >= 0 && box.top <= window.innerHeight) placed.push([surface, box]);
      }
      const next = new Set<HTMLElement>();
      for (const [surface, box] of placed) {
        surface.style.setProperty("--fx-light-x", `${Math.round(pointer.x - box.left)}px`);
        surface.style.setProperty("--fx-light-y", `${Math.round(pointer.y - box.top)}px`);
        next.add(surface);
      }
      for (const surface of lit) if (!next.has(surface)) unlight(surface);
      lit = next;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
    const move = (event: PointerEvent) => { pointer = { x: event.clientX, y: event.clientY }; schedule(); };
    const leave = () => {
      pointer = null;
      cancelAnimationFrame(frame);
      frame = 0;
      lit.forEach(unlight);
      lit = new Set();
    };
    shell.addEventListener("pointermove", move);
    shell.addEventListener("pointerleave", leave);
    // Scrolling moves the panels under a still pointer; scroll events do not bubble.
    shell.addEventListener("scroll", schedule, true);
    return () => {
      leave();
      shell.removeEventListener("pointermove", move);
      shell.removeEventListener("pointerleave", leave);
      shell.removeEventListener("scroll", schedule, true);
    };
  }, [moving, settings.glassEdges]);

  useEffect(() => {
    if (!moving || !settings.trackTransition || !trackKey) return;
    const elements = layer.current?.parentElement?.querySelectorAll(".transport-art, .transport-track-copy, .cd-surface");
    const animations = [...(elements || [])].map(element => element.animate(
      [{ opacity: .25 }, { opacity: 1 }], { duration: 650, easing: "ease-out" }
    ));
    return () => animations.forEach(animation => animation.cancel());
  }, [trackKey, moving, settings.trackTransition]);

  return <div ref={layer} className="atmosphere-layer" aria-hidden="true" data-enabled={enabled} />;
}
