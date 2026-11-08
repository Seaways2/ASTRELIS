import { Blocks, Globe2, Library, ListMusic, MonitorSpeaker, Music2, Palette, Settings } from "lucide-react";
import type { usePlayerStore } from "../stores/playerStore";
import type { VisualizerMode } from "../types/audio";

export const nav = [
  [Music2, "nowPlaying", "nav.nowPlaying"], [ListMusic, "playlist", "nav.playlist"], [Library, "library", "nav.library"], [Globe2, "online", "nav.online"],
  [Blocks, "plugins", "nav.plugins"], [MonitorSpeaker, "devices", "nav.devices"], [Palette, "appearance", "nav.appearance"], [Settings, "settings", "nav.settings"]
] as const;
export const modes: { id: VisualizerMode; key: "mode.overview" | "mode.spectrum" | "mode.mirror" | "mode.waveform" | "mode.radial" | "mode.particles" | "mode.pulse" }[] = [
  { id: "overview", key: "mode.overview" },
  { id: "spectrum", key: "mode.spectrum" }, { id: "mirror", key: "mode.mirror" },
  { id: "radial", key: "mode.radial" }, { id: "waveform", key: "mode.waveform" },
  { id: "particles", key: "mode.particles" }, { id: "pulse", key: "mode.pulse" }
];
export const visualTransitionTimings = {
  dissolve: { out: 180, in: 280 },
  fade: { out: 140, in: 220 },
  zoom: { out: 180, in: 300 },
  slide: { out: 180, in: 300 },
  scan: { out: 220, in: 340 }
} as const;
export const formatTime = (seconds: number) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}` : "00:00";
export const isAudioFileDrag = (dataTransfer: DataTransfer) => Array.from(dataTransfer.types).includes("Files");
export const waitForAudioTransition = (durationMs: number) => new Promise<void>(resolve => window.setTimeout(resolve, durationMs));

type PlayerStoreState = ReturnType<typeof usePlayerStore.getState>;
// The shell subscribes to everything except the two values that change many
// times per second: `volume` (every fader pointermove) and `currentTime`
// (every playback tick). Their consumers use WithStoreVolume / WithDisplayTime
// or store.subscribe, so neither re-renders the whole window.
export const selectShellState = (store: PlayerStoreState) => {
  const { volume, currentTime, ...shell } = store;
  void volume; void currentTime;
  return shell;
};

// Sends only the newest volume to the native host; at most one in flight.
export function createLatestNativeVolumeSender() {
  let inFlight = false;
  let pending: number | undefined;
  const pump = async () => {
    if (inFlight || pending === undefined) return;
    inFlight = true;
    const value = pending;
    pending = undefined;
    try { await window.desktop?.nativeAudio.command({ type: "volume", value }); }
    catch { /* The next value or the next load re-applies the volume. */ }
    finally { inFlight = false; void pump(); }
  };
  return (value: number) => { pending = value; void pump(); };
}
