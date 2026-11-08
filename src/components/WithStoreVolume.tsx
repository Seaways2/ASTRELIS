import type { ReactNode } from "react";
import { usePlayerStore } from "../stores/playerStore";

/**
 * Supplies the live volume to its children. The App shell deliberately does
 * not subscribe to `volume`, so dragging a fader re-renders only this subtree
 * instead of the whole window (six visualizer canvases, meters, deck, ...).
 */
export function WithStoreVolume({ children }: { children(volume: number, muted: boolean): ReactNode }) {
  const volume = usePlayerStore(state => state.volume);
  const muted = usePlayerStore(state => state.muted);
  return <>{children(volume, muted)}</>;
}
