import { useEffect, useRef } from "react";
import { usePlayerStore } from "../stores/playerStore";
import { nudgeFaderAmplitude } from "../utils/volumeFaderScale";

// Shared playback controls; visualizers and scrollable UI retain their own wheel gestures.
export function usePlaybackShortcuts(options: {
  enabled: boolean; direct: boolean; video: boolean; mediaKey: string; duration: number;
  /** Level to resume from when the volume sits at zero (the fader uses the same). */
  restoreVolume?: () => number;
  seek: (time: number) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    let held = "", started = 0, lastStep = 0, timer = 0;
    let target = 0, seekAt = -Infinity, seekMedia = "";
    const editable = (el: EventTarget | null) => el instanceof Element && Boolean(el.closest('input:not([type="range"]),textarea,select,[contenteditable="true"],[role="dialog"],[role="menu"],[role="listbox"],.queue-list,.playlist-table'));
    const act = (action: string, amount = 0) => {
      if (!latest.current.enabled) return;
      const state = usePlayerStore.getState();
      if (action === "toggle") state.setPlaying(!state.playing);
      if (action === "seek") {
        const now = performance.now();
        const duration = latest.current.duration;
        if (!Number.isFinite(duration) || duration <= 0) return;
        target = Math.max(0, Math.min(duration, (seekMedia === latest.current.mediaKey && now - seekAt < 500 ? target : state.currentTime) + amount));
        seekMedia = latest.current.mediaKey;
        seekAt = now;
        latest.current.seek(target);
      }
      if (action === "volume" && !latest.current.direct) {
        state.setMuted(false);
        state.setVolume(Math.max(0, Math.min(1, (state.muted ? 0 : state.volume) + amount / 100)));
      }
      if (action === "volumeDb" && !latest.current.direct) {
        // Same 1 dB fader steps as the channel strip; a muted volume resumes
        // from the level it was muted at, like the fader does.
        const base = state.volume > .001 ? state.volume : latest.current.restoreVolume?.() ?? 0;
        const next = nudgeFaderAmplitude(base, amount);
        state.setVolume(next);
        state.setMuted(next <= .001);
      }
    };
    const stop = () => { held = ""; window.clearInterval(timer); timer = 0; };
    const down = (event: KeyboardEvent) => {
      if (!latest.current.enabled || event.ctrlKey || event.altKey || event.metaKey || editable(event.target)) return;
      if (![" ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.key === " ") { act("toggle"); return; }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        act("volumeDb", event.key === "ArrowUp" ? 5 : -5); return;
      }
      stop(); held = event.key; started = lastStep = performance.now();
      const media = latest.current.mediaKey;
      const direction = held === "ArrowRight" ? 1 : -1;
      act("seek", direction * 5);
      timer = window.setInterval(() => {
        if (!latest.current.enabled || document.hidden || latest.current.mediaKey !== media) { stop(); return; }
        const now = performance.now(), fast = now - started >= 2000;
        if (now - lastStep >= (fast ? 200 : 500)) { lastStep = now; act("seek", direction * (fast ? 10 : 5)); }
      }, 50);
    };
    const up = (event: KeyboardEvent) => { if (event.key === held) stop(); };
    const wheel = (event: WheelEvent) => {
      if (!latest.current.enabled || event.ctrlKey || editable(event.target) || !event.deltaY) return;
      // Scrollable drawers and menus must remain usable.
      if (event.target instanceof Element) {
        if (!latest.current.video && event.target.closest('.visualizer-transition-layer')) return;
        if (event.target.closest('.queue-drawer,.channel-strip-popover,.visual-settings-panel,[role="menu"]')) return;
        for (let el: Element | null = event.target; el && el !== document.body; el = el.parentElement) {
          if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1) return;
        }
      }
      event.preventDefault();
      // One fader step per wheel event, exactly as over the channel-strip fader.
      act("volumeDb", event.deltaY < 0 ? 1 : -1);
    };
    const off = window.desktop?.video.onInput(input => { if (latest.current.video) act(input.action, input.amount); });
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("wheel", wheel, { capture: true, passive: false });
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", stop);
    return () => { stop(); off?.(); window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up, true); window.removeEventListener("wheel", wheel, true); window.removeEventListener("blur", stop); document.removeEventListener("visibilitychange", stop); };
  }, []);
}
