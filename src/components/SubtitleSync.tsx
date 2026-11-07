import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { VideoState } from "../../electron/videoPlayer";
import { useI18n } from "../i18n";
import "./SubtitleSync.css";

export function SubtitleSync({ state, disabled = false, onError }: { state?: VideoState; disabled?: boolean; onError: (error: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [popupPosition, setPopupPosition] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const embeddedControls = Boolean(triggerRef.current?.closest(".embedded-video-controls"));
  const selected = state?.tracks.some(track => track.type === "sub" && track.selected);
  const blocked = disabled || !state?.ready || !selected;
  const delay = state?.subtitleDelay ?? 0;
  const speed = state?.subtitleSpeed ?? 1;
  const run = async (action: string, value: number) => {
    const result = await window.desktop?.video.control(action, value);
    if (!result?.ok) onError(result?.error || t("video.failed"));
  };
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: globalThis.PointerEvent) => {
      const target = event.target as Node;
      if (!wrapperRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !triggerRef.current?.closest(".embedded-video-controls")) {
      setPopupPosition(null);
      return;
    }
    const trigger = triggerRef.current;
    const root = trigger.closest<HTMLElement>(".embedded-video");
    const updatePosition = () => {
      const controls = trigger.closest<HTMLElement>(".embedded-video-controls");
      if (!controls) return;
      const controlsBottom = controls.getBoundingClientRect().bottom;
      const effectsBottom = root?.querySelector<HTMLElement>(".video-dsp")?.getBoundingClientRect().bottom ?? 0;
      const top = Math.max(controlsBottom, effectsBottom) + 8;
      const width = Math.min(330, window.innerWidth - 16);
      const left = Math.max(8, Math.min(trigger.getBoundingClientRect().left - 36, window.innerWidth - width - 8));
      const maxHeight = Math.max(80, window.innerHeight - top - 12);
      setPopupPosition(current => current && current.left === left && current.top === top && current.maxHeight === maxHeight
        ? current : { left, top, maxHeight });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const resizeObserver = new ResizeObserver(updatePosition);
    if (root) resizeObserver.observe(root);
    const mutationObserver = root ? new MutationObserver(updatePosition) : null;
    if (root) mutationObserver?.observe(root, { childList: true, subtree: true });
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      resizeObserver.disconnect();
      mutationObserver?.disconnect();
    };
  }, [open]);
  const lightTheme = Boolean(triggerRef.current?.closest(".theme-light"));
  const appShell = triggerRef.current?.closest<HTMLElement>(".app-shell");
  const accent = appShell ? getComputedStyle(appShell).getPropertyValue("--accent").trim() : "#39d9e9";
  const panelStyle = embeddedControls && popupPosition
    ? { left: popupPosition.left, top: popupPosition.top, maxHeight: popupPosition.maxHeight, "--accent": accent } as CSSProperties
    : undefined;
  const panel = <div ref={panelRef} role="dialog" aria-label={t("video.sync.title")} className={`subtitle-sync-panel${embeddedControls ? " subtitle-sync-panel-portal" : ""}${lightTheme ? " subtitle-sync-panel-light" : ""}`}
    style={panelStyle}>
      <label>{t("video.sync.delay")}
        <span><button type="button" disabled={blocked} onClick={() => void run("subtitleDelay", Math.max(-120, Math.round((delay - .1) * 10) / 10))}>−</button>
          <output>{delay >= 0 ? "+" : ""}{delay.toFixed(1)} s</output>
          <button type="button" disabled={blocked} onClick={() => void run("subtitleDelay", Math.min(120, Math.round((delay + .1) * 10) / 10))}>+</button></span></label>
      <label>{t("video.sync.speed")}
        <span><button type="button" disabled={blocked} onClick={() => void run("subtitleSpeed", Math.max(.5, Math.round((speed - .001) * 1000) / 1000))}>−</button>
          <output>{(speed * 100).toFixed(1)}%</output>
          <button type="button" disabled={blocked} onClick={() => void run("subtitleSpeed", Math.min(2, Math.round((speed + .001) * 1000) / 1000))}>+</button></span></label>
      <div className="subtitle-sync-actions">
        <button type="button" disabled={blocked} onClick={() => void run("subtitleAlign", 0)}>{t("video.sync.alignCurrent")}</button>
        <button type="button" disabled={blocked} onClick={() => void run("subtitleAlign", 1)}>{t("video.sync.alignNext")}</button>
        <button type="button" disabled={blocked} onClick={() => { void (async () => { await run("subtitleDelay", 0); await run("subtitleSpeed", 1); })(); }}>{t("video.sync.reset")}</button>
      </div>
      <p>{t("video.sync.hint")}</p>
    </div>;
  return <div className="subtitle-sync" ref={wrapperRef}>
    <button ref={triggerRef} className="subtitle-sync-trigger" type="button" disabled={disabled || !state?.ready} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(value => !value)}>{t("video.sync.title")}</button>
    {open && !embeddedControls && panel}
    {open && embeddedControls && popupPosition && createPortal(panel, document.body)}
  </div>;
}
