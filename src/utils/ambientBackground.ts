type Rgb = [number, number, number];

export interface AmbientBackgroundOptions {
  accent: Rgb;
  top: Rgb;
  bottom: Rgb;
  opacity: number;
  bottomOpacityScale: number;
  gpuGain: number;
  baseGlow: number;
  customBackground: boolean;
}

const MAX_PIXELS = 16_777_216;

function unit(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`Invalid ambient ${name}`);
  return Math.max(0, Math.min(1, value));
}

function colour(value: Rgb, name: string): Rgb {
  if (!Array.isArray(value) || value.length !== 3 || value.some(channel => !Number.isFinite(channel))) {
    throw new RangeError(`Invalid ambient ${name} colour`);
  }
  return value.map(channel => Math.max(0, Math.min(255, channel))) as Rgb;
}

function threshold(x: number, y: number): number {
  // A coordinate-only threshold stays still when themes change or the window
  // resizes. Sharing it across channels avoids independent coloured speckles.
  let value = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y ^ 0xc2b2ae35, 0x27d4eb2f);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function gaussianAxis(size: number, centre: number, radius: number): Float32Array {
  const axis = new Float32Array(size);
  for (let index = 0; index < size; index++) {
    const distance = (index + .5 - size * centre) / (size * radius);
    axis[index] = Math.exp(-2 * distance * distance);
  }
  return axis;
}

/**
 * Compose stationary ambient light in sRGB before its one final quantization.
 * Dimensions are physical pixels: scaling or blurring the finished canvas can
 * average out the adjacent-level rounding and reintroduce visible bands.
 */
export function createAmbientPixels(width: number, height: number, options: AmbientBackgroundOptions): Uint8ClampedArray {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > MAX_PIXELS / height) {
    throw new RangeError(`Ambient dimensions must be positive integers within ${MAX_PIXELS} pixels`);
  }
  const top = colour(options.top, "top");
  const bottom = colour(options.bottom, "bottom");
  const accent = colour(options.accent, "accent");
  const opacity = unit(options.opacity, "opacity");
  const bottomOpacityScale = unit(options.bottomOpacityScale, "bottom opacity scale");
  const gpuGain = unit(options.gpuGain, "GPU gain");
  const baseGlow = unit(options.baseGlow, "base glow");
  const lights = [
    { x: .48, y: .33, rx: .36, ry: .46, alpha: options.customBackground ? 0 : baseGlow },
    { x: .49, y: .35, rx: .50, ry: .60, alpha: .22 * gpuGain },
    { x: .08, y: .07, rx: .32, ry: .55, alpha: .12 * gpuGain },
    { x: .94, y: .86, rx: .34, ry: .57, alpha: .10 * gpuGain },
  ].filter(light => light.alpha > 0).map(light => ({
    x: gaussianAxis(width, light.x, light.rx),
    y: gaussianAxis(height, light.y, light.ry),
    alpha: light.alpha,
  }));
  const pixels = new Uint8ClampedArray(width * height * 4);
  const baseOpacity = options.customBackground ? 0 : opacity;
  let index = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++, index += 4) {
      const position = .45 * x / Math.max(1, width - 1) + .55 * y / Math.max(1, height - 1);
      let alpha = baseOpacity * (1 - (1 - bottomOpacityScale) * position);
      let red = (top[0] + (bottom[0] - top[0]) * position) * alpha;
      let green = (top[1] + (bottom[1] - top[1]) * position) * alpha;
      let blue = (top[2] + (bottom[2] - top[2]) * position) * alpha;
      for (const light of lights) {
        const lightAlpha = light.alpha * light.x[x] * light.y[y];
        red = accent[0] * lightAlpha + red * (1 - lightAlpha);
        green = accent[1] * lightAlpha + green * (1 - lightAlpha);
        blue = accent[2] * lightAlpha + blue * (1 - lightAlpha);
        alpha = lightAlpha + alpha * (1 - lightAlpha);
      }
      const random = threshold(x, y);
      const packedAlpha = Math.min(255, Math.floor(alpha * 255 + random));
      if (packedAlpha === 0) continue;
      // ImageData accepts straight RGB; select bytes that recover the desired
      // rounded premultiplied bytes when Chromium stores its canvas surface.
      const toStraight = 255 / packedAlpha;
      pixels[index] = Math.round(Math.min(packedAlpha, Math.floor(red + random)) * toStraight);
      pixels[index + 1] = Math.round(Math.min(packedAlpha, Math.floor(green + random)) * toStraight);
      pixels[index + 2] = Math.round(Math.min(packedAlpha, Math.floor(blue + random)) * toStraight);
      pixels[index + 3] = packedAlpha;
    }
  }
  return pixels;
}
