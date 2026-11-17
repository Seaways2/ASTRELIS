/** Returns a vivid complementary hue for meter peak indication. */
export function contrastPeakColor(color: string) {
  const normalized = color.trim().replace(/^#/, "");
  const source = normalized.length === 3
    ? normalized.split("").map(part => part + part).join("")
    : normalized.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(source)) return "hsl(350 95% 64%)";

  const [red, green, blue] = [0, 2, 4].map(offset => parseInt(source.slice(offset, offset + 2), 16) / 255);
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return `hsl(${Math.round((hue + 180) % 360)} 95% 62%)`;
}

type Rgb = [number, number, number];

/** Parses "#rgb", "#rrggbb" or "rgb(r g b)" / "rgb(r, g, b)"; undefined otherwise. */
export function parseColor(color: string): Rgb | undefined {
  const text = color.trim();
  const hex = text.replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) return hex.split("").map(part => parseInt(part + part, 16)) as Rgb;
  if (/^[0-9a-f]{6}$/i.test(hex)) return [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16)) as Rgb;
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/i.exec(text);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : undefined;
}

const luminance = ([red, green, blue]: Rgb) => {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : Math.pow((value + .055) / 1.055, 2.4);
  };
  return .2126 * linear(red) + .7152 * linear(green) + .0722 * linear(blue);
};

/** WCAG contrast ratio between two colours (1–21). */
export function contrastRatio(a: Rgb, b: Rgb) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + .05) / (dark + .05);
}

/** The light theme's darkest ink; a pale accent is deepened towards it. */
const LIGHT_THEME_INK: Rgb = [15, 42, 51];

/**
 * The accent as the light theme can use it for text, icons and outlines: a
 * pale accent (Ice Blue, Monochrome, a light custom colour) on the light
 * window could hardly be read. It is deepened towards the theme's ink just
 * until it reaches `ratio` against `surface`, keeping its hue; an accent that
 * already reads well is returned unchanged.
 */
export function readableAccent(accent: string, surface: string, ratio = 4.5) {
  const color = parseColor(accent);
  const background = parseColor(surface);
  if (!color || !background) return accent;
  if (contrastRatio(color, background) >= ratio) return accent;
  for (let step = 1; step <= 25; step++) {
    const amount = step / 25;
    const mixed = color.map((channel, index) => Math.round(channel + (LIGHT_THEME_INK[index] - channel) * amount)) as Rgb;
    if (contrastRatio(mixed, background) >= ratio || step === 25)
      return `#${mixed.map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
  }
  return accent;
}
