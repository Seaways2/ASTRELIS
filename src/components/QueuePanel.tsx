import "./QueuePanel.css";
import { QueueTabs } from "./QueueTabs";
import { ListMusic, Trash2, X } from "lucide-react";
import { memo, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePlayerStore } from "../stores/playerStore";
import { useI18n } from "../i18n";
import { useVirtualQueueRows } from "../hooks/useVirtualQueueRows";

function QueueTitle({ text }: { text: string }) {
  const ref = useRef<HTMLElement>(null);
  const [overflow, setOverflow] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setOverflow(Math.max(0, (node.firstElementChild?.scrollWidth || 0) - node.clientWidth));
    const observer = new ResizeObserver(measure);
    observer.observe(node); if (node.firstElementChild) observer.observe(node.firstElementChild);
    measure(); return () => observer.disconnect();
  }, [text]);
  return <b ref={ref} title={text} className="queue-scrolling-title" data-overflow={overflow > 0}
    style={{ "--title-travel": `${-overflow}px`, "--title-duration": `${Math.max(6, overflow / 24 + 3)}s` } as CSSProperties}><span>{text}</span></b>;
}

export const QueuePanel = memo(function QueuePanel({ onClose, video = false }: { onClose(): void; video?: boolean }) {
  const { tracks, currentIndex, removeTrack, current, viewedKind, sameQueue } = usePlayerStore(useShallow(store => ({
    tracks: store.viewedQueueKind === store.queueKind ? store.tracks : store.inactiveTracks, currentIndex: store.viewedQueueKind === store.queueKind ? store.currentIndex : -1, removeTrack: store.removeTrack, current: store.tracks[store.currentIndex], viewedKind: store.viewedQueueKind, sameQueue: store.viewedQueueKind === store.queueKind
  })));
  const { t, tm } = useI18n();
  const rowHeight = 56;
  const virtual = useVirtualQueueRows(tracks.length, rowHeight, ".queue-list");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- scrolls to the top when the viewed list changes; the container ref is stable
  useLayoutEffect(() => { const scroller = virtual.containerRef.current?.closest<HTMLElement>(".queue-list"); if (scroller) scroller.scrollTop = 0; }, [viewedKind]);
  return <div className={`queue-drawer media-queue-drawer panel ${video ? "video-queue-drawer" : ""}`}>
    <div className="queue-title"><div><ListMusic size={18} /> {t("queue.title")} <span>{tracks.length}</span></div><button title={t("common.close")} onClick={onClose}><X size={18} /></button></div>
    <QueueTabs />
    {video && sameQueue && current && <div className="video-sidebar-current"><span>{t("nav.nowPlaying")}</span><QueueTitle text={current?.name || "—"} /><small>{current ? `${tm(current.artist)} · ${current.format}` : t("queue.empty")}</small></div>}
    <div className="queue-list">
      {tracks.length === 0 && <div className="queue-empty">{t("queue.empty")}</div>}
      <div ref={virtual.containerRef} style={{ position: "relative", height: virtual.totalHeight }} data-virtual-queue-count={virtual.limit}>
      {tracks.slice(virtual.offset, virtual.offset + virtual.limit).map((track, visibleIndex) => {
        const index = virtual.offset + visibleIndex;
        return <div className={`queue-row ${index === currentIndex ? "active" : ""} ${track.missing ? "missing" : ""}`} key={track.id} title={track.missing ? t("queue.missingHint") : undefined}
          style={{ position: "absolute", top: index * rowHeight, left: 0, right: 0, height: rowHeight, minHeight: 0 }}
          onDoubleClick={() => void usePlayerStore.getState().playQueuedTrack(track.id)}>
        <span className="track-number">{String(index + 1).padStart(2, "0")}</span>
        <div><QueueTitle text={track.name} /><small>{track.missing && <em className="missing-tag">{t("queue.missing")}</em>}{tm(track.artist)} · {track.format}</small></div>
        <button onDoubleClick={event => event.stopPropagation()} onClick={() => removeTrack(track.id)} title={t("queue.remove")}><Trash2 size={15} /></button>
      </div>;})}
      </div>
    </div>
  </div>;
});
