import type { VisualizerMode, VisualizerRenderSettings } from "../types/audio";
import { VisualizerCanvas } from "./VisualizerCanvas";
import { useI18n } from "../i18n";

const modules: { mode: Exclude<VisualizerMode, "overview">; key: "mode.spectrum" | "mode.mirror" | "mode.waveform" | "mode.radial" | "mode.particles" | "mode.pulse" }[] = [
  { mode: "spectrum", key: "mode.spectrum" },
  { mode: "mirror", key: "mode.mirror" },
  { mode: "radial", key: "mode.radial" },
  { mode: "waveform", key: "mode.waveform" },
  { mode: "particles", key: "mode.particles" },
  { mode: "pulse", key: "mode.pulse" }
];

export function VisualizerOverview({ accent, onSelect, settings, glowStrength = 1, playbackActive, visible }: { accent: string; onSelect(mode: VisualizerMode): void; settings: VisualizerRenderSettings; glowStrength?: number; playbackActive?: boolean; visible?: boolean }) {
  const { t } = useI18n();
  // Six simultaneous canvases at 60 FPS saturate Chromium's GPU process.
  // Overview thumbnails use 30 FPS; a focused visualizer remains full-rate.
  const overviewSettings = settings.lowPerformance ? settings : { ...settings, lowPerformance: true };
  return <div className="visual-overview">
    {modules.map((module) => <button type="button" className="visual-module" key={module.mode} aria-label={t(module.key)} onClick={() => onSelect(module.mode)}>
      <VisualizerCanvas mode={module.mode} accent={accent} settings={overviewSettings} glowStrength={glowStrength} playbackActive={playbackActive} visible={visible} thumbnail />
    </button>)}
  </div>;
}
