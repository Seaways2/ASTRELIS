import type { MeterSnapshot, VisualizerMode, VisualizerRenderSettings } from "../types/audio";
import { frameIsDue, nextFrameDue } from "./framePacing";

// Bar count above which particle effects stop growing (the default bar count).
export const PARTICLE_EFFECT_UNIT_CAP = 90;

/** The render settings a scene reads; the options cross to the worker, so they stay plain values. */
export type VisualizerSceneSettings = Pick<VisualizerRenderSettings,
  "smoothing" | "sensitivity" | "barCount" | "barOpacity" | "lineWidth" | "animationSpeed" | "decaySpeed" | "peakHoldMs" | "lowPerformance">;

export interface VisualizerSceneOptions {
  mode: VisualizerMode;
  accent: string;
  settings: VisualizerSceneSettings;
  glowStrength: number;
  playbackActive: boolean;
  backgroundBrightness: number;
  backgroundOpacity: number;
}

/**
 * Canvas geometry measured on the page. The scene may run in a worker, which
 * has no layout access, so everything it needs about the page arrives here.
 */
export interface VisualizerLayout {
  /** Backing-store size in device pixels. */
  width: number;
  height: number;
  /** Device pixel ratio of the backing store. */
  ratio: number;
  /** The canvas CSS box and the viewport; the black-hole lens aligns the wallpaper with them. */
  left: number;
  top: number;
  cssWidth: number;
  cssHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface VisualizerAudioSource {
  getFrequencyData(): Uint8Array;
  meters(): MeterSnapshot;
}

export type VisualizerSurface = HTMLCanvasElement | OffscreenCanvas;

export interface VisualizerScene {
  resize(layout: VisualizerLayout): void;
  setLensImage(image: ImageBitmap | undefined): void;
  draw(now: number, audio: VisualizerAudioSource): void;
}

export function visualizerTargetFps(options: Pick<VisualizerSceneOptions, "playbackActive" | "settings">) {
  return !options.playbackActive ? 15 : options.settings.lowPerformance ? 30 : 60;
}

const createLayer = (): VisualizerSurface => typeof OffscreenCanvas === "function"
  ? new OffscreenCanvas(1, 1)
  : document.createElement("canvas");

/**
 * Builds one visualizer: its particle populations, smoothing state and frame
 * pacing. It only draws; the caller supplies layout, audio data and the frame
 * clock, so the same scene runs on the page or inside the visualizer worker.
 */
export function createVisualizerScene(
  canvas: VisualizerSurface,
  options: VisualizerSceneOptions,
  onFps?: (fps: number) => void
): VisualizerScene {
  const { mode, accent, settings, glowStrength, playbackActive, backgroundBrightness, backgroundOpacity } = options;
  // Both canvas kinds expose the same 2D API for everything drawn here.
  const context = canvas.getContext("2d", { alpha: true }) as unknown as CanvasRenderingContext2D | null;
  if (!context) return { resize() {}, setLensImage() {}, draw() {} };
  let lensBackground: ImageBitmap | undefined;
  let layout: VisualizerLayout = {
    width: 1, height: 1, ratio: 1, left: 0, top: 0, cssWidth: 1, cssHeight: 1, viewportWidth: 1, viewportHeight: 1
  };
  const size = { width: 1, height: 1 };
  const accentHex = accent.replace("#", "");
  const expandedAccent = accentHex.length === 3
    ? accentHex.split("").map(value => value + value).join("")
    : accentHex;
  const parsedAccent = Number.parseInt(expandedAccent, 16);
  const accentRed = Number.isFinite(parsedAccent) ? (parsedAccent >> 16) & 255 : 48;
  const accentGreen = Number.isFinite(parsedAccent) ? (parsedAccent >> 8) & 255 : 211;
  const accentBlue = Number.isFinite(parsedAccent) ? parsedAccent & 255 : 225;
  const galaxyAccent = (alpha: number) => `rgba(${accentRed},${accentGreen},${accentBlue},${alpha})`;
  const starsPerEffectUnit = settings.lowPerformance ? 4 : 8;
  // Particle populations follow the bar setting only up to the default. The
  // spectrum may use up to 160 bars, but at that setting the starfield,
  // galaxy and black hole drew ~78% more particles and visibly stuttered.
  const particleUnits = Math.min(settings.barCount, PARTICLE_EFFECT_UNIT_CAP);
  const starCount = Math.max(96, Math.round(particleUnits * starsPerEffectUnit));
  const starEffectSize = .5 + settings.lineWidth / 3;
  // Thumbnails keep the same distributions with a thinner population.
  const particleCount = starCount;
  const particles = Array.from({ length: particleCount }, (_, index) => ({
    x: (Math.random() - .5) * 2.2,
    y: (Math.random() - .5) * 1.45,
    z: .04 + (index / particleCount) * .96,
    previousZ: .04 + (index / particleCount) * .96,
    size: .26 + Math.random() * .84,
    twinkle: Math.random() * Math.PI * 2,
    twinkleSpeed: 1.3 + Math.random() * 6.7,
    response: .25 + Math.random() * .95,
    frequency: Math.floor(Math.random() * 96)
  }));
  const coreMoteCount = settings.lowPerformance
    ? Math.max(36, Math.round(particleUnits * .8))
    : Math.max(64, Math.round(particleUnits * 1.4));
  const coreMotes = Array.from({ length: coreMoteCount }, () => ({
    angle: Math.random() * Math.PI * 2,
    radius: .5 + Math.random() * .62,
    speed: (.16 + Math.random() * .42) * (Math.random() > .24 ? 1 : -1),
    tilt: -.72 + Math.random() * 1.44,
    size: .22 + Math.random() * .76,
    phase: Math.random() * Math.PI * 2,
    response: .25 + Math.random() * .75
  }));
  const galaxyDustPerEffectUnit = settings.lowPerformance ? 8 : 24;
  const galaxyDustCount = Math.max(192, Math.round(particleUnits * galaxyDustPerEffectUnit));
  const galaxyLiveStarsPerEffectUnit = settings.lowPerformance ? 3 : 6;
  const galaxyLiveStarCount = Math.max(120, Math.round(particleUnits * galaxyLiveStarsPerEffectUnit));
  const galaxyLiveStars = Array.from({ length: galaxyLiveStarCount }, (_, index) => {
    const radius = .06 + Math.pow(Math.random(), .72) * .92;
    const layer = radius < .36 ? 0 : radius < .68 ? 1 : 2;
    const arm = index % 4;
    const armScatter = (Math.random() + Math.random() + Math.random() - 1.5) * (.12 + radius * .14);
    const ridgeBand = Math.min(1, Math.max(0, (radius - .2) / .05))
      * Math.min(1, Math.max(0, (.85 - radius) / .05));
    const ridgeCenter = Math.max(0, 1 - Math.abs(armScatter) / (.05 + radius * .045));
    return {
      radius,
      layer,
      angle: arm * Math.PI / 2 + radius * 5.65 + armScatter,
      radialScatter: (Math.random() - .5) * (.025 + radius * .055),
      size: .28 + Math.random() * .92,
      phase: Math.random() * Math.PI * 2,
      twinkleSpeed: .65 + Math.random() * 2.8,
      response: .25 + Math.random() * .75,
      frequency: Math.floor(Math.random() * 112),
      ridgeLift: 1 + ridgeBand * ridgeCenter * .16
    };
  });
  const galaxyOrbitMoteCount = settings.lowPerformance
    ? Math.max(42, Math.round(particleUnits * .9))
    : Math.max(84, Math.round(particleUnits * 1.7));
  const galaxyOrbitMotes = Array.from({ length: galaxyOrbitMoteCount }, () => ({
    angle: Math.random() * Math.PI * 2,
    radius: .68 + Math.pow(Math.random(), .72) * .52,
    speed: (.035 + Math.random() * .085) * (Math.random() > .16 ? 1 : -.58),
    tilt: -.58 + Math.random() * 1.16,
    size: .24 + Math.random() * .72,
    phase: Math.random() * Math.PI * 2,
    response: .25 + Math.random() * .75,
    frequency: Math.floor(Math.random() * 112)
  }));
  const galaxyInnerOrbitMoteCount = settings.lowPerformance
    ? Math.max(32, Math.round(particleUnits * .65))
    : Math.max(64, Math.round(particleUnits * 1.2));
  const galaxyInnerOrbitMotes = Array.from({ length: galaxyInnerOrbitMoteCount }, () => ({
    angle: Math.random() * Math.PI * 2,
    radius: .12 + Math.pow(Math.random(), .8) * .58,
    speed: (.055 + Math.random() * .13) * (Math.random() > .12 ? 1 : -.52),
    tilt: -.46 + Math.random() * .92,
    size: .2 + Math.random() * .64,
    phase: Math.random() * Math.PI * 2,
    response: .28 + Math.random() * .72,
    frequency: Math.floor(Math.random() * 112)
  }));
  const galaxyLayers = Array.from({ length: 3 }, createLayer);
  const galaxyFogLayer = createLayer();
  let galaxyLayerSize = 0;
  let frame = 0;
  let lastDraw = 0;
  let nextDue = 0;
  let fpsStarted = performance.now();
  let fpsFrames = 0;
  const displayedBars: number[] = [];
  let displayedPulseEnergy = 0;
  let pulseBassLevel = 0;
  let pulseBeatTarget = 0;
  let pulseBeat = 0;
  let pulseMidLevel = 0;
  let pulseHighLevel = 0;
  let pulseCoreMotion = 0;
  let pulseCoreVelocity = 0;
  let lastPulseBeatAt = -10;
  const pulseShockwaves: Array<{ progress: number; strength: number; tilt: number; radius: number }> = [];
  let starBassLevel = 0;
  let starBeatTarget = 0;
  let starBeatFlash = 0;
  let lastStarBeatAt = -10;
  let galaxyLow = 0;
  let galaxyBassLevel = 0;
  let galaxyMid = 0;
  let galaxyHigh = 0;
  let galaxyBeatTarget = 0;
  let galaxyBeatFlash = 0;
  let galaxySceneGlow = 0;
  let galaxyRotationVelocity = .055 * settings.animationSpeed;
  const galaxyLayerAngles = [0, .73, 1.41];
  let galaxyWaveProgress = 2;
  let galaxyWaveStrength = 0;
  let lastGalaxyBeatAt = -10;
  const peakBars: number[] = [];
  const peakTimes: number[] = [];

  const rebuildGalaxyLayers = () => {
    if (mode !== "waveform") return;
    const nextSize = Math.max(96, Math.ceil(Math.min(size.width, size.height) * 1.16));
    if (nextSize === galaxyLayerSize) return;
    galaxyLayerSize = nextSize;
    const layerRanges = [[.04, .42], [.27, .73], [.56, 1]] as const;
    const layerWeights = [.3, .38, .32];
    const maximumRadius = nextSize * .43;
    galaxyFogLayer.width = nextSize;
    galaxyFogLayer.height = nextSize;
    const fogLayerContext = galaxyFogLayer.getContext("2d", { alpha: true }) as unknown as CanvasRenderingContext2D;
    fogLayerContext.clearRect(0, 0, nextSize, nextSize);
    fogLayerContext.globalCompositeOperation = "lighter";
    fogLayerContext.lineCap = "round";
    fogLayerContext.lineJoin = "round";
    // Each arm is one continuous curve. Only broad, heavily blurred passes
    // remain here; a narrow center stroke reads as a painted tube instead of
    // diffuse galactic haze.
    for (let arm = 0; arm < 4; arm++) {
      const armFogPath = new Path2D();
      for (let sample = 0; sample <= 96; sample++) {
        const normalizedRadius = .055 + sample / 96 * .925;
        const angle = arm * Math.PI / 2 + normalizedRadius * 5.65;
        const radius = maximumRadius * normalizedRadius;
        const cloudX = nextSize / 2 + Math.cos(angle) * radius;
        const cloudY = nextSize / 2 + Math.sin(angle) * radius;
        sample ? armFogPath.lineTo(cloudX, cloudY) : armFogPath.moveTo(cloudX, cloudY);
      }
      const fogPasses = [
        { width: .24, blur: .065, color: galaxyAccent(.062) },
        { width: .14, blur: .042, color: galaxyAccent(.052) }
      ];
      fogPasses.forEach((pass) => {
        fogLayerContext.filter = `blur(${Math.max(.7, maximumRadius * pass.blur)}px)`;
        fogLayerContext.lineWidth = maximumRadius * pass.width;
        fogLayerContext.strokeStyle = pass.color;
        fogLayerContext.stroke(armFogPath);
      });
    }
    fogLayerContext.filter = "none";
    // Fade the continuous ribbons along their length as well as across their
    // width. This removes visible round caps and lets the haze grow out of
    // the inner galaxy before dissolving toward the outer edge.
    fogLayerContext.globalCompositeOperation = "destination-in";
    fogLayerContext.globalAlpha = 1;
    const fogLengthFade = fogLayerContext.createRadialGradient(
      nextSize / 2, nextSize / 2, maximumRadius * .06,
      nextSize / 2, nextSize / 2, maximumRadius * 1.08
    );
    fogLengthFade.addColorStop(0, "transparent");
    fogLengthFade.addColorStop(.12, "rgba(255,255,255,.08)");
    fogLengthFade.addColorStop(.24, "rgba(255,255,255,.58)");
    fogLengthFade.addColorStop(.48, "rgba(255,255,255,.82)");
    fogLengthFade.addColorStop(.72, "rgba(255,255,255,.66)");
    fogLengthFade.addColorStop(.88, "rgba(255,255,255,.24)");
    fogLengthFade.addColorStop(1, "transparent");
    fogLayerContext.fillStyle = fogLengthFade;
    fogLayerContext.fillRect(0, 0, nextSize, nextSize);
    fogLayerContext.globalCompositeOperation = "source-over";
    galaxyLayers.forEach((layer, layerIndex) => {
      layer.width = nextSize;
      layer.height = nextSize;
      const layerContext = layer.getContext("2d", { alpha: true }) as unknown as CanvasRenderingContext2D;
      layerContext.clearRect(0, 0, nextSize, nextSize);
      layerContext.globalCompositeOperation = "lighter";
      layerContext.fillStyle = accent;
      const [fromRadius, toRadius] = layerRanges[layerIndex];
      const count = Math.round(galaxyDustCount * layerWeights[layerIndex]);
      for (let index = 0; index < count; index++) {
        const normalizedRadius = fromRadius + Math.pow(Math.random(), .76) * (toRadius - fromRadius);
        const arm = index % 4;
        const armScatter = (Math.random() + Math.random() + Math.random() - 1.5) * (.14 + normalizedRadius * .22);
        const ridgeBand = Math.min(1, Math.max(0, (normalizedRadius - .2) / .05))
          * Math.min(1, Math.max(0, (.85 - normalizedRadius) / .05));
        const ridgeCenter = Math.max(0, 1 - Math.abs(armScatter) / (.05 + normalizedRadius * .045));
        const ridgeLift = 1 + ridgeBand * ridgeCenter * .16;
        const angle = arm * Math.PI / 2 + normalizedRadius * 5.65 + armScatter;
        const radius = maximumRadius * (normalizedRadius + (Math.random() - .5) * (.025 + normalizedRadius * .05));
        const x = nextSize / 2 + Math.cos(angle) * radius;
        const y = nextSize / 2 + Math.sin(angle) * radius;
        const brightNode = Math.random() > .94;
        const dotSize = Math.max(.45, (.35 + Math.random() * (brightNode ? 1.35 : .62)) * starEffectSize);
        layerContext.globalAlpha = (brightNode ? .24 : .045 + Math.random() * .105) * ridgeLift;
        layerContext.fillRect(x - dotSize / 2, y - dotSize / 2, dotSize, dotSize);
      }
    });
  };

  const resize = (next: VisualizerLayout) => {
    layout = next;
    size.width = next.width;
    size.height = next.height;
    const changed = canvas.width !== size.width || canvas.height !== size.height;
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
    if (changed || galaxyLayerSize === 0) rebuildGalaxyLayers();
  };

  const draw = (now: number, audio: VisualizerAudioSource) => {
    const frameInterval = 1000 / visualizerTargetFps(options);
    // (Re)start the schedule after a pause or a stall instead of catching up.
    if (nextDue === 0 || now - nextDue > frameInterval) nextDue = now;
    if (!frameIsDue(now, nextDue)) return;
    const deltaSeconds = Math.min(.1, Math.max(.001, (now - lastDraw) / 1000));
    const visualDecaySpeed = settings.decaySpeed * (playbackActive ? 1 : .28);
    lastDraw = now;
    nextDue = nextFrameDue(now, nextDue, frameInterval);
    fpsFrames++;
    if (now - fpsStarted >= 750) {
      onFps?.(Math.round(fpsFrames * 1000 / (now - fpsStarted)));
      fpsFrames = 0;
      fpsStarted = now;
    }
    const ratio = layout.ratio;
    const { width, height } = size;
    context.clearRect(0, 0, width, height);

    context.shadowColor = accent;
    context.shadowBlur = 12 * ratio * glowStrength;
    context.strokeStyle = context.fillStyle = accent;
    const barOpacity = Math.max(0, Math.min(1, settings.barOpacity));

    if (mode === "waveform") {
      const data = audio.getFrequencyData();
      const sampleRate = audio.meters().sampleRate || 48000;
      const hzPerBin = sampleRate / Math.max(2, data.length * 2);
      const averageHz = (fromHz: number, toHz: number) => {
        const start = Math.max(1, Math.min(data.length - 1, Math.floor(fromHz / hzPerBin)));
        const end = Math.max(start + 1, Math.min(data.length, Math.ceil(toHz / hzPerBin)));
        let sum = 0;
        for (let index = start; index < end; index++) sum += data[index];
        return Math.min(1, sum / Math.max(1, end - start) / 255 * settings.sensitivity);
      };
      const rawLow = averageHz(40, 180);
      const rawMid = averageHz(180, 2000);
      const rawHigh = averageHz(2000, 8000);
      const onset = Math.max(0, rawLow - galaxyBassLevel);
      const currentTime = now / 1000;
      const smoothing = Math.max(0, Math.min(.98, settings.smoothing));
      galaxyBassLevel += (rawLow - galaxyBassLevel)
        * Math.min(1, deltaSeconds * (rawLow > galaxyBassLevel ? 9 : 2.2));
      const lowAttack = 3.2 + (1 - smoothing) * 6;
      const lowRelease = 1.05 + settings.decaySpeed * .42;
      galaxyLow += (rawLow - galaxyLow) * Math.min(1, deltaSeconds * (rawLow > galaxyLow ? lowAttack : lowRelease));
      galaxyMid += (rawMid - galaxyMid) * Math.min(1, deltaSeconds * (rawMid > galaxyMid ? 4.1 : 1.2 + settings.decaySpeed * .48));
      galaxyHigh += (rawHigh - galaxyHigh) * Math.min(1, deltaSeconds * (rawHigh > galaxyHigh ? 6.4 : 1.6 + settings.decaySpeed * .62));
      if (onset > .035 && currentTime - lastGalaxyBeatAt > .16) {
        const beatStrength = Math.min(.9, .42 + onset * 4.5);
        galaxyBeatTarget = beatStrength;
        galaxyWaveStrength = Math.max(galaxyWaveStrength, beatStrength);
        if (galaxyWaveProgress >= 1) galaxyWaveProgress = 0;
        lastGalaxyBeatAt = currentTime;
      } else galaxyBeatTarget = Math.max(0, galaxyBeatTarget - deltaSeconds * 2.2);
      const galaxyBeatFadeSpeed = galaxyBeatTarget > galaxyBeatFlash ? 12 : 3.2;
      galaxyBeatFlash += (galaxyBeatTarget - galaxyBeatFlash)
        * Math.min(1, deltaSeconds * galaxyBeatFadeSpeed);
      const galaxySceneFadeSpeed = galaxyBeatFlash > galaxySceneGlow
        ? 9.2 + (1 - smoothing) * 1.8
        : 2.7 + (1 - smoothing) * .5;
      galaxySceneGlow += (galaxyBeatFlash - galaxySceneGlow)
        * Math.min(1, deltaSeconds * galaxySceneFadeSpeed);
      const targetRotationVelocity = .055 * settings.animationSpeed * (1 + galaxyLow * .18 + galaxyBeatFlash * .32);
      galaxyRotationVelocity += (targetRotationVelocity - galaxyRotationVelocity)
        * Math.min(1, deltaSeconds * (2.2 + (1 - smoothing) * 3.8));
      const layerSpeed = [1.32, .92, .62];
      for (let layer = 0; layer < galaxyLayerAngles.length; layer++)
        galaxyLayerAngles[layer] += deltaSeconds * galaxyRotationVelocity * layerSpeed[layer];
      if (galaxyWaveProgress < 1) {
        galaxyWaveProgress += deltaSeconds * (.24 + settings.animationSpeed * .13);
        if (galaxyWaveProgress >= 1) galaxyWaveStrength = 0;
      }

      const cx = width / 2;
      const cy = height / 2;
      const scale = Math.min(width, height);
      const maximumRadius = scale * .46;
      const effectSize = .5 + settings.lineWidth / 3;
      const galaxyGlow = Math.max(0, Math.min(3, glowStrength));
      const galaxySceneFlash = Math.min(.74, galaxySceneGlow * .86);
      context.shadowBlur = 0;
      context.globalCompositeOperation = "lighter";
      context.fillStyle = accent;

      // Reuse the Black Hole Pulse star-field layout behind the galaxy. It
      // covers the whole frame while remaining dim enough to preserve the
      // spiral silhouette and shares the same softened scene flash.
      particles.forEach((star) => {
        const x = cx + star.x * width * .49;
        const y = cy + star.y * height * .72;
        if (x < 0 || x > width || y < 0 || y > height) return;
        const depth = .35 + (1 - star.z) * .65;
        const energy = Math.min(1, data[Math.min(data.length - 1, star.frequency)] / 255 * settings.sensitivity);
        const sparkle = Math.pow(Math.max(0, Math.sin(currentTime * star.twinkleSpeed + star.twinkle)), 10);
        const backgroundBeatFlash = galaxySceneFlash * (.4 + star.response * .22);
        const backgroundStarRadius = Math.max(.38,
          (star.size * .5 + depth * .18 + sparkle * .5 + backgroundBeatFlash * .44) * ratio * effectSize);
        if (galaxyGlow > 0 && (sparkle > .06 || backgroundBeatFlash > .025)) {
          const galaxyBackgroundGlow = Math.min(.11,
            (.008 + sparkle * .024 + backgroundBeatFlash * .07) * galaxyGlow) * barOpacity;
          context.globalAlpha = galaxyBackgroundGlow;
          context.beginPath();
          context.arc(x, y, backgroundStarRadius * (1.85 + galaxyGlow * .34), 0, Math.PI * 2);
          context.fill();
        }
        context.globalAlpha = Math.min(.46,
          (.045 + depth * .075 + energy * star.response * .075 + sparkle * (.11 + galaxyHigh * .18) + backgroundBeatFlash * .62)
          * barOpacity);
        context.beginPath();
        context.arc(x, y, backgroundStarRadius, 0, Math.PI * 2);
        context.fill();
      });

      // Only a trace of central haze remains; the visible fog now grows
      // along each cached spiral arm instead of filling a uniform disk.
      context.save();
      context.translate(cx, cy);
      context.rotate(-.2);
      context.scale(1, .68);
      const diskGlow = context.createRadialGradient(0, 0, scale * .025, 0, 0, maximumRadius * 1.08);
      diskGlow.addColorStop(0, "rgba(245,255,255,.76)");
      diskGlow.addColorStop(.12, accent);
      diskGlow.addColorStop(.58, accent);
      diskGlow.addColorStop(1, "transparent");
      context.fillStyle = diskGlow;
      context.globalAlpha = Math.min(.065, (.055 + galaxyMid * .085 + galaxySceneFlash * .12 + galaxyGlow * .025) * barOpacity * .28);
      context.beginPath();
      context.arc(0, 0, maximumRadius * 1.08, 0, Math.PI * 2);
      context.fill();
      context.restore();

      if (galaxyLayerSize) {
        context.save();
        context.translate(cx, cy);
        context.scale(1, .68);
        context.rotate(galaxyLayerAngles[1]);
        context.globalAlpha = Math.min(.46,
          (.22 + galaxyMid * .11 + galaxySceneFlash * .075 + galaxyGlow * .018) * barOpacity);
        context.drawImage(galaxyFogLayer, -galaxyLayerSize / 2, -galaxyLayerSize / 2);
        context.restore();
      }

      // Three cached annular textures create inexpensive differential
      // rotation: the inner galaxy turns faster than its outer dust.
      galaxyLayers.forEach((layer, layerIndex) => {
        if (!galaxyLayerSize) return;
        context.save();
        context.translate(cx, cy);
        context.scale(1, .68);
        context.rotate(galaxyLayerAngles[layerIndex]);
        context.globalAlpha = Math.min(1, (.58 + galaxyMid * .22 + galaxySceneFlash * .16 - layerIndex * .055) * barOpacity);
        context.drawImage(layer, -galaxyLayerSize / 2, -galaxyLayerSize / 2);
        context.restore();
      });

      // A smaller live layer gives every visible arm musical sparkle without
      // paying the cost of updating all cached dust particles each frame.
      context.fillStyle = accent;
      galaxyLiveStars.forEach((star) => {
        const radius = maximumRadius * Math.max(.02, star.radius + star.radialScatter);
        const angle = star.angle + galaxyLayerAngles[star.layer];
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius * .68;
        const energy = Math.min(1, data[Math.min(data.length - 1, star.frequency)] / 255 * settings.sensitivity);
        const sparkle = Math.pow(Math.max(0, Math.sin(currentTime * star.twinkleSpeed + star.phase)), 8);
        const sharedBeatFlash = galaxySceneFlash * (.4 + star.response * .22);
        const starSize = Math.max(.48, (star.size + sparkle * .72 + sharedBeatFlash * .62) * ratio * effectSize);
        if (galaxyGlow > 0 && (sparkle > .08 || sharedBeatFlash > .04)) {
          context.globalAlpha = Math.min(.2, (.018 + sparkle * .045 + sharedBeatFlash * .095) * galaxyGlow) * barOpacity;
          const haloSize = starSize * (1.8 + galaxyGlow * .32);
          context.fillRect(x - haloSize / 2, y - haloSize / 2, haloSize, haloSize);
        }
        context.globalAlpha = Math.min(1, (.16 + star.response * .2 + energy * .22 + sparkle * (.24 + galaxyHigh * .42) + sharedBeatFlash) * barOpacity * star.ridgeLift);
        context.fillRect(x - starSize / 2, y - starSize / 2, starSize, starSize);
      });

      // Like the Black Hole Pulse motes, these particles orbit independently
      // on softly tilted ellipses. They keep the outer galaxy alive without
      // forcing the much denser cached spiral texture to update every frame.
      const drawGalaxyOrbitMote = (mote: typeof galaxyOrbitMotes[number]) => {
        mote.angle += deltaSeconds * mote.speed * settings.animationSpeed
          * (1 + galaxyLow * 1.15 + galaxyMid * .72 + galaxySceneFlash * .3);
        const orbit = maximumRadius * mote.radius;
        const cos = Math.cos(mote.angle);
        const sin = Math.sin(mote.angle);
        const x = cx + cos * orbit;
        const y = cy + sin * orbit * (.46 + Math.abs(mote.tilt) * .34) + cos * orbit * mote.tilt * .12;
        if (x < 0 || x > width || y < 0 || y > height) return;
        const energy = Math.min(1, data[Math.min(data.length - 1, mote.frequency)] / 255 * settings.sensitivity);
        const sparkle = Math.pow(Math.max(0, Math.sin(currentTime * (1.5 + mote.response * 3.2) + mote.phase)), 9);
        const moteBeatFlash = galaxySceneFlash * (.4 + mote.response * .22);
        const moteRadius = Math.max(.5, mote.size * ratio * (1.1 + sparkle * .78 + moteBeatFlash * .5) * effectSize);
        if (galaxyGlow > 0 && (sparkle > .06 || moteBeatFlash > .025)) {
          context.globalAlpha = Math.min(.25, (.02 + sparkle * .055 + moteBeatFlash * .15) * galaxyGlow) * barOpacity;
          context.beginPath();
          context.arc(x, y, moteRadius * (1.8 + galaxyGlow * .38), 0, Math.PI * 2);
          context.fill();
        }
        context.globalAlpha = Math.min(1, (.17 + energy * mote.response * .34 + sparkle * (.3 + galaxyHigh * .46) + moteBeatFlash) * barOpacity);
        context.beginPath();
        context.arc(x, y, moteRadius, 0, Math.PI * 2);
        context.fill();
        const sparkEnergy = galaxyHigh * mote.response * sparkle;
        if (sparkEnergy > .1) {
          const streakLength = maximumRadius * (.006 + sparkEnergy * .014);
          context.globalAlpha = Math.min(.25, sparkEnergy * .32) * barOpacity;
          context.lineWidth = Math.max(.4, .55 * ratio * effectSize);
          context.strokeStyle = accent;
          context.beginPath();
          context.moveTo(x, y);
          context.lineTo(x - sin * streakLength, y + cos * streakLength * .46);
          context.stroke();
        }
      };
      [galaxyInnerOrbitMotes, galaxyOrbitMotes].forEach((moteLayer) => moteLayer.forEach(drawGalaxyOrbitMote));

      // A beat launches one soft density ridge along all four arms. New
      // beats reinforce an active ridge instead of resetting its position.
      if (galaxyWaveProgress < 1) {
        const waveFade = Math.sin(Math.min(1, galaxyWaveProgress) * Math.PI) * galaxyWaveStrength;
        for (let arm = 0; arm < 4; arm++) {
          for (let sample = 0; sample < 22; sample++) {
            const spread = (sample / 21 - .5) * .105;
            const normalizedRadius = Math.max(.025, Math.min(1, galaxyWaveProgress + spread));
            const layer = normalizedRadius < .36 ? 0 : normalizedRadius < .68 ? 1 : 2;
            const angle = arm * Math.PI / 2 + normalizedRadius * 5.65 + galaxyLayerAngles[layer];
            const radius = maximumRadius * normalizedRadius;
            const x = cx + Math.cos(angle) * radius;
            const y = cy + Math.sin(angle) * radius * .68;
            const ridgeSize = Math.max(.55, (1.1 + waveFade * 1.4) * ratio * effectSize);
            context.globalAlpha = Math.min(.24, waveFade * .19 * Math.sin(sample / 21 * Math.PI)) * barOpacity;
            context.fillRect(x - ridgeSize / 2, y - ridgeSize / 2, ridgeSize, ridgeSize);
          }
        }
      }

      // The bright, tilted core remains theme-derived and shares the same
      // smoothed beat envelope as the rotating arms.
      const coreBreath = .5 + Math.sin(currentTime * (.54 + galaxyMid * .22)) * .5;
      const coreRadius = scale * (.073 + galaxyLow * .008 + galaxySceneFlash * .0045 + coreBreath * .0014)
        * (.92 + settings.lineWidth * .045);
      context.save();
      context.translate(cx, cy);
      context.rotate(-.28);
      context.scale(1, .46);
      if (galaxyGlow > 0) {
        const coreBloomRadius = coreRadius * (2.2 + galaxyGlow * .24);
        const coreBloom = context.createRadialGradient(0, 0, coreRadius * .22, 0, 0, coreBloomRadius);
        coreBloom.addColorStop(0, accent);
        coreBloom.addColorStop(.42, accent);
        coreBloom.addColorStop(1, "transparent");
        context.fillStyle = coreBloom;
        context.globalAlpha = Math.min(.46, (.1 + galaxyLow * .1 + galaxySceneFlash * .17) * galaxyGlow) * barOpacity;
        context.beginPath();
        context.arc(0, 0, coreBloomRadius, 0, Math.PI * 2);
        context.fill();
      }
      // Keep the white center extremely small. Several translucent,
      // theme-derived stops make the light build gradually from the clear
      // outer rim instead of reading as a static, flat white ellipse.
      const core = context.createRadialGradient(-coreRadius * .12, -coreRadius * .08, 0, 0, 0, coreRadius * 1.46);
      core.addColorStop(0, "rgba(250,255,255,.9)");
      core.addColorStop(.08, "rgba(250,255,255,.66)");
      core.addColorStop(.24, galaxyAccent(.62));
      core.addColorStop(.46, galaxyAccent(.34));
      core.addColorStop(.66, galaxyAccent(.16));
      core.addColorStop(.82, galaxyAccent(.07));
      core.addColorStop(1, "transparent");
      context.fillStyle = core;
      context.globalAlpha = Math.min(.9, (.48 + galaxyLow * .18 + galaxySceneFlash * .24 + coreBreath * .025) * barOpacity);
      context.beginPath();
      context.arc(0, 0, coreRadius * 1.46, 0, Math.PI * 2);
      context.fill();
      context.restore();
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 1;
    } else if (mode === "pulse") {
      const data = audio.getFrequencyData();
      const sampleRate = audio.meters().sampleRate || 48000;
      const hzPerBin = sampleRate / Math.max(2, data.length * 2);
      const averageHz = (fromHz: number, toHz: number) => {
        const start = Math.max(1, Math.min(data.length - 1, Math.floor(fromHz / hzPerBin)));
        const end = Math.max(start + 1, Math.min(data.length, Math.ceil(toHz / hzPerBin)));
        let sum = 0;
        for (let i = start; i < end; i++) sum += data[i];
        return Math.min(1, sum / Math.max(1, end - start) / 255 * settings.sensitivity);
      };
      const rawLow = averageHz(40, 180);
      const rawMid = averageHz(180, 2000);
      const rawHigh = averageHz(2000, 8000);
      const onset = Math.max(0, rawLow - pulseBassLevel);
      const currentTime = now / 1000;
      pulseBassLevel += (rawLow - pulseBassLevel)
        * Math.min(1, deltaSeconds * (rawLow > pulseBassLevel ? 9 : 2.2));
      if (onset > .035 && currentTime - lastPulseBeatAt > .16) {
        const beatStrength = Math.min(.9, .42 + onset * 4.5);
        pulseBeatTarget = beatStrength;
        // Apply an impulse to velocity instead of resetting an animation
        // phase. Position stays continuous across closely spaced beats.
        pulseCoreVelocity = Math.max(-.04, pulseCoreVelocity - beatStrength * .026);
        const travelingWave = pulseShockwaves.find((wave) => wave.progress < 1);
        if (travelingWave) {
          // Reinforce the wave already moving outwards. Starting another
          // bright ring at the core makes the apparent wavefront jump back.
          travelingWave.strength = Math.max(travelingWave.strength, beatStrength);
        } else {
          pulseShockwaves.push({ progress: 0, strength: beatStrength, tilt: -.08 + Math.random() * .16, radius: 0 });
        }
        lastPulseBeatAt = currentTime;
      } else pulseBeatTarget = Math.max(0, pulseBeatTarget - deltaSeconds * 2.2);
      const beatFadeSpeed = pulseBeatTarget > pulseBeat ? 12 : 3.2;
      pulseBeat += (pulseBeatTarget - pulseBeat) * Math.min(1, deltaSeconds * beatFadeSpeed);
      const envelopeSpeed = rawLow > displayedPulseEnergy ? 4.2 : 1.7;
      displayedPulseEnergy += (rawLow - displayedPulseEnergy) * Math.min(1, deltaSeconds * envelopeSpeed);
      pulseMidLevel += (rawMid - pulseMidLevel) * Math.min(1, deltaSeconds * (rawMid > pulseMidLevel ? 4.5 : 2));
      pulseHighLevel += (rawHigh - pulseHighLevel) * Math.min(1, deltaSeconds * (rawHigh > pulseHighLevel ? 7 : 3.8));
      const low = displayedPulseEnergy;
      // A damped spring gives the whole black-hole body a continuous
      // contraction and rebound. No beat can reset its scale or direction.
      const springStep = Math.min(deltaSeconds, .05);
      pulseCoreVelocity += (-pulseCoreMotion * 30 - pulseCoreVelocity * 7.5) * springStep;
      pulseCoreMotion += pulseCoreVelocity * springStep;
      const coreRebound = Math.min(1, Math.max(0, pulseCoreMotion / .004));
      const cx = width / 2, cy = height / 2;
      const scale = Math.min(width, height);
      const time = currentTime * settings.animationSpeed;
      const breath = .5 + Math.sin(time * .72) * .5;
      const pulseEnergy = Math.min(1, low * .42 + pulseBeat * .45 + coreRebound * .14);
      const pulseSceneFlash = pulseBeat;
      const pulseEffectScale = .72 + settings.lineWidth * .19;
      const coreRadius = scale * (.073 + low * .018 + pulseCoreMotion + breath * .0012) * pulseEffectScale;
      const orbitRadius = scale * (.35 + low * .015 + pulseBeat * .016 + coreRebound * .007) * pulseEffectScale;
      const glow = Math.min(2.2, Math.max(0, glowStrength));
      const pulseOpacity = barOpacity;
      context.globalCompositeOperation = "lighter";
      context.shadowBlur = 0;
      const makeLineGradient = (from: number, to: number, alpha = 1) => {
        const gradient = context.createLinearGradient(from, 0, to, 0);
        gradient.addColorStop(0, "transparent");
        gradient.addColorStop(.18, accent);
        gradient.addColorStop(.5, "rgba(235,255,255,.92)");
        gradient.addColorStop(.82, accent);
        gradient.addColorStop(1, "transparent");
        context.globalAlpha = alpha;
        return gradient;
      };

      // Re-sample the custom wallpaper through thin concentric annuli. Each
      // annulus uses a slightly different scale around the event horizon,
      // producing real local pixel displacement instead of a blurred ring.
      if (lensBackground && lensBackground.width > 0 && backgroundOpacity > 0) {
        const bounds = { left: layout.left, top: layout.top, width: layout.cssWidth, height: layout.cssHeight };
        const { viewportWidth, viewportHeight } = layout;
        const coverScale = Math.max(
          viewportWidth / lensBackground.width,
          viewportHeight / lensBackground.height
        );
        const imageCssWidth = lensBackground.width * coverScale;
        const imageCssHeight = lensBackground.height * coverScale;
        const backingScaleX = width / Math.max(1, bounds.width);
        const backingScaleY = height / Math.max(1, bounds.height);
        const imageX = ((viewportWidth - imageCssWidth) / 2 - bounds.left) * backingScaleX;
        const imageY = ((viewportHeight - imageCssHeight) / 2 - bounds.top) * backingScaleY;
        const imageWidth = imageCssWidth * backingScaleX;
        const imageHeight = imageCssHeight * backingScaleY;
        const lensInnerRadius = coreRadius * 1.18;
        const lensOuterRadius = coreRadius * 2.72;
        const lensRingCount = settings.lowPerformance ? 10 : 18;
        context.globalCompositeOperation = "source-over";
        context.filter = `brightness(${backgroundBrightness}) saturate(1.06)`;
        for (let ring = 0; ring < lensRingCount; ring++) {
          const innerMix = ring / lensRingCount;
          const outerMix = (ring + 1) / lensRingCount;
          const middleMix = (innerMix + outerMix) * .5;
          const distortionProfile = Math.pow(Math.sin(middleMix * Math.PI), 1.35);
          const innerRadius = lensInnerRadius + (lensOuterRadius - lensInnerRadius) * innerMix;
          const outerRadius = lensInnerRadius + (lensOuterRadius - lensInnerRadius) * outerMix + 1.2 * ratio;
          const refractionScale = 1 + distortionProfile * (.018 + low * .012 + pulseSceneFlash * .014);
          context.save();
          context.beginPath();
          context.arc(cx, cy, outerRadius, 0, Math.PI * 2);
          context.arc(cx, cy, innerRadius, 0, Math.PI * 2, true);
          context.clip("evenodd");
          context.translate(cx, cy);
          context.scale(refractionScale, 1 + (refractionScale - 1) * .82);
          context.translate(-cx, -cy);
          context.globalAlpha = Math.min(.16,
            distortionProfile * (.075 + low * .035 + pulseSceneFlash * .045))
            * Math.min(1, backgroundOpacity) * pulseOpacity;
          context.drawImage(lensBackground, imageX, imageY, imageWidth, imageHeight);
          context.restore();
        }
        context.filter = "none";
        context.globalCompositeOperation = "lighter";
      }

      // A dense, inexpensive deep star field surrounds the event horizon.
      particles.forEach((star) => {
        const baseX = star.x * width * .46;
        const baseY = star.y * height * .66;
        const distance = Math.max(1, Math.hypot(baseX, baseY));
        const lensRange = orbitRadius * 1.3;
        const lens = distance < lensRange ? Math.pow(1 - distance / lensRange, 2) : 0;
        const baseAngle = Math.atan2(baseY, baseX);
        const bentAngle = baseAngle + lens * (.07 + pulseMidLevel * .1) * (star.response > .58 ? 1 : -1);
        const lensedDistance = distance * (1 - lens * (.025 + pulseBeat * .035));
        const x = cx + Math.cos(bentAngle) * lensedDistance;
        const y = cy + Math.sin(bentAngle) * lensedDistance;
        if (x < 0 || x > width || y < 0 || y > height) return;
        const energy = Math.min(1, data[Math.min(data.length - 1, star.frequency)] / 255 * settings.sensitivity);
        const sparkle = Math.pow(Math.max(0, Math.sin(time * star.twinkleSpeed + star.twinkle)), 10);
        const sharedBeatFlash = pulseSceneFlash * (.4 + star.response * .22);
        const starRadius = Math.max(.48, (star.size * .68 + sparkle * .62 + lens * .34 + sharedBeatFlash * .6) * ratio * starEffectSize);
        if (glow > 0) {
          const pulseStarGlow = Math.min(.24, (.018 + sparkle * .045 + sharedBeatFlash * .14) * glow);
          context.globalAlpha = pulseStarGlow * pulseOpacity;
          context.beginPath();
          context.arc(x, y, starRadius * (1.8 + glow * .42), 0, Math.PI * 2);
          context.fill();
        }
        context.globalAlpha = Math.min(1, .2 + star.response * .26 + sparkle * (.26 + energy * .42) + pulseHighLevel * star.response * .12 + sharedBeatFlash) * pulseOpacity;
        context.beginPath();
        context.arc(x, y, starRadius, 0, Math.PI * 2);
        context.fill();
      });

      // Low-frequency transients release restrained gravitational waves.
      // Keep their travel independent from coreRadius: a fresh beat briefly
      // contracts the core, but an already emitted wave must never reverse.
      const shockwaveUnitRadius = scale * .073 * pulseEffectScale;
      for (let index = pulseShockwaves.length - 1; index >= 0; index--) {
        const wave = pulseShockwaves[index];
        const travelStep = deltaSeconds * (.52 + wave.strength * .16) * settings.animationSpeed;
        if (wave.radius <= 0) wave.radius = shockwaveUnitRadius * 1.45;
        wave.progress += travelStep;
        wave.radius += shockwaveUnitRadius * 7.2 * travelStep;
        if (wave.progress > 1) { pulseShockwaves.splice(index, 1); continue; }
        const fade = Math.pow(1 - wave.progress, 2);
        const radius = wave.radius;
        context.save();
        context.translate(cx, cy);
        context.rotate(wave.tilt);
        context.scale(1, .58 + wave.progress * .28);
        const waveGlow = context.createRadialGradient(0, 0, radius * .76, 0, 0, radius * 1.22);
        waveGlow.addColorStop(0, "transparent");
        waveGlow.addColorStop(.3, "transparent");
        waveGlow.addColorStop(.48, accent);
        waveGlow.addColorStop(.53, "rgba(235,255,255,.52)");
        waveGlow.addColorStop(.69, "transparent");
        waveGlow.addColorStop(1, "transparent");
        context.globalAlpha = Math.min(.12, wave.strength * fade * .12) * pulseOpacity;
        context.fillStyle = waveGlow;
        context.beginPath();
        context.arc(0, 0, radius * 1.22, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = Math.min(.07, wave.strength * fade * .07) * pulseOpacity;
        context.lineWidth = Math.max(.42, (1.05 - wave.progress * .52) * ratio * pulseEffectScale);
        context.strokeStyle = makeLineGradient(-radius, radius, context.globalAlpha);
        context.beginPath();
        context.arc(0, 0, radius, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
      context.fillStyle = accent;
      context.strokeStyle = accent;

      // Broken magnetic orbits rotate at independent speeds and inclinations.
      const pulseOrbitCount = settings.lowPerformance ? 4 : 6;
      for (let orbit = 0; orbit < pulseOrbitCount; orbit++) {
        const radius = orbitRadius * (.42 + orbit * .105);
        context.save();
        context.translate(cx, cy);
        context.rotate(time * (.055 + orbit * .014) * (orbit % 2 ? -1 : 1) + orbit * .91);
        context.scale(1, .28 + (orbit % 3) * .16);
        context.lineWidth = Math.max(.55, (orbit === 1 ? 1.35 : .75) * ratio);
        const fragments = 2 + orbit % 2;
        for (let fragment = 0; fragment < fragments; fragment++) {
          const start = fragment / fragments * Math.PI * 2 + time * (.035 + orbit * .006);
          const length = Math.PI * (.42 + (orbit % 3) * .1);
          const segments = 20;
          for (let segment = 0; segment < segments; segment++) {
            const p = segment / segments;
            const a0 = start + length * p;
            const a1 = start + length * (segment + 1) / segments;
            const fade = Math.sin(p * Math.PI);
            context.strokeStyle = accent;
            context.globalAlpha = fade * (.08 + low * .18 + pulseSceneFlash * .04 + (orbit === 1 ? .1 : 0)) * pulseOpacity;
            context.beginPath();
            context.arc(0, 0, radius, a0, a1 + .004);
            context.stroke();
          }
        }
        context.restore();
      }

      context.setLineDash([]);

      coreMotes.forEach((mote) => {
        mote.angle += deltaSeconds * mote.speed * settings.animationSpeed * (1 + low * 1.25 + pulseMidLevel * .95);
        const orbit = orbitRadius * mote.radius;
        const cos = Math.cos(mote.angle);
        const sin = Math.sin(mote.angle);
        const x = cx + cos * orbit;
        const y = cy + sin * orbit * (.22 + Math.abs(mote.tilt) * .48) + cos * orbit * mote.tilt * .17;
        const sparkle = Math.pow(Math.max(0, Math.sin(time * (2.1 + mote.response * 3) + mote.phase)), 8);
        const moteBeatFlash = pulseSceneFlash * (.4 + mote.response * .22);
        const moteRadius = Math.max(.55, mote.size * ratio * (1.18 + sparkle * .82 + moteBeatFlash * .44) * starEffectSize);
        if (glow > 0) {
          const moteGlow = Math.min(.28, (.025 + sparkle * .06 + moteBeatFlash * .16) * glow);
          context.globalAlpha = moteGlow * pulseOpacity;
          context.beginPath();
          context.arc(x, y, moteRadius * (1.75 + glow * .38), 0, Math.PI * 2);
          context.fill();
        }
        context.globalAlpha = Math.min(1, .22 + low * mote.response * .42 + sparkle * (.28 + low * .42 + pulseHighLevel * .45) + moteBeatFlash) * pulseOpacity;
        context.beginPath();
        context.arc(x, y, moteRadius, 0, Math.PI * 2);
        context.fill();
        const sparkEnergy = pulseHighLevel * mote.response * sparkle;
        if (sparkEnergy > .08) {
          const sparkLength = orbitRadius * (.008 + sparkEnergy * .018);
          context.globalAlpha = Math.min(.34, sparkEnergy * .42) * pulseOpacity;
          context.lineWidth = Math.max(.45, .62 * ratio * starEffectSize);
          context.strokeStyle = accent;
          context.beginPath();
          context.moveTo(x, y);
          context.lineTo(x - sin * sparkLength, y + cos * sparkLength * .45);
          context.stroke();
        }
      });

      // Accretion glow and disk are rendered before the dark core so the
      // event horizon cleanly occludes their rear half.
      const haloRadius = coreRadius * (2.18 + glow * .3 + pulseEnergy * .075);
      const halo = context.createRadialGradient(cx, cy, coreRadius * .62, cx, cy, haloRadius);
      halo.addColorStop(0, "rgba(0,0,0,0)");
      halo.addColorStop(.38, accent);
      halo.addColorStop(.57, accent);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      if (glow > 0) {
        const outerHaloRadius = haloRadius * (1.08 + glow * .1);
        const outerHalo = context.createRadialGradient(cx, cy, coreRadius * .82, cx, cy, outerHaloRadius);
        outerHalo.addColorStop(0, "transparent");
        outerHalo.addColorStop(.42, accent);
        outerHalo.addColorStop(1, "transparent");
        context.globalAlpha = Math.min(.24, glow * (.055 + pulseSceneFlash * .075 + low * .035)) * pulseOpacity;
        context.fillStyle = outerHalo;
        context.beginPath();
        context.arc(cx, cy, outerHaloRadius, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = Math.min(.72, .25 + low * .24 + pulseSceneFlash * .16 + glow * .08) * pulseOpacity;
      context.fillStyle = halo;
      context.beginPath();
      context.arc(cx, cy, haloRadius, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = accent;
      context.strokeStyle = accent;
      context.save();
      context.translate(cx, cy);
      context.rotate(-.035 + Math.sin(time * .17) * .012);
      if (glow > 0) {
        const diskBloom = Math.min(.2, glow * (.04 + pulseSceneFlash * .07 + low * .03));
        context.globalAlpha = diskBloom * pulseOpacity;
        context.lineWidth = Math.max(1.2, (3.2 + glow * 1.1) * ratio * pulseEffectScale);
        context.strokeStyle = makeLineGradient(-coreRadius * 3.1, coreRadius * 3.1, diskBloom * pulseOpacity);
        context.beginPath();
        context.ellipse(0, 0, coreRadius * (2.05 + pulseEnergy * .04), coreRadius * (.205 + pulseEnergy * .03), 0, 0, Math.PI * 2);
        context.stroke();
      }
      for (let disk = 0; disk < 7; disk++) {
        context.globalAlpha = (.065 + low * .05 + pulseMidLevel * .085 + pulseSceneFlash * .035 + (disk === 3 ? .2 + pulseSceneFlash * .055 : 0)) * pulseOpacity;
        context.lineWidth = Math.max(.5, (.62 + (6 - Math.abs(3 - disk)) * .22 + low * .75 + pulseMidLevel * .7) * ratio * pulseEffectScale);
        context.strokeStyle = makeLineGradient(-coreRadius * 2.9, coreRadius * 2.9, context.globalAlpha);
        context.beginPath();
        context.ellipse(0, 0, coreRadius * (1.35 + disk * .24 + pulseEnergy * .035), coreRadius * (.15 + disk * .027 + pulseEnergy * .024), 0, 0, Math.PI * 2);
        context.stroke();
      }
      context.restore();

      context.globalCompositeOperation = "source-over";
      const darkness = context.createRadialGradient(cx - coreRadius * .12, cy - coreRadius * .16, coreRadius * .06, cx, cy, coreRadius * 1.16);
      darkness.addColorStop(0, "rgba(0,0,0,.94)");
      darkness.addColorStop(.42, "rgba(0,2,3,.82)");
      darkness.addColorStop(.72, "rgba(1,5,7,.46)");
      darkness.addColorStop(1, "rgba(2,8,10,0)");
      context.fillStyle = darkness;
      context.globalAlpha = pulseOpacity;
      context.beginPath();
      context.arc(cx, cy, coreRadius * 1.16, 0, Math.PI * 2);
      context.fill();

      // The near side of the disk passes in front of the black silhouette.
      context.globalCompositeOperation = "lighter";
      context.globalAlpha = Math.min(1, .44 + low * .32 + pulseMidLevel * .18 + pulseSceneFlash * .12) * pulseOpacity;
      context.lineWidth = Math.max(1, (1.3 + pulseEnergy * 1.05 + pulseMidLevel * .45) * ratio * pulseEffectScale);
      context.strokeStyle = makeLineGradient(cx - coreRadius * 2.5, cx + coreRadius * 2.5, context.globalAlpha);
      context.beginPath();
      context.ellipse(cx, cy, coreRadius * (2.32 + pulseEnergy * .05), coreRadius * (.21 + pulseEnergy * .046), -.035, 0, Math.PI);
      context.stroke();
      context.globalAlpha = (.34 + low * .28 + pulseSceneFlash * .08) * pulseOpacity;
      context.lineWidth = Math.max(.75, (1 + low * .85 + pulseBeat * .32) * ratio * pulseEffectScale);
      context.strokeStyle = makeLineGradient(cx - coreRadius * 1.2, cx + coreRadius * 1.2, context.globalAlpha);
      context.beginPath();
      context.arc(cx, cy, coreRadius * 1.06, Math.PI * 1.04, Math.PI * 1.96);
      context.stroke();
      context.globalCompositeOperation = "source-over";
      context.fillStyle = accent;
      context.globalAlpha = 1;
    } else if (mode === "particles") {
      const data = audio.getFrequencyData();
      const cx = width / 2, cy = height / 2;
      const perspective = Math.min(width, height) * .64;
      let totalEnergy = 0;
      const energyBins = Math.max(1, Math.floor(data.length * .28));
      for (let i = 0; i < energyBins; i++) totalEnergy += data[i];
      const averageEnergy = Math.min(1, totalEnergy / energyBins / 255 * settings.sensitivity);
      const bassBins = Math.max(2, Math.floor(data.length * .055));
      let bassEnergy = 0;
      for (let i = 1; i < bassBins; i++) bassEnergy += data[i];
      const rawBass = Math.min(1, bassEnergy / Math.max(1, bassBins - 1) / 255 * settings.sensitivity);
      const bassOnset = Math.max(0, rawBass - starBassLevel);
      starBassLevel += (rawBass - starBassLevel) * Math.min(1, deltaSeconds * (rawBass > starBassLevel ? 9 : 2.2));
      if (bassOnset > .035 && now / 1000 - lastStarBeatAt > .16) {
        starBeatTarget = Math.min(.9, .42 + bassOnset * 4.5);
        lastStarBeatAt = now / 1000;
      } else starBeatTarget = Math.max(0, starBeatTarget - deltaSeconds * 2.2);
      const beatFadeSpeed = starBeatTarget > starBeatFlash ? 12 : 3.2;
      starBeatFlash += (starBeatTarget - starBeatFlash) * Math.min(1, deltaSeconds * beatFadeSpeed);
      const travel = deltaSeconds * (.13 + averageEnergy * .34 + starBeatFlash * .05) * settings.animationSpeed;
      const starGlow = Math.max(0, Math.min(3, glowStrength));
      const starfieldOpacity = barOpacity;
      const starfieldEffectSize = starEffectSize * .6;
      context.globalCompositeOperation = "lighter";
      // Canvas shadowBlur is disproportionately expensive on a fullscreen
      // transparent surface. Additive cores provide the glow at a fraction
      // of the GPU cost.
      context.shadowBlur = 0;
      context.lineCap = "round";
      particles.forEach((particle) => {
        const energy = Math.min(1, data[Math.min(data.length - 1, particle.frequency)] / 255 * settings.sensitivity);
        particle.previousZ = particle.z;
        particle.z -= travel * (.72 + particle.size * .2 + energy * .75);
        particle.twinkle += deltaSeconds * particle.twinkleSpeed * (1 + energy * 1.8);
        if (particle.z <= .025) {
          particle.x = (Math.random() - .5) * 2.2;
          particle.y = (Math.random() - .5) * 1.45;
          particle.z = 1;
          particle.previousZ = 1;
          particle.size = .26 + Math.random() * .84;
          particle.twinkleSpeed = 1.3 + Math.random() * 6.7;
          particle.response = .25 + Math.random() * .95;
        }
        const x = cx + particle.x / particle.z * perspective;
        const y = cy + particle.y / particle.z * perspective;
        const previousX = cx + particle.x / particle.previousZ * perspective;
        const previousY = cy + particle.y / particle.previousZ * perspective;
        if (x < -40 || x > width + 40 || y < -40 || y > height + 40) {
          particle.z = 1;
          particle.previousZ = 1;
          particle.x = (Math.random() - .5) * 2.2;
          particle.y = (Math.random() - .5) * 1.45;
          return;
        }
        const depth = 1 - particle.z;
        const slowShimmer = .58 + Math.sin(particle.twinkle) * .23;
        const sharpSparkle = Math.pow(Math.max(0, Math.sin(particle.twinkle * 2.17 + particle.frequency)), 9);
        const musicalFlash = Math.min(1.4,
          energy * particle.response * (.18 + sharpSparkle * .82)
          + starBeatFlash * (.4 + particle.response * .22));
        const shimmer = slowShimmer + musicalFlash;
        if (depth > .26 || musicalFlash > .32) {
          context.globalAlpha = Math.min(1, (.25 + depth * .58 + musicalFlash * .68) * shimmer) * starfieldOpacity;
          context.lineWidth = Math.max(.52, (particle.size * .72 + depth * .92 + energy * particle.response * .52) * ratio * starfieldEffectSize);
          context.beginPath();
          context.moveTo(previousX, previousY);
          context.lineTo(x, y);
          context.stroke();
        }
        context.globalAlpha = Math.min(1, .48 + depth * .52 + musicalFlash) * starfieldOpacity;
        context.beginPath();
        context.arc(x, y, Math.max(.55, (particle.size + depth * .82 + musicalFlash * .92) * ratio * starfieldEffectSize), 0, Math.PI * 2);
        context.fill();
        if (starGlow > 0 && (depth > .18 || musicalFlash > .18)) {
          context.globalAlpha = Math.min(.42, (.035 + depth * .075 + musicalFlash * .14) * starGlow) * starfieldOpacity;
          context.beginPath();
          context.arc(x, y, Math.max(1.25, (particle.size + 1.2 + depth * 2.15 + musicalFlash * 2.4) * ratio * (.72 + starGlow * .28) * starfieldEffectSize), 0, Math.PI * 2);
          context.fill();
        }
        if (musicalFlash > .52) {
          context.globalAlpha = Math.min(.82, musicalFlash * (.42 + starGlow * .13)) * starfieldOpacity;
          context.beginPath();
          context.arc(x, y, Math.max(1.1, (particle.size + musicalFlash * (1.8 + starGlow * .42)) * ratio * starfieldEffectSize), 0, Math.PI * 2);
          context.fill();
        }
      });
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 1;
    } else {
      const data = audio.getFrequencyData();
      const bars = Math.max(12, Math.min(settings.barCount, data.length));
      if (mode === "radial") {
        const scale = Math.min(width, height);
        let bass = 0;
        const bassEnd = Math.max(2, Math.floor(data.length * .035));
        for (let i = 1; i < bassEnd; i++) bass += data[i];
        bass = Math.min(1, bass / (bassEnd - 1) / 255 * settings.sensitivity);
        const cx = width / 2, cy = height / 2, radius = scale * (.18 + bass * .007);
        context.lineWidth = settings.lineWidth * ratio;
        for (let i = 0; i < bars; i++) {
          const energy = Math.min(1, data[Math.floor(i * data.length / bars * .46)] / 255 * settings.sensitivity);
          // Preserve the original FFT ordering while increasing separation
          // between quiet bands and musical peaks.
          const raw = Math.min(1, (energy ** 1.42) * 1.48);
          const value = Math.max(raw, (displayedBars[i] ?? 0) - visualDecaySpeed * deltaSeconds);
          displayedBars[i] = value;
          if (value >= (peakBars[i] ?? 0)) {
            peakBars[i] = value;
            peakTimes[i] = now;
          } else if (now - (peakTimes[i] ?? 0) > settings.peakHoldMs) {
            peakBars[i] = Math.max(value, (peakBars[i] ?? 0) - visualDecaySpeed * .46 * deltaSeconds);
          }
          const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
          context.beginPath();
          context.moveTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
          context.lineTo(cx + Math.cos(angle) * (radius + value * height * .31), cy + Math.sin(angle) * (radius + value * height * .31));
          context.globalAlpha = barOpacity;
          context.stroke();
          const peakRadius = radius + (peakBars[i] ?? value) * height * .31;
          const markerThickness = Math.max(.8 * ratio, settings.lineWidth * ratio * .55);
          const markerWidth = Math.max(.65, settings.lineWidth * ratio);
          const markerX = cx + Math.cos(angle) * peakRadius;
          const markerY = cy + Math.sin(angle) * peakRadius;
          context.save();
          context.translate(markerX, markerY);
          context.rotate(angle);
          context.globalAlpha = barOpacity * (.3 + Math.min(1, peakBars[i] ?? 0) * .34);
          context.fillStyle = accent;
          context.fillRect(-markerThickness / 2, -markerWidth / 2, markerThickness, markerWidth);
          context.restore();
        }
        context.globalAlpha = 1;
      } else {
        const gap = Math.min(3 * ratio, width / bars * .3);
        const barWidth = Math.max(1, width / bars - gap);
        for (let i = 0; i < bars; i++) {
          const raw = Math.min(1, data[Math.floor(i * data.length / bars * .5)] / 255 * settings.sensitivity);
          const value = Math.max(raw, (displayedBars[i] ?? 0) - visualDecaySpeed * deltaSeconds);
          displayedBars[i] = value;
          if (value >= (peakBars[i] ?? 0)) {
            peakBars[i] = value;
            peakTimes[i] = now;
          } else if (now - (peakTimes[i] ?? 0) > settings.peakHoldMs) {
            peakBars[i] = Math.max(0, (peakBars[i] ?? 0) - visualDecaySpeed * .55 * deltaSeconds);
          }
          const h = Math.max(2 * ratio, value * height * (mode === "mirror" ? .42 : .82));
          const x = i * (barWidth + gap);
          if (mode === "mirror") {
            context.globalAlpha = barOpacity;
            context.fillRect(x, height / 2 - h, barWidth, h);
            context.globalAlpha = barOpacity * .55;
            context.fillRect(x, height / 2, barWidth, h);
            const mirrorPeakHeight = (peakBars[i] ?? value) * height * .42;
            const mirrorPeakThickness = Math.max(1, ratio);
            const upperPeakY = height / 2 - mirrorPeakHeight;
            const lowerPeakY = height / 2 + mirrorPeakHeight - mirrorPeakThickness;
            context.globalAlpha = barOpacity;
            context.fillRect(x, upperPeakY, barWidth, mirrorPeakThickness);
            context.globalAlpha = barOpacity * .55;
            context.fillRect(x, lowerPeakY, barWidth, mirrorPeakThickness);
            context.globalAlpha = 1;
          } else {
            context.globalAlpha = barOpacity;
            context.fillRect(x, height - h, barWidth, h);
            const peakY = height - (peakBars[i] ?? 0) * height * .82;
            context.globalAlpha = barOpacity * .75;
            context.fillRect(x, peakY, barWidth, Math.max(1, ratio));
            context.globalAlpha = 1;
          }
        }
      }
    }
    frame++;
  };

  return {
    resize,
    setLensImage: image => { lensBackground = image; },
    draw
  };
}
