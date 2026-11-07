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
