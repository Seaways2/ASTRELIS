import { useEffect, useRef, useState } from "react";
import { useAtmosphereStore } from "../stores/atmosphereStore";
import { atmosphereEnergy, coverPalette, reflectionGain } from "../utils/atmosphere";
import { audioEngine } from "../audio/AudioEngine";


interface Props { accent: string; cover?: string; trackKey: string; playing: boolean; disabled: boolean; motion: boolean; visible: boolean; }
export function AtmosphereLayer({ accent, cover, trackKey, playing, disabled, motion, visible }: Props) {
  const settings = useAtmosphereStore(state => state.settings);
  const layer = useRef<HTMLDivElement>(null);
  const energy = useRef(0);
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [palette, setPalette] = useState([accent, accent]);

  const enabled = !disabled && settings.intensity > 0;
  const moving = enabled && motion && !reduced && visible;

  useEffect(() => {
    const shell = layer.current?.parentElement;
    return () => { shell?.style.removeProperty("--fx-energy"); shell?.style.removeProperty("--fx-reflection-gain"); };
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

  useEffect(() => {
    const shell = layer.current?.parentElement;
    if (!shell) return;
    if (!moving || !settings.glassEdges || settings.response === 0) {
      energy.current = 0;
      shell.style.setProperty("--fx-energy", "0");
      shell.style.setProperty("--fx-reflection-gain", "1");
      return;
    }
    shell.style.setProperty("--fx-reflection-gain", String(reflectionGain(energy.current)));
    const timer = window.setInterval(() => {
      const meter = playing ? audioEngine.meters() : null;
      const target = meter ? atmosphereEnergy(meter.low, meter.rms, settings.response) : 0;
      const attack = .4;
      energy.current += (target - energy.current) * (target > energy.current ? attack : .12);
      if (energy.current < .001 && target === 0) energy.current = 0;
      shell.style.setProperty("--fx-energy", energy.current.toFixed(3));
      shell.style.setProperty("--fx-reflection-gain", String(reflectionGain(energy.current)));
      if (!playing && energy.current < .001) {
        energy.current = 0;
        shell.style.setProperty("--fx-energy", "0");
        window.clearInterval(timer);
      }
    }, 40);
    return () => { window.clearInterval(timer); };
  }, [moving, playing, settings.glassEdges, settings.response]);

  useEffect(() => {
    const shell = layer.current?.parentElement;
    if (!shell) return;
    let frame = 0;
    const reset = () => {
      cancelAnimationFrame(frame);
      shell.style.setProperty("--fx-light-x", "50%");
      shell.style.setProperty("--fx-light-y", "30%");
    };
    reset();
    if (!moving || !settings.glassEdges) return;
    const pointer = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = shell.getBoundingClientRect();
        const x = (event.clientX - rect.left) / Math.max(1, rect.width) - .5;
        const y = (event.clientY - rect.top) / Math.max(1, rect.height);
        shell.style.setProperty("--fx-light-x", `${Math.max(0, Math.min(100, (x + .5) * 100))}%`);
        shell.style.setProperty("--fx-light-y", `${Math.max(0, Math.min(100, y * 100))}%`);
      });
    };
    shell.addEventListener("pointermove", pointer);
    shell.addEventListener("pointerleave", reset);
    return () => { reset(); shell.removeEventListener("pointermove", pointer); shell.removeEventListener("pointerleave", reset); };
  }, [moving, settings.glassEdges, settings.intensity]);

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
