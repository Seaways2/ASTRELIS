import { useEffect, useMemo, useRef } from "react";
import { audioEngine } from "../audio/AudioEngine";
import { usePlayerStore } from "../stores/playerStore";
import { createLatestNativeVolumeSender } from "./appShell";

interface VolumeRoutingInput {
  nativePlayback: boolean;
  onlineSession: boolean;
  /** Embedded (non-standalone, non-direct) video that follows the main volume. */
  videoFollowsVolume: boolean;
}

/**
 * Routes the store's volume/mute to every playback backend (Web Audio, the
 * online page, the native host, embedded video) through store subscriptions,
 * so a fader drag never re-renders the App shell. Returns the last audible
 * volume used to restore from mute.
 */
export function useVolumeRouting({ nativePlayback, onlineSession, videoFollowsVolume }: VolumeRoutingInput) {
  const lastAudibleVolume = useRef((() => {
    const { volume } = usePlayerStore.getState();
    return volume > .001 ? volume : .72;
  })());
  useEffect(() => usePlayerStore.subscribe(store => {
    if (!store.muted && store.volume > .001) lastAudibleVolume.current = store.volume;
  }), []);
  const sendNativeVolume = useMemo(createLatestNativeVolumeSender, []);

  // Video volume: at most one control command in flight and one per 80 ms.
  const videoVolumeSync = useRef<{ timer?: number; lastSentAt: number; inFlight: boolean; pending: boolean; value: number }>({
    lastSentAt: Number.NEGATIVE_INFINITY, inFlight: false, pending: false, value: 0
  });
  const flushVideoVolumeSync = useRef<() => void>(() => {});
  flushVideoVolumeSync.current = () => {
    const sync = videoVolumeSync.current;
    if (sync.inFlight || !sync.pending) return;
    const wait = 80 - (performance.now() - sync.lastSentAt);
    if (wait > 0) {
      if (sync.timer === undefined) sync.timer = window.setTimeout(() => {
        sync.timer = undefined;
        flushVideoVolumeSync.current();
      }, wait);
      return;
    }
    sync.pending = false;
    sync.inFlight = true;
    sync.lastSentAt = performance.now();
    void Promise.resolve(window.desktop?.video.control("volume", sync.value))
      .catch(() => undefined)
      .finally(() => {
        sync.inFlight = false;
        if (sync.pending) flushVideoVolumeSync.current();
      });
  };
  useEffect(() => {
    const sync = videoVolumeSync.current;
    if (!videoFollowsVolume) {
      if (sync.timer !== undefined) window.clearTimeout(sync.timer);
      sync.timer = undefined;
      sync.pending = false;
      return;
    }
    const push = (volume: number, muted: boolean) => {
      sync.value = muted ? 0 : volume * 100;
      sync.pending = true;
      flushVideoVolumeSync.current();
    };
    const live = usePlayerStore.getState();
    push(live.volume, live.muted);
    // Follow volume through the store directly; the shell does not re-render for it.
    return usePlayerStore.subscribe((next, previous) => {
      if (next.volume !== previous.volume || next.muted !== previous.muted) push(next.volume, next.muted);
    });
  }, [videoFollowsVolume]);
  useEffect(() => () => {
    const timer = videoVolumeSync.current.timer;
    if (timer !== undefined) window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const apply = (volume: number, muted: boolean) => {
      audioEngine.setVolume(volume, muted);
      if (onlineSession) window.desktop?.browser.setVolume(volume, muted);
      if (nativePlayback) sendNativeVolume(muted ? 0 : volume);
    };
    const live = usePlayerStore.getState();
    apply(live.volume, live.muted);
    return usePlayerStore.subscribe((next, previous) => {
      if (next.volume !== previous.volume || next.muted !== previous.muted) apply(next.volume, next.muted);
    });
  }, [nativePlayback, onlineSession, sendNativeVolume]);

  return lastAudibleVolume;
}
