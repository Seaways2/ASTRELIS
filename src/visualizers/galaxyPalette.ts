export type Rgb = readonly [number, number, number];

/**
 * Colours of the Galaxy Spiral, all derived from the theme accent so the scene
 * still follows the theme while reading like a real spiral galaxy:
 * blue-white young stars along the arms, a warm golden bulge, a neighbouring
 * hue for variation in the arm haze, and the opposite hue for glowing nebula
 * knots. A grey accent keeps the extra hues muted instead of inventing colour.
 */
export interface GalaxyPalette {
  accent: Rgb;
  /** Young blue-white stars. */
  ice: Rgb;
  /** Old stars of the inner disk and the bulge. */
  warm: Rgb;
  /** Almost white centre of the core. */
  core: Rgb;
  /** Neighbouring hue for the arm haze. */
  analog: Rgb;
  /** Opposite hue for star-forming nebula knots. */
  nebula: Rgb;
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const mix = (from: Rgb, to: Rgb, amount: number): Rgb =>
  [0, 1, 2].map(index => Math.round(from[index] + (to[index] - from[index]) * amount)) as unknown as Rgb;

export function rgbToHsl([red, green, blue]: Rgb): [number, number, number] {
  const r = red / 255, g = green / 255, b = blue / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > .5 ? delta / (2 - max - min) : delta / (max + min);
  const hue = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [hue * 60, saturation, lightness];
}

export function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const h = ((hue % 360) + 360) % 360 / 360;
  if (saturation <= 0) {
    const grey = Math.round(lightness * 255);
    return [grey, grey, grey];
  }
  const q = lightness < .5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = (t: number) => {
    const wrapped = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (wrapped < 1 / 6) return p + (q - p) * 6 * wrapped;
    if (wrapped < 1 / 2) return q;
    if (wrapped < 2 / 3) return p + (q - p) * (2 / 3 - wrapped) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map(value => Math.round(value * 255)) as unknown as Rgb;
}

export function galaxyPalette(accent: Rgb): GalaxyPalette {
  const [hue, saturation, lightness] = rgbToHsl(accent);
  // Vivid accents get vivid companions; a grey accent only gains a hint of hue.
  const companion = saturation >= .12 ? Math.max(saturation, .55) : saturation + .16;
  return {
    accent,
    ice: mix(accent, [255, 255, 255], .58),
    warm: mix(accent, [255, 220, 168], .74),
    core: mix(accent, [255, 247, 232], .9),
    analog: hslToRgb(hue - 34, companion, clamp(lightness, .52, .66)),
    nebula: hslToRgb(hue + 150, Math.min(1, companion * 1.1), .7)
  };
}

export const rgba = (color: Rgb, alpha: number) => `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
