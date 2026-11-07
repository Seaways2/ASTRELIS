import type { VisualizerRenderSettings, VisualizerSettings } from "../types/audio";

// Keep resource limits out of the saved visual parameters so leaving ECO mode
// restores the user's full-quality tuning without another settings migration.
export function resolveVisualizerSettings(
  settings: VisualizerSettings,
  lowPerformanceMode: boolean
): VisualizerRenderSettings {
  return lowPerformanceMode ? {
    ...settings,
    fftSize: 512,
    barCount: Math.min(48, settings.barCount),
    animationSpeed: Math.min(.65, settings.animationSpeed),
    torusParticleCount: Math.min(20000, settings.torusParticleCount),
    torusTrailStrength: 0,
    lowPerformance: true
  } : { ...settings, lowPerformance: false };
}
