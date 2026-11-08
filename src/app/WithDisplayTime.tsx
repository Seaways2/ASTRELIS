import type { ReactNode } from "react";
import { usePlayerStore } from "../stores/playerStore";

/** The playback position shown in the transport: the online page's or the local backend's. */
export function useDisplayTime(online: boolean) {
  return usePlayerStore(store => online ? store.onlineMedia?.currentTime ?? 0 : store.currentTime);
}

/**
 * Supplies the live playback position to its children. The App shell does not
 * subscribe to `currentTime`, so playback ticks re-render only this subtree.
 */
export function WithDisplayTime({ online, children }: { online: boolean; children(time: number): ReactNode }) {
  return <>{children(useDisplayTime(online))}</>;
}
