export interface AtmosphereSettings {
  coverColors: boolean;
  glassEdges: boolean;
  orbitParticles: boolean;
  trackTransition: boolean;
  intensity: number;
  response: number;
}
export const atmosphereDefaults: AtmosphereSettings = {
  coverColors: true, glassEdges: true, orbitParticles: false,
  trackTransition: true, intensity: .3, response: 1.6
};
export function normalizeAtmosphere(input: unknown): AtmosphereSettings {
  const base = { ...atmosphereDefaults };
  if (!input || typeof input !== "object") return base;
  const value = input as Record<string, unknown>;
  for (const key of Object.keys(base) as Array<keyof AtmosphereSettings>) {
    if (key === "response") {
      if (typeof value.response === "number" && Number.isFinite(value.response)) base.response = Math.max(0, Math.min(3, value.response));
    } else if (key === "intensity") {
      if (typeof value[key] === "number" && Number.isFinite(value[key])) base.intensity = Math.max(0, Math.min(1, value[key]));
    } else if (typeof value[key] === "boolean") base[key] = value[key];
  }
  // Prefer the existing reflection choice; old breathing-only profiles migrate here.
  if (typeof value.glassEdges !== "boolean" && typeof value.breathing === "boolean") base.glassEdges = value.breathing;
  return base;
}
export function atmosphereEnergy(low: number, rms: number, response = 1) {
  const safe = (v: number) => Number.isFinite(v) ? Math.max(0, v) : 0;
  const signal = safe(low) * .65 + safe(rms) * 2.4;
  return Math.min(1, Math.pow(Math.max(0, signal - .006), .6) * Math.min(3, safe(response)));
}
// One bounded gain multiplies the existing reflection instead of adding light.
export function reflectionGain(energy: number) {
  return .25 + .75 * (Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : 0);
}
export function coverPalette(pixels: ArrayLike<number>, fallback: string): [string, string] {
  const bins = new Map<string, { rgb: number[]; weight: number }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]].map(v => Math.min(255, Math.floor(v / 32) * 32 + 16));
    const hi = Math.max(...rgb), lo = Math.min(...rgb);
    if (hi < 40 || lo > 225 || hi - lo < 24) continue;
    const key = rgb.join(",");
    const old = bins.get(key);
    bins.set(key, { rgb, weight: (old?.weight || 0) + 1 + (hi - lo) / 255 });
  }
  const colors = [...bins.values()].sort((a, b) => b.weight - a.weight);
  if (!colors.length) return [fallback, fallback];
  const first = colors[0].rgb;
  const second = colors.find(c => c.rgb.reduce((sum, v, i) => sum + Math.abs(v - first[i]), 0) > 100)?.rgb;
  const css = (rgb: number[]) => `rgb(${rgb.join(", ")})`;
  return [css(first), second ? css(second) : fallback];
}
