import { useEffect, useRef } from "react";
import { audioEngine } from "../audio/AudioEngine";
import type { VisualizerMode, VisualizerRenderSettings } from "../types/audio";

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
  /** Small overview tile: fewer particles and a shared per-frame draw budget. */
  thumbnail?: boolean;
}

// Overview thumbnails cover a small fraction of a full visualizer. Drawing the
// full particle population in each of six tiles saturated the GPU process's
// Canvas2D rasterizer (measured ~19 FPS for the whole window while playing).
export const THUMBNAIL_PARTICLE_DENSITY = .4;
// At most this many thumbnails draw in one animation frame; the rest wait for
// the next frame, so six 30 FPS tiles no longer land in the same frame.
export const THUMBNAIL_DRAWS_PER_FRAME = 2;
const thumbnailFrameBudget = { frameTime: -1, used: 0 };
// The canvas size comes from ResizeObserver; this periodic re-read is only a
// safety net and must not run every frame (it forces a synchronous layout).
const CANVAS_SIZE_RECHECK_MS = 1000;

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
  thumbnail = false
}: VisualizerCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !visible) return;
    const canvasContext = canvas.getContext("2d", { alpha: true });
    if (!canvasContext) return;
    const context: CanvasRenderingContext2D = canvasContext;
    canvas.style.background = "transparent";
    const lensBackground = backgroundUrl ? new Image() : undefined;
    if (lensBackground && backgroundUrl) {
      lensBackground.decoding = "async";
      lensBackground.src = backgroundUrl;
    }
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
    const starCount = Math.max(96, Math.round(settings.barCount * starsPerEffectUnit));
    const starEffectSize = .5 + settings.lineWidth / 3;
    // Thumbnails keep the same distributions with a thinner population.
    const thinned = (count: number) => thumbnail ? Math.max(24, Math.round(count * THUMBNAIL_PARTICLE_DENSITY)) : count;
    const particleCount = thinned(starCount);
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
      ? Math.max(36, Math.round(settings.barCount * .8))
      : Math.max(64, Math.round(settings.barCount * 1.4));
    const coreMotes = Array.from({ length: thinned(coreMoteCount) }, () => ({
      angle: Math.random() * Math.PI * 2,
      radius: .5 + Math.random() * .62,
      speed: (.16 + Math.random() * .42) * (Math.random() > .24 ? 1 : -1),
      tilt: -.72 + Math.random() * 1.44,
      size: .22 + Math.random() * .76,
      phase: Math.random() * Math.PI * 2,
      response: .25 + Math.random() * .75
    }));
    const galaxyDustPerEffectUnit = settings.lowPerformance ? 8 : 24;
    const galaxyDustCount = Math.max(192, Math.round(settings.barCount * galaxyDustPerEffectUnit));
    const galaxyLiveStarsPerEffectUnit = settings.lowPerformance ? 3 : 6;
    const galaxyLiveStarCount = Math.max(120, Math.round(settings.barCount * galaxyLiveStarsPerEffectUnit));
    const galaxyLiveStars = Array.from({ length: thinned(galaxyLiveStarCount) }, (_, index) => {
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
      ? Math.max(42, Math.round(settings.barCount * .9))
      : Math.max(84, Math.round(settings.barCount * 1.7));
    const galaxyOrbitMotes = Array.from({ length: thinned(galaxyOrbitMoteCount) }, () => ({
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
      ? Math.max(32, Math.round(settings.barCount * .65))
      : Math.max(64, Math.round(settings.barCount * 1.2));
    const galaxyInnerOrbitMotes = Array.from({ length: thinned(galaxyInnerOrbitMoteCount) }, () => ({
      angle: Math.random() * Math.PI * 2,
      radius: .12 + Math.pow(Math.random(), .8) * .58,
      speed: (.055 + Math.random() * .13) * (Math.random() > .12 ? 1 : -.52),
      tilt: -.46 + Math.random() * .92,
      size: .2 + Math.random() * .64,
      phase: Math.random() * Math.PI * 2,
      response: .28 + Math.random() * .72,
      frequency: Math.floor(Math.random() * 112)
    }));
    const galaxyLayers = Array.from({ length: 3 }, () => document.createElement("canvas"));
    const galaxyFogLayer = document.createElement("canvas");
    let galaxyLayerSize = 0;
    const jellyArmChains = Array.from({ length: 6 }, () => Array.from({ length: settings.lowPerformance ? 10 : 15 }, () => ({
      x: Number.NaN, y: Number.NaN, vx: 0, vy: 0
    })));
    let frame = 0;
    let raf = 0;
    let lastDraw = 0;
    let lastSizeCheck = 0;
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
    let jellyLow = 0;
    let jellyMid = 0;
    let jellyHigh = 0;
    let jellyBeat = 0;
    let auroraLow = 0;
    let auroraMid = 0;
    let auroraHigh = 0;
    let auroraImpulse = 0;
    let auroraImpulseX = 0;
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
      const fogLayerContext = galaxyFogLayer.getContext("2d", { alpha: true })!;
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
        const layerContext = layer.getContext("2d", { alpha: true })!;
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

    const syncCanvasSize = () => {
      const ratio = Math.min(devicePixelRatio, 1.6);
      const ownBounds = canvas.getBoundingClientRect();
      const parentBounds = canvas.parentElement?.getBoundingClientRect();
      // The backing store must describe the actual CSS canvas. Using the
      // BrowserWindow viewport here previously hid a responsive-layout bug:
      // the renderer drew a full-height frame into a canvas clipped to a
      // 68px grid row. The final immersive CSS invariant now owns the layout;
      // this code only mirrors the element it can really paint.
      const cssWidth = ownBounds.width || parentBounds?.width || 0;
      const cssHeight = ownBounds.height || parentBounds?.height || 0;
      // Frameless Windows resizing briefly reports a near-zero canvas. Keep
      // the previous backing store until the surrounding visual surface has
      // a valid size, otherwise a full-screen animation collapses to a sprite.
      if (cssWidth < 32 || cssHeight < 32) return;
      size.width = Math.max(1, Math.round(cssWidth * ratio));
      size.height = Math.max(1, Math.round(cssHeight * ratio));
      const changed = canvas.width !== size.width || canvas.height !== size.height;
      if (canvas.width !== size.width) canvas.width = size.width;
      if (canvas.height !== size.height) canvas.height = size.height;
      if (changed || galaxyLayerSize === 0) rebuildGalaxyLayers();
    };
    let resizeFrame = 0;
    const scheduleCanvasSize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(syncCanvasSize);
    };
    const resize = new ResizeObserver(scheduleCanvasSize);
    resize.observe(canvas.parentElement ?? canvas);
    window.addEventListener("resize", syncCanvasSize);
    syncCanvasSize();
    const layoutFrame = requestAnimationFrame(() => requestAnimationFrame(syncCanvasSize));

    const draw = (now = performance.now()) => {
      const targetFps = !playbackActive ? 15 : settings.lowPerformance ? 30 : 60;
      const frameInterval = 1000 / targetFps;
      if (frameInterval && now - lastDraw < frameInterval) {
        raf = requestAnimationFrame(draw);
        return;
      }
      if (thumbnail) {
        // All rAF callbacks of one frame share the same timestamp.
        if (thumbnailFrameBudget.frameTime !== now) {
          thumbnailFrameBudget.frameTime = now;
          thumbnailFrameBudget.used = 0;
        }
        if (thumbnailFrameBudget.used >= THUMBNAIL_DRAWS_PER_FRAME) {
          raf = requestAnimationFrame(draw);
          return;
        }
        thumbnailFrameBudget.used++;
      }
      const deltaSeconds = Math.min(.1, Math.max(.001, (now - lastDraw) / 1000));
      const visualDecaySpeed = settings.decaySpeed * (playbackActive ? 1 : .28);
      lastDraw = now;
      fpsFrames++;
      if (now - fpsStarted >= 750) {
        onFps?.(Math.round(fpsFrames * 1000 / (now - fpsStarted)));
        fpsFrames = 0;
        fpsStarted = now;
      }
      if (now - lastSizeCheck >= CANVAS_SIZE_RECHECK_MS) {
        lastSizeCheck = now;
        syncCanvasSize();
      }
      const ratio = Math.min(devicePixelRatio, 1.6);
      const { width, height } = size;
      if (mode === "waterfall") {
        const data = audioEngine.getFrequencyData();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalCompositeOperation = "source-over";
        context.globalAlpha = 1;
        context.filter = "none";
        context.shadowBlur = 0;
        context.clearRect(0, 0, width, height);
        const averageBand = (from: number, to: number) => {
          const start = Math.max(1, Math.floor(data.length * from));
          const end = Math.max(start + 1, Math.floor(data.length * to));
          let sum = 0;
          for (let i = start; i < end; i++) sum += data[i];
          return Math.min(1, sum / (end - start) / 255 * settings.sensitivity);
        };
        const rawLow = averageBand(.002, .05);
        const rawMid = averageBand(.05, .24);
        const rawHigh = averageBand(.24, .65);
        const previousLow = auroraLow;
        auroraLow += (rawLow - auroraLow) * Math.min(1, deltaSeconds * (rawLow > auroraLow ? 3 : 1.15));
        auroraMid += (rawMid - auroraMid) * Math.min(1, deltaSeconds * 1.8);
        auroraHigh += (rawHigh - auroraHigh) * Math.min(1, deltaSeconds * 3.5);
        const onset = Math.max(0, rawLow - previousLow);
        if (onset > .035) { auroraImpulse = Math.min(1, .25 + onset * 3.2); auroraImpulseX = 0; }
        auroraImpulse = Math.max(0, auroraImpulse - deltaSeconds * .72);
        auroraImpulseX = Math.min(1.25, auroraImpulseX + deltaSeconds * (.34 + auroraLow * .18));
        const time = now / 1000 * settings.animationSpeed;
        const top = height * .12;
        const curtainHeight = height * .76;
        const hex = accent.replace("#", "");
        const expanded = hex.length === 3 ? hex.split("").map(value => value + value).join("") : hex;
        const parsed = Number.parseInt(expanded, 16);
        const red = Number.isFinite(parsed) ? (parsed >> 16) & 255 : 56;
        const green = Number.isFinite(parsed) ? (parsed >> 8) & 255 : 211;
        const blue = Number.isFinite(parsed) ? parsed & 255 : 225;
        context.globalCompositeOperation = "lighter";
        context.shadowBlur = 0;
        const curtainCount = settings.lowPerformance ? 5 : 7;
        for (let curtain = 0; curtain < curtainCount; curtain++) {
          const p = curtain / Math.max(1, curtainCount - 1);
          const phase = curtain * 1.37;
          const energy = data[Math.min(data.length - 1, 3 + curtain * 5)] / 255;
          const centerX = width * (.16 + p * .68)
            + Math.sin(time * (.14 + curtain * .008) + phase) * width * (.025 + auroraMid * .018);
          const widthAtTop = width * (.038 + energy * .025 + auroraLow * .012);
          const taper = .32 + .18 * Math.sin(time * .11 + phase);
          const impulseDistance = Math.abs(p - auroraImpulseX);
          const impulse = Math.exp(-impulseDistance * impulseDistance * 90) * auroraImpulse;
          const bend = Math.sin(time * .19 + phase) * width * (.035 + auroraMid * .02) + impulse * width * .028;
          const gradient = context.createLinearGradient(0, top, 0, top + curtainHeight);
          gradient.addColorStop(0, `rgb(${red} ${green} ${blue} / 0)`);
          gradient.addColorStop(.16, `rgb(${red} ${green} ${blue} / ${.14 + energy * .08})`);
          gradient.addColorStop(.52, `rgb(${red} ${green} ${blue} / ${.24 + auroraMid * .12})`);
          gradient.addColorStop(1, `rgb(${red} ${green} ${blue} / 0)`);
          context.fillStyle = gradient;
          context.globalAlpha = .62 - Math.abs(p - .5) * .28;
          context.beginPath();
          context.moveTo(centerX - widthAtTop, top);
          context.bezierCurveTo(centerX - widthAtTop * .8 + bend * .15, top + curtainHeight * .25,
            centerX + bend - widthAtTop * .5, top + curtainHeight * .68,
            centerX + bend - widthAtTop * taper, top + curtainHeight);
          context.lineTo(centerX + bend + widthAtTop * taper, top + curtainHeight);
          context.bezierCurveTo(centerX + bend + widthAtTop * .55, top + curtainHeight * .68,
            centerX + widthAtTop * .85 + bend * .15, top + curtainHeight * .25,
            centerX + widthAtTop, top);
          context.closePath();
          context.fill();
          if (curtain % 2 === 0) {
            context.strokeStyle = `rgb(${Math.round(red + (255 - red) * .45)} ${Math.round(green + (255 - green) * .45)} ${Math.round(blue + (255 - blue) * .45)} / ${.18 + auroraHigh * .2})`;
            context.globalAlpha = 1;
            context.lineWidth = Math.max(.5, (.55 + auroraHigh * .35) * ratio);
            context.beginPath();
            context.moveTo(centerX, top + curtainHeight * .08);
            context.bezierCurveTo(centerX + bend * .1, top + curtainHeight * .3,
              centerX + bend * .72, top + curtainHeight * .7,
              centerX + bend, top + curtainHeight * .94);
            context.stroke();
          }
        }
        context.globalCompositeOperation = "source-over";
        context.globalAlpha = 1;
        raf = requestAnimationFrame(draw);
        return;
      }
      if (false) { // Legacy 2D waterfall / jellyfish implementation retained for reference only.
        const data = audioEngine.getFrequencyData();
        {
          const averageBand = (from: number, to: number) => {
            const start = Math.max(1, Math.floor(data.length * from));
            const end = Math.max(start + 1, Math.floor(data.length * to));
            let total = 0;
            for (let i = start; i < end; i++) total += data[i];
            return Math.min(1, total / (end - start) / 255 * settings.sensitivity);
          };
          const rawLow = averageBand(.002, .045);
          const rawMid = averageBand(.045, .22);
          const rawHigh = averageBand(.22, .62);
          const previousLow = jellyLow;
          jellyLow += (rawLow - jellyLow) * Math.min(1, deltaSeconds * (rawLow > jellyLow ? 3.2 : 1.35));
          jellyMid += (rawMid - jellyMid) * Math.min(1, deltaSeconds * 2.2);
          jellyHigh += (rawHigh - jellyHigh) * Math.min(1, deltaSeconds * 4.2);
          const onset = Math.max(0, rawLow - previousLow);
          jellyBeat = Math.max(jellyBeat - deltaSeconds * .72, Math.min(1, onset * 3.6));

          context.clearRect(0, 0, width, height);

          const time = now / 1000 * settings.animationSpeed;
          const scale = Math.min(width, height);
          const floatX = Math.sin(time * .16) * scale * .018;
          const floatY = Math.sin(time * .21 + 1.4) * scale * .026;
          const cx = width * .5 + floatX;
          const cy = height * .38 + floatY;
          const breath = .5 + Math.sin(time * .58) * .5;
          const bellWidth = scale * (.245 + jellyLow * .025 + breath * .006);
          const bellHeight = scale * (.16 + jellyLow * .022 + breath * .004);
          const rimY = cy + bellHeight * .48;
          const glow = Math.max(0, Math.min(3, glowStrength));
          context.globalCompositeOperation = "lighter";
          context.shadowBlur = 0;

          // Sparse environmental motes establish depth without competing with the creature.
          const moteCount = Math.min(particles.length, thinned(settings.lowPerformance ? 48 : 105));
          for (let i = 0; i < moteCount; i++) {
            const mote = particles[i];
            const x = width * (.5 + mote.x * .43) + Math.sin(time * .08 + mote.twinkle) * scale * .008;
            const y = height * (.5 + mote.y * .62) - ((time * (.004 + mote.size * .002) + mote.z) % 1) * height * .08;
            const nearBody = Math.hypot((x - cx) / bellWidth, (y - cy) / (bellHeight * 2.8));
            const sparkle = Math.pow(Math.max(0, Math.sin(time * mote.twinkleSpeed * .23 + mote.twinkle)), 9);
            context.fillStyle = accent;
            context.globalAlpha = (.06 + sparkle * (.12 + jellyHigh * .2)) * Math.min(1, nearBody * .72);
            context.beginPath();
            context.arc(x, y, Math.max(.3, mote.size * ratio * .38), 0, Math.PI * 2);
            context.fill();
          }

          // The creature slowly changes attitude in space instead of staying
          // locked to a perfectly frontal, symmetrical presentation.
          context.save();
          context.translate(cx, cy);
          context.rotate(Math.sin(time * .105) * .075 + Math.sin(time * .043 + 1.2) * .028);
          context.scale(1 + Math.sin(time * .071) * .018, 1 - Math.sin(time * .071) * .012);
          context.translate(-cx, -cy);

          // Beat energy leaves the neural core as a restrained expanding wave.
          if (jellyBeat > .01) {
            const pulseRadius = scale * (.055 + (1 - jellyBeat) * .27);
            context.strokeStyle = accent;
            context.globalAlpha = jellyBeat * (.12 + glow * .045);
            context.lineWidth = Math.max(.55, (1 + jellyBeat * .8) * ratio);
            context.beginPath();
            context.arc(cx, cy + bellHeight * .08, pulseRadius, 0, Math.PI * 2);
            context.stroke();
          }

          // Three independent appendage systems: deep muscular arms, fine
          // drifting filaments, and a short frilled skirt around the bell rim.
          const drawAppendage = (index: number, count: number, kind: "arm" | "filament" | "skirt") => {
            const p = (index + .5) / count;
            const irregular = Math.sin(index * 2.17 + (kind === "arm" ? .7 : 0)) * .035;
            const rootX = cx + (p - .5 + irregular) * bellWidth * (kind === "arm" ? 1.18 : 1.55);
            const fold = Math.sin(p * Math.PI * 7 + time * .18) * bellHeight * .035;
            const rootY = rimY + fold + Math.cos((p - .5) * Math.PI) * bellHeight * .055;
            const baseLength = kind === "arm" ? .34 : kind === "filament" ? .2 : .075;
            const variance = kind === "arm" ? (index % 5) * .035 : kind === "filament" ? (index % 7) * .018 : (index % 4) * .012;
            const length = scale * (baseLength + variance + jellyMid * (kind === "arm" ? .045 : .025));
            const phase = index * (kind === "arm" ? 1.31 : 2.07) + (kind === "skirt" ? .9 : 0);
            const damping = kind === "arm" ? .62 : kind === "filament" ? 1 : .78;
            const sway = Math.sin(time * (.22 + (index % 5) * .018) + phase) * scale * (.018 + jellyMid * .026) * damping;
            const curl = Math.sin(time * .15 + phase * .63) * scale * (kind === "arm" ? .045 : .025);
            const endX = rootX + sway + curl;
            const endY = rootY + length;
            const c1x = rootX - sway * .55 + Math.sin(phase) * scale * .018;
            const c1y = rootY + length * (.25 + (index % 3) * .035);
            const c2x = endX + sway * .72 - Math.cos(phase * .7) * scale * .022;
            const c2y = rootY + length * (.68 + (index % 4) * .035);
            const depth = .45 + .55 * (.5 + Math.sin(index * 1.73) * .5);
            if (kind === "arm") {
              const chain = jellyArmChains[index];
              const segmentLength = length / (chain.length - 1);
              const frameScale = Math.min(2, deltaSeconds * 60);
              chain[0].x = rootX;
              chain[0].y = rootY;
              for (let segment = 1; segment < chain.length; segment++) {
                const node = chain[segment];
                const t = segment / (chain.length - 1);
                if (!Number.isFinite(node.x)) {
                  node.x = rootX;
                  node.y = rootY + segmentLength * segment;
                }
                const delayedWave = Math.sin(time * (.2 + index * .013) + phase - segment * .19);
                const desiredX = rootX + curl * t + delayedWave * scale * (.012 + jellyMid * .026) * t * t;
                const desiredY = rootY + segmentLength * segment + Math.cos(time * .14 + phase + segment * .11) * scale * .004 * t;
                const spring = .075 - t * .038;
                const inertia = .83 + t * .105;
                node.vx = (node.vx + (desiredX - node.x) * spring * frameScale) * Math.pow(inertia, frameScale);
                node.vy = (node.vy + (desiredY - node.y) * spring * frameScale) * Math.pow(inertia, frameScale);
                node.x += node.vx * frameScale;
                node.y += node.vy * frameScale;
                const previous = chain[segment - 1];
                const dx = node.x - previous.x, dy = node.y - previous.y;
                const distance = Math.max(.001, Math.hypot(dx, dy));
                node.x = previous.x + dx / distance * segmentLength;
                node.y = previous.y + dy / distance * segmentLength;
              }
              context.beginPath();
              context.moveTo(chain[0].x, chain[0].y);
              for (let segment = 1; segment < chain.length - 1; segment++) {
                const midpointX = (chain[segment].x + chain[segment + 1].x) * .5;
                const midpointY = (chain[segment].y + chain[segment + 1].y) * .5;
                context.quadraticCurveTo(chain[segment].x, chain[segment].y, midpointX, midpointY);
              }
              context.lineTo(chain[chain.length - 1].x, chain[chain.length - 1].y);
              context.strokeStyle = accent;
              context.globalAlpha = depth * (.11 + jellyMid * .14);
              context.lineWidth = Math.max(1.5, (4 + (index % 3) * .7) * ratio);
              context.stroke();
              context.strokeStyle = "rgba(111,196,204,.62)";
              context.globalAlpha = .13 + jellyMid * .16;
              context.lineWidth = Math.max(.55, (1.05 + (index % 2) * .28) * ratio);
              context.stroke();
              const flow = (time * (.065 + jellyMid * .04) + index * .151) % 1;
              const flowPosition = flow * (chain.length - 1);
              const flowIndex = Math.min(chain.length - 2, Math.floor(flowPosition));
              const flowMix = flowPosition - flowIndex;
              const flowX = chain[flowIndex].x + (chain[flowIndex + 1].x - chain[flowIndex].x) * flowMix;
              const flowY = chain[flowIndex].y + (chain[flowIndex + 1].y - chain[flowIndex].y) * flowMix;
              context.fillStyle = index % 5 === 0 ? "rgba(132,105,202,.82)" : accent;
              context.globalAlpha = .22 + jellyMid * .36;
              context.beginPath();
              context.arc(flowX, flowY, Math.max(.5, 1.05 * ratio), 0, Math.PI * 2);
              context.fill();
              return;
            }
            context.filter = !settings.lowPerformance && kind === "filament" && depth < .62 ? "blur(.65px)" : "none";
            context.beginPath();
            context.moveTo(rootX, rootY);
            context.bezierCurveTo(c1x, c1y, c2x, c2y, endX, endY);
            context.strokeStyle = index % 11 === 0 ? "rgba(126,102,191,.68)" : "rgba(102,189,200,.72)";
            context.globalAlpha = depth * (.065 + jellyMid * .12);
            context.lineWidth = Math.max(.34, (kind === "filament" ? .52 + (index % 4) * .1 : .82) * ratio);
            context.stroke();
            context.filter = "none";
            if (kind !== "skirt" && index % 3 === 0) {
              const flow = (time * (.075 + jellyMid * .045) + index * .137) % 1;
              const inv = 1 - flow;
              const px = inv ** 3 * rootX + 3 * inv ** 2 * flow * c1x + 3 * inv * flow ** 2 * c2x + flow ** 3 * endX;
              const py = inv ** 3 * rootY + 3 * inv ** 2 * flow * c1y + 3 * inv * flow ** 2 * c2y + flow ** 3 * endY;
              context.fillStyle = index % 5 === 0 ? "rgba(164,135,232,.8)" : accent;
              context.globalAlpha = .18 + jellyMid * .38;
              context.beginPath();
              context.arc(px, py, Math.max(.38, .55 * ratio), 0, Math.PI * 2);
              context.fill();
            }
          };
          const armCount = settings.lowPerformance ? 4 : 6;
          const filamentCount = settings.lowPerformance ? 20 : 34;
          const skirtCount = settings.lowPerformance ? 10 : 16;
          for (let i = 0; i < filamentCount; i++) drawAppendage(i, filamentCount, "filament");
          for (let i = 0; i < armCount; i++) drawAppendage(i, armCount, "arm");
          for (let i = 0; i < skirtCount; i++) drawAppendage(i, skirtCount, "skirt");

          // Soft asymmetric bell with a naturally folded lower membrane.
          const bellPath = () => {
            const leftX = cx - bellWidth * (.94 + Math.sin(time * .19) * .025);
            const rightX = cx + bellWidth * (1.02 + Math.sin(time * .17 + 1.2) * .022);
            const crownX = cx - bellWidth * .07 + Math.sin(time * .13) * bellWidth * .025;
            context.beginPath();
            context.moveTo(leftX, rimY);
            context.bezierCurveTo(leftX - bellWidth * .02, cy - bellHeight * .52, crownX - bellWidth * .52, cy - bellHeight * 1.08, crownX, cy - bellHeight * (.96 + jellyLow * .04));
            context.bezierCurveTo(crownX + bellWidth * .46, cy - bellHeight * 1.04, rightX + bellWidth * .025, cy - bellHeight * .48, rightX, rimY + bellHeight * .025);
            const folds = 11;
            for (let foldIndex = 0; foldIndex < folds; foldIndex++) {
              const nextX = rightX + (leftX - rightX) * ((foldIndex + 1) / folds);
              const slowFoldMotion = Math.sin(time * (.11 + (foldIndex % 4) * .012) + foldIndex * 1.43);
              const nextY = rimY + slowFoldMotion * bellHeight * (.012 + (foldIndex % 3) * .008);
              const controlX = rightX + (leftX - rightX) * ((foldIndex + .5) / folds);
              const organicDepth = .055 + (.5 + Math.sin(foldIndex * 2.37 + .8) * .5) * .16
                + (.5 + Math.sin(foldIndex * .91 + 2.1) * .5) * .045;
              const foldDepth = bellHeight * (organicDepth + jellyLow * (.012 + (foldIndex % 4) * .007));
              context.quadraticCurveTo(controlX, rimY + foldDepth, nextX, nextY);
            }
            context.closePath();
          };
          const membrane = context.createRadialGradient(cx - bellWidth * .2, cy - bellHeight * .38, bellWidth * .04, cx, cy, bellWidth * 1.08);
          membrane.addColorStop(0, "rgba(176,232,238,.3)");
          membrane.addColorStop(.28, accent);
          membrane.addColorStop(.68, "rgba(24,79,96,.15)");
          membrane.addColorStop(1, "rgba(0,0,0,0)");
          bellPath();
          context.fillStyle = membrane;
          context.globalAlpha = .32 + jellyLow * .2;
          context.fill();
          context.strokeStyle = accent;
          context.globalAlpha = .08 + jellyHigh * .22 + glow * .018;
          context.lineWidth = Math.max(1.1, (2.3 + glow * .38) * ratio);
          context.stroke();
          context.strokeStyle = "rgba(220,252,255,.92)";
          context.globalAlpha = .3 + jellyHigh * .45;
          context.lineWidth = Math.max(.52, (.7 + jellyHigh * .48) * ratio);
          context.stroke();

          // Slow cloud volumes are clipped inside the membrane.
          context.save();
          bellPath();
          context.clip();
          for (let cloudIndex = 0; cloudIndex < 5; cloudIndex++) {
            const cloudX = cx + Math.sin(time * (.08 + cloudIndex * .011) + cloudIndex * 1.7) * bellWidth * (.22 + cloudIndex * .035);
            const cloudY = cy - bellHeight * .22 + Math.cos(time * .07 + cloudIndex * 2.2) * bellHeight * .32;
            const cloudRadius = bellWidth * (.2 + (cloudIndex % 3) * .055);
            const cloud = context.createRadialGradient(cloudX, cloudY, 0, cloudX, cloudY, cloudRadius);
            cloud.addColorStop(0, cloudIndex === 3 ? "rgba(118,91,190,.18)" : "rgba(67,181,194,.2)");
            cloud.addColorStop(1, "rgba(0,0,0,0)");
            context.fillStyle = cloud;
            context.globalAlpha = .32 + jellyMid * .18;
            context.beginPath();
            context.arc(cloudX, cloudY, cloudRadius, 0, Math.PI * 2);
            context.fill();
          }
          context.restore();

          // Curved, branching organic veins replace the old radial spokes.
          const coreX = cx - bellWidth * .06;
          const coreY = cy + bellHeight * .05;
          for (let vein = 0; vein < 8; vein++) {
            const p = (vein + .6) / 8.4;
            const edgeX = cx + (p - .5) * bellWidth * 1.55 + Math.sin(vein * 2.4) * bellWidth * .06;
            const edgeY = cy - bellHeight * (.12 + Math.sin(vein * 1.3) * .5);
            const bendX = cx + Math.sin(vein * 1.83 + time * .08) * bellWidth * .28;
            const bendY = cy - bellHeight * (.18 + (vein % 3) * .12);
            context.strokeStyle = vein % 5 === 0 ? "rgba(135,105,205,.62)" : accent;
            context.globalAlpha = .055 + jellyMid * .13;
            context.lineWidth = Math.max(.32, (.42 + (vein % 3) * .08) * ratio);
            context.beginPath();
            context.moveTo(coreX, coreY);
            context.quadraticCurveTo(bendX, bendY, edgeX, edgeY);
            context.stroke();
            if (vein % 2 === 0) {
              context.globalAlpha *= .58;
              context.beginPath();
              context.moveTo(bendX, bendY);
              context.quadraticCurveTo(bendX + Math.sin(vein) * bellWidth * .13, bendY - bellHeight * .18, edgeX + Math.cos(vein) * bellWidth * .12, edgeY + bellHeight * .08);
              context.stroke();
            }
          }

          const coreRadius = scale * (.024 + jellyLow * .006 + jellyBeat * .003);
          const core = context.createRadialGradient(coreX, coreY, 0, coreX, coreY, coreRadius * (2.25 + glow * .24));
          core.addColorStop(0, "rgba(2,12,18,.88)");
          core.addColorStop(.22, "rgba(12,53,66,.78)");
          core.addColorStop(.5, accent);
          core.addColorStop(.72, "rgba(91,66,155,.2)");
          core.addColorStop(1, "rgba(0,0,0,0)");
          context.fillStyle = core;
          context.globalAlpha = .56 + jellyLow * .16;
          context.beginPath();
          context.arc(coreX, coreY, coreRadius * (2.25 + glow * .24), 0, Math.PI * 2);
          context.fill();
          context.strokeStyle = accent;
          context.globalAlpha = .15 + jellyMid * .22;
          context.lineWidth = Math.max(.5, (.72 + jellyMid * .35) * ratio);
          context.beginPath();
          const organPoints = 18;
          for (let organPoint = 0; organPoint <= organPoints; organPoint++) {
            const angle = organPoint / organPoints * Math.PI * 2;
            const tissue = 1 + Math.sin(angle * 3 + time * .18) * .12 + Math.sin(angle * 5 - time * .11) * .055;
            const x = coreX + Math.cos(angle) * coreRadius * (1.2 + jellyLow * .08) * tissue;
            const y = coreY + Math.sin(angle) * coreRadius * (.72 + jellyLow * .05) * tissue;
            organPoint ? context.lineTo(x, y) : context.moveTo(x, y);
          }
          context.closePath();
          context.stroke();

          // High frequencies produce sparse edge discharge, never a full neon outline.
          const sparks = settings.lowPerformance ? 8 : 15;
          context.fillStyle = "#effeff";
          for (let i = 0; i < sparks; i++) {
            const p = i / (sparks - 1);
            const angle = Math.PI * (1.05 + p * .9);
            const x = cx + Math.cos(angle) * bellWidth * (1 + jellyHigh * .018);
            const y = cy + Math.sin(angle) * bellHeight * .94;
            const flash = Math.pow(Math.max(0, Math.sin(time * (1.7 + i * .07) + i * 2.13)), 12) * jellyHigh;
            context.globalAlpha = .06 + flash * .8;
            context.beginPath();
            context.arc(x, y, Math.max(.35, (.45 + flash * 1.25) * ratio), 0, Math.PI * 2);
            context.fill();
          }
          context.restore();
          context.globalCompositeOperation = "source-over";
          context.globalAlpha = 1;
          raf = requestAnimationFrame(draw);
          return;
        }
        context.clearRect(0, 0, width, height);
        const time = now / 1000 * settings.animationSpeed;
        const scale = Math.min(width, height);
        const sources = [
          [.2, .3, 4, .00, .92], [.47, .62, 18, .18, .78], [.73, .28, 42, .37, .86],
          [.82, .72, 72, .54, .68], [.33, .78, 94, .71, .62], [.61, .47, 118, .86, .54]
        ].slice(0, settings.lowPerformance ? 3 : 6);
        context.globalCompositeOperation = "lighter";
        context.strokeStyle = context.fillStyle = accent;
        context.shadowBlur = 0;
        const rippleGlow = Math.max(0, Math.min(3, glowStrength));
        sources.forEach(([nx, ny, bin, offset, weight], sourceIndex) => {
          const x = width * nx, y = height * ny;
          const band = Math.min(1, data[Math.min(data.length - 1, bin)] / 255 * settings.sensitivity);
          const maxRadius = scale * (.2 + weight * .075);
          const sourceGlow = context.createRadialGradient(x, y, 0, x, y, scale * (.035 + band * .035 + rippleGlow * .008));
          sourceGlow.addColorStop(0, "rgba(255,255,255,.94)");
          sourceGlow.addColorStop(.16, accent);
          sourceGlow.addColorStop(1, "rgba(0,0,0,0)");
          context.fillStyle = sourceGlow;
          context.globalAlpha = .2 + band * .34 + rippleGlow * .055;
          context.beginPath();
          context.arc(x, y, scale * (.035 + band * .035 + rippleGlow * .008), 0, Math.PI * 2);
          context.fill();
          for (let ring = 0; ring < 7; ring++) {
            const drift = Math.sin(time * (.11 + sourceIndex * .013) + ring * 1.73 + offset * 5) * .022;
            const progress = (time * (.052 + sourceIndex * .004 + band * .018) + offset + ring / 7 + drift + 1) % 1;
            const fade = Math.sin(progress * Math.PI);
            const radius = scale * .008 + progress * maxRadius;
            const rippleSteps = settings.lowPerformance ? 30 : 48;
            context.beginPath();
            for (let step = 0; step <= rippleSteps; step++) {
              const angle = step / rippleSteps * Math.PI * 2;
              const surfaceNoise = Math.sin(angle * (2 + sourceIndex % 3) + time * .17 + ring) * scale * .0015
                + Math.sin(angle * 5 - time * .12 + offset * 9) * scale * .0007;
              const px = x + Math.cos(angle) * (radius + surfaceNoise);
              const py = y + Math.sin(angle) * (radius + surfaceNoise * .72);
              step ? context.lineTo(px, py) : context.moveTo(px, py);
            }
            context.closePath();
            context.strokeStyle = accent;
            context.globalAlpha = fade * (.1 + band * .2 + rippleGlow * .05) * (1 - progress * .34);
            context.lineWidth = Math.max(1.1, (2 + band * 1.25 + rippleGlow * .68 - progress * .5) * ratio);
            context.stroke();
            context.strokeStyle = "#e8fdff";
            context.globalAlpha = fade * (.2 + band * .28) * (1 - progress * .5);
            context.lineWidth = Math.max(.62, (.78 + band * .4 - progress * .18) * ratio);
            context.stroke();
          }
          const droplet = .5 + (Math.sin(time * (.43 + sourceIndex * .037) + offset * 6) * .34
            + Math.sin(time * .19 + sourceIndex * 2.4) * .16);
          context.fillStyle = accent;
          context.globalAlpha = .18 + band * .58;
          context.beginPath();
          context.arc(x, y, Math.max(.7, (1.05 + band * 2.2 + droplet * .7) * ratio), 0, Math.PI * 2);
          context.fill();
          context.globalAlpha = .08 + band * .18;
          context.beginPath();
          context.arc(x, y, Math.max(2, (3.2 + band * 4.5) * ratio), 0, Math.PI * 2);
          context.fill();
        });
        context.globalCompositeOperation = "source-over";
        context.globalAlpha = 1;
        raf = requestAnimationFrame(draw);
        return;
        /* Retained implementation history: particle-stream prototype.
        context.clearRect(0, 0, width, height);
        let low = 0;
        const lowEnd = Math.max(2, Math.floor(data.length * .04));
        for (let i = 1; i < lowEnd; i++) low += data[i];
        low = Math.min(1, low / (lowEnd - 1) / 255 * settings.sensitivity);
        displayedPulseEnergy += (low - displayedPulseEnergy) * Math.min(1, deltaSeconds * (low > displayedPulseEnergy ? 5 : 2));
        const energy = displayedPulseEnergy;
        const time = now / 1000 * settings.animationSpeed;
        const sourceX = width * .075, sourceY = height * .3;
        const targetX = width * .79, targetY = height * .57;
        const targetRadius = Math.min(width, height) * (.031 + energy * .008);
        context.globalCompositeOperation = "lighter";
        context.shadowBlur = 0;
        context.fillStyle = context.strokeStyle = accent;

        // Almost invisible guide filaments give the stream structure without
        // turning it into a single obvious pipe.
        context.lineWidth = Math.max(.3, .42 * ratio);
        for (let guide = -2; guide <= 2; guide++) {
          const lane = guide * .38;
          context.globalAlpha = .025 + energy * .025;
          context.beginPath();
          context.moveTo(sourceX, sourceY + lane * height * .11);
          context.bezierCurveTo(width * .3, height * (.17 + lane * .06), width * .58, height * (.66 - lane * .035), targetX, targetY);
          context.stroke();
        }

        const streamPoint = (t: number, lane: number) => {
          const inverse = 1 - t;
          const p0x = sourceX, p0y = sourceY + lane * height * .105;
          const p1x = width * .29, p1y = height * (.17 + lane * .055);
          const p2x = width * .59, p2y = height * (.67 - lane * .03);
          return {
            x: inverse ** 3 * p0x + 3 * inverse ** 2 * t * p1x + 3 * inverse * t ** 2 * p2x + t ** 3 * targetX,
            y: inverse ** 3 * p0y + 3 * inverse ** 2 * t * p1y + 3 * inverse * t ** 2 * p2y + t ** 3 * targetY
          };
        };
        context.lineCap = "round";
        pulseStream.forEach((particle) => {
          const band = Math.min(1, data[Math.min(data.length - 1, particle.frequency)] / 255 * settings.sensitivity);
          particle.progress += deltaSeconds * particle.speed * settings.animationSpeed * (1 + band * 1.4);
          if (particle.progress > 1) {
            particle.progress -= 1;
            particle.lane = (Math.random() - .5) * 2;
            particle.frequency = Math.floor(Math.random() * 110);
          }
          const t = particle.progress;
          const point = streamPoint(t, particle.lane);
          const previous = streamPoint(Math.max(0, t - (.008 + band * .009)), particle.lane);
          const jitter = Math.sin(time * (1.15 + particle.speed * 7) + particle.phase) * height * .0035 * (1 - t);
          const x = point.x, y = point.y + jitter;
          const sparkle = Math.pow(Math.max(0, Math.sin(time * (2 + particle.speed * 12) + particle.phase)), 7);
          context.globalAlpha = Math.min(.72, .08 + band * .32 + sparkle * .3);
          context.lineWidth = Math.max(.28, particle.size * ratio * (.45 + band * .55));
          context.beginPath();
          context.moveTo(previous.x, previous.y + jitter);
          context.lineTo(x, y);
          context.stroke();
          context.globalAlpha = Math.min(.92, .16 + band * .42 + sparkle * .42);
          context.beginPath();
          context.arc(x, y, Math.max(.32, particle.size * ratio * (.58 + band * .62 + t * .18)), 0, Math.PI * 2);
          context.fill();
        });

        // Sparse transient waves sit behind a precision, counter-rotating hub.
        context.setLineDash([]);
        for (let waveIndex = 0; waveIndex < 2; waveIndex++) {
          const wave = (time * (.24 + energy * .16) + waveIndex / 2) % 1;
          context.globalAlpha = (1 - wave) * (.045 + energy * .2);
          context.lineWidth = Math.max(.42, (.82 - wave * .35) * ratio);
          context.beginPath();
          context.arc(targetX, targetY, targetRadius * (1.5 + wave * 2.35), 0, Math.PI * 2);
          context.stroke();
        }
        for (let ring = 0; ring < 3; ring++) {
          const radius = targetRadius * (1.35 + ring * .62);
          context.setLineDash([radius * (.42 + ring * .08), radius * (.2 + ring * .05)]);
          context.lineDashOffset = time * radius * (ring % 2 ? .23 : -.18);
          context.globalAlpha = .2 + energy * .24 - ring * .035;
          context.lineWidth = Math.max(.55, (1.05 - ring * .16) * ratio);
          context.beginPath();
          context.arc(targetX, targetY, radius, 0, Math.PI * 2);
          context.stroke();
        }
        context.setLineDash([]);
        const coreGlow = context.createRadialGradient(targetX, targetY, 0, targetX, targetY, targetRadius * 1.5);
        coreGlow.addColorStop(0, "rgba(255,255,255,.98)");
        coreGlow.addColorStop(.24, accent);
        coreGlow.addColorStop(1, "rgba(0,0,0,0)");
        context.fillStyle = coreGlow;
        context.globalAlpha = .58 + energy * .34;
        context.beginPath();
        context.arc(targetX, targetY, targetRadius * 1.5, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#f4feff";
        context.globalAlpha = .72 + energy * .26;
        context.beginPath();
        context.arc(targetX, targetY, targetRadius * (.18 + energy * .07), 0, Math.PI * 2);
        context.fill();
        context.globalCompositeOperation = "source-over";
        context.globalAlpha = 1;
        raf = requestAnimationFrame(draw);
        return;
        */
      }
      context.clearRect(0, 0, width, height);

      context.shadowColor = accent;
      context.shadowBlur = 12 * ratio * glowStrength;
      context.strokeStyle = context.fillStyle = accent;
      const barOpacity = Math.max(0, Math.min(1, settings.barOpacity));

      if (mode === "waveform") {
        const data = audioEngine.getFrequencyData();
        const sampleRate = audioEngine.meters().sampleRate || 48000;
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
      } else if (mode === "levels") {
        const meter = audioEngine.meters();
        const levels = [["L", meter.left, meter.peak], ["R", meter.right, meter.peak]] as const;
        context.shadowBlur = 8 * ratio * glowStrength;
        levels.forEach(([label, value, peak], index) => {
          const y = height * (.28 + index * .34);
          const barHeight = Math.max(8, height * .1);
          context.globalAlpha = .16 * barOpacity;
          context.fillRect(width * .12, y, width * .76, barHeight);
          context.globalAlpha = barOpacity;
          context.fillRect(width * .12, y, width * .76 * value, barHeight);
          context.fillRect(width * (.12 + .76 * Math.min(1, peak)), y - 3, 2 * ratio, barHeight + 6);
          context.globalAlpha = 1;
          context.font = `${11 * ratio}px JetBrains Mono`;
          context.fillText(label, width * .05, y + barHeight * .8);
        });
      } else if (mode === "pulse") {
        const data = audioEngine.getFrequencyData();
        const sampleRate = audioEngine.meters().sampleRate || 48000;
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
        if (lensBackground?.complete && lensBackground.naturalWidth > 0 && backgroundOpacity > 0) {
          const bounds = canvas.getBoundingClientRect();
          const viewportWidth = document.documentElement.clientWidth;
          const viewportHeight = document.documentElement.clientHeight;
          const coverScale = Math.max(
            viewportWidth / lensBackground.naturalWidth,
            viewportHeight / lensBackground.naturalHeight
          );
          const imageCssWidth = lensBackground.naturalWidth * coverScale;
          const imageCssHeight = lensBackground.naturalHeight * coverScale;
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
        const data = audioEngine.getFrequencyData();
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
        const data = audioEngine.getFrequencyData();
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
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      resize.disconnect();
      window.removeEventListener("resize", syncCanvasSize);
      cancelAnimationFrame(resizeFrame);
      cancelAnimationFrame(layoutFrame);
      cancelAnimationFrame(raf);
    };
  }, [
    mode,
    accent,
    glowStrength,
    backgroundUrl,
    backgroundBrightness,
    backgroundOpacity,
    settings.smoothing,
    settings.sensitivity,
    settings.barCount,
    settings.barOpacity,
    settings.lineWidth,
    settings.animationSpeed,
    settings.decaySpeed,
    settings.peakHoldMs,
    settings.lowPerformance,
    playbackActive,
    visible,
    onFps,
    thumbnail
  ]);
  return <canvas ref={ref} className="visualizer-canvas" />;
}
