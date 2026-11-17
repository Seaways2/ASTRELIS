import { memo, useMemo } from "react";
import { Heart, Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { favoriteTrackKey, usePlayerStore } from "../stores/playerStore";
import { useI18n } from "../i18n";
import { useVirtualQueueRows } from "../hooks/useVirtualQueueRows";

export const PlaylistTable = memo(function PlaylistTable() {
  const state = usePlayerStore(useShallow(store => ({
    tracks: store.viewedQueueKind === store.queueKind ? store.tracks : store.inactiveTracks,
    currentIndex: store.viewedQueueKind === store.queueKind ? store.currentIndex : -1,
    favoriteTrackKeys: store.favoriteTrackKeys,
    playTrack: store.playQueuedTrack,
    toggleFavoriteTrack: store.toggleFavoriteTrack,
    removeTrack: store.removeTrack
  })));
  const { t } = useI18n();
  const favorites = useMemo(() => new Set(state.favoriteTrackKeys), [state.favoriteTrackKeys]);
  const rowHeight = 50;
  const virtual = useVirtualQueueRows(state.tracks.length, rowHeight, ".page-content");
  return <div className="playlist-table">
    <div className="table-head"><span>#</span><span>{t("common.track")}</span><span>{t("common.format")}</span><span>{t("common.size")}</span><span /></div>
    <div ref={virtual.containerRef} style={{ position: "relative", height: virtual.totalHeight }} data-virtual-queue-count={virtual.limit}>
      {state.tracks.slice(virtual.offset, virtual.offset + virtual.limit).map((track, visibleIndex) => {
        const index = virtual.offset + visibleIndex;
        const favoriteKey = favoriteTrackKey(track);
        const favorite = Boolean(favoriteKey && favorites.has(favoriteKey));
        return <div className={`table-row ${index === state.currentIndex ? "active" : ""} ${track.missing ? "missing" : ""}`} key={track.id} title={track.missing ? t("queue.missingHint") : undefined}
          style={{ position: "absolute", top: index * rowHeight, left: 0, right: 0, height: rowHeight, minHeight: 0 }}
          onDoubleClick={() => void state.playTrack(track.id)}>
          <span>{String(index + 1).padStart(2, "0")}</span><div><b>{track.name}</b><small>{track.missing && <em className="missing-tag">{t("queue.missing")}</em>}{track.artist} · {track.album}</small></div>
          <span>{track.format}</span><span>{(track.size / 1024 / 1024).toFixed(1)} MB</span>
          <div className="playlist-row-actions">{favoriteKey && <button className={favorite ? "favorite" : ""} type="button" aria-label={t(favorite ? "library.unfavorite" : "library.favorite")} title={t(favorite ? "library.unfavorite" : "library.favorite")} onClick={event => { event.stopPropagation(); state.toggleFavoriteTrack(track); }} onDoubleClick={event => event.stopPropagation()}><Heart fill={favorite ? "currentColor" : "none"} /></button>}<button type="button" aria-label={t("library.removeTrack")} title={t("library.removeTrack")} onClick={event => { event.stopPropagation(); state.removeTrack(track.id); }} onDoubleClick={event => event.stopPropagation()}><Trash2 /></button></div>
        </div>;
      })}
    </div>
  </div>;
});
