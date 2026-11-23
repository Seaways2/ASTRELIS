import { LibraryMenu, LibrarySelect, LibraryFolderManager } from "./LibraryMenu";
import { useFolderProtection } from "./useFolderProtection";
import { hiddenByFolders } from "../utils/folderVisibility";
import { batchMatchFolder, batchMatchTracks } from "../utils/batchMatchScope";
import { useMatchTask } from "../stores/matchTaskStore";
import { MediaFlow } from "./MediaFlow";
import { mosaicGridSize, mosaicSlots } from "./mosaicLayout";
import { isVideoTrack } from "../utils/videoTrack";
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { LibraryThumbnail } from "./LibraryThumbnail";
import { createPortal } from "react-dom";
import { Expand, EyeOff, ImagePlus, LockKeyhole, Album, ArrowUp, ArrowUpDown, AudioWaveform, CheckCircle2, ChevronRight, Folder, FolderOpen, FolderPlus, Film, Grid2X2, Grid3X3, Heart, ListPlus, RefreshCw, Rows3, Search, TableProperties, Tags, UserRound, X, ZoomIn, ZoomOut } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { favoriteTrackKey, usePlayerStore } from "../stores/playerStore";
import { useI18n } from "../i18n";
import { useLibraryViewModel } from "../hooks/useLibraryViewModel";
import { useVirtualLibraryGrid } from "../hooks/useVirtualLibraryGrid";
import { LIBRARY_SORTS, libraryFolderWithin, type LibraryCategoryGroup, type LibraryFolderNode, type LibrarySort } from "../library/LibraryQueryService";
import type { Track } from "../types/audio";

type Facet = "文件夹" | "艺术家" | "专辑" | "收藏";
// Below 75% the fullscreen mosaic mounts 400+ covers and panning stutters even
// with every thumbnail cached, so the preview zoom stops there.
const MIN_PREVIEW_ZOOM = .75;
type LibraryView = "flow" | "cards" | "details" | "mosaic";
// 225% scaling on a 4K panel leaves 1822x912 CSS px: the cover flow then moves its
// tools toggle and breadcrumb into the page title row. The same height bound folds
// the filters into their popover (MediaFlow.css, workspace-modules.css).
export const FLOW_TITLE_ROW_QUERY = "(max-height: 949px)";
// The favorites bar carries the bulk actions and needs about 1060 px of header in
// English (nav and meters take ~510). Narrower windows keep it in the body, where it
// can wrap, so "add selected" is never clipped by the title row.
export const FLOW_TITLE_ROW_FAVORITES_QUERY = "(min-width: 1680px)";

// Keep the same array per (store snapshot, media filter) so the library index
// built for it can be reused when the page is opened again.
const filteredTrackArrays = new WeakMap<Track[], Map<string, Track[]>>();
const tracksForMediaFilter = (tracks: Track[], mediaFilter: string) => {
  if (mediaFilter === "all") return tracks;
  let byFilter = filteredTrackArrays.get(tracks);
  if (!byFilter) filteredTrackArrays.set(tracks, byFilter = new Map());
  let filtered = byFilter.get(mediaFilter);
  if (!filtered) byFilter.set(mediaFilter, filtered = tracks.filter(track => (mediaFilter === "video") === isVideoTrack(track)));
  return filtered;
};

// Browse memory belongs to this renderer session, never to persisted settings.
const librarySession = {
  mediaFilter: "all", flowIndex: 0, query: "", facet: "文件夹" as Facet,
  value: "全部", categoryId: "", folderPath: "", scrollTop: 0, restorePreviewFullscreen: false, previewZoom: 1
};
const browsePositions = new Map<string, { flowIndex: number; scrollTop: number }>();
const canonicalFolderPath = (value: string) => {
  const path = value.trim().replace(/\//g, "\\");
  if (/^[a-z]:\\+$/i.test(path)) return `${path.slice(0, 2)}\\`;
  return path.replace(/\\+$/, "");
};
const parentFolderPath = (value: string) => {
  const path = canonicalFolderPath(value);
  if (!path || /^[a-z]:\\$/i.test(path)) return "";
  if (/^\\\\[^\\]+\\[^\\]+$/i.test(path)) return "";
  const separator = path.lastIndexOf("\\");
  if (separator < 0) return "";
  const parent = path.slice(0, separator);
  return /^[a-z]:$/i.test(parent) ? `${parent}\\` : parent;
};

type VisibleLibraryEntry =
  | { kind: "folder"; key: string; item: LibraryFolderNode }
  | { kind: "category"; key: string; item: LibraryCategoryGroup & { artistSummary: string } }
  | { kind: "track"; key: string; item: Track };
type MosaicPan = { pointerId: number; lastX: number; lastY: number; distanceX: number; distanceY: number; lastTime: number; velocityX: number; velocityY: number; scroller: HTMLElement; mode: "scroll" | "infinite"; viewportWidth: number; viewportHeight: number; moved: boolean };
const positiveModulo = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor;
const libraryViews: Array<{ id: LibraryView; icon: React.ReactNode; labelKey: string }> = [
  { id: "flow", icon: <Grid2X2 />, labelKey: "library.viewFlow" },
  { id: "cards", icon: <Rows3 />, labelKey: "library.viewGrid" },
  { id: "details", icon: <TableProperties />, labelKey: "library.viewList" },
  { id: "mosaic", icon: <Grid3X3 />, labelKey: "library.viewMosaic" }
];
const readStoredChoice = <T extends string>(key: string, choices: readonly T[], fallback: T) => {
  try {
    const stored = localStorage.getItem(key) as T | null;
    return stored && choices.includes(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
};
const readStoredLibraryView = (): LibraryView => {
  try {
    const stored = localStorage.getItem("auralis.library.view");
    if (stored === "large") { localStorage.setItem("auralis.library.view", "flow"); return "flow"; }
    if (stored === "list") {
      localStorage.setItem("auralis.library.view", "cards");
      return "cards";
    }
  } catch { /* Storage failure falls through to the safe default. */ }
  return readStoredChoice("auralis.library.view", ["flow", "cards", "details", "mosaic"], "cards");
};
const facetTranslationKey = (facet: Facet) => facet === "文件夹" ? "folder"
  : facet === "艺术家" ? "artist"
    : facet === "专辑" ? "album"
      : "favorites";

export const MusicLibrary = memo(function MusicLibrary() {
  const state = usePlayerStore(useShallow(store => ({
    libraryTracks: store.libraryTracks,
    libraryDerivedIndexCache: store.libraryDerivedIndexCache,
    libraryFolders: store.libraryFolders,
    libraryRevision: store.libraryRevision,
    libraryScanning: store.libraryScanning,
    libraryScanRequestId: store.libraryScanRequestId,
    libraryScanCancelling: store.libraryScanCancelling,
    cancelLibraryScan: store.cancelLibraryScan,
    libraryError: store.libraryError,
    libraryScanProgress: store.libraryScanProgress,
    tracks: store.tracks,
    inactiveTracks: store.inactiveTracks,
    favoriteTrackKeys: store.favoriteTrackKeys,
    importLibraryFolder: store.importLibraryFolder,
    rescanLibrary: store.rescanLibrary,
    removeLibraryFolder: store.removeLibraryFolder,
    enqueueLibraryTrack: store.enqueueLibraryTrack,
    enqueueLibraryTracks: store.enqueueLibraryTracks,
    toggleFavoriteTrack: store.toggleFavoriteTrack
  })));
  const setArtworkId = (id:string) => {
    const track=usePlayerStore.getState().libraryTracks.find(item=>item.id===id);
    if(track)useMatchTask.getState().open({kind:"artwork",tracks:[track],scope:track.name});
  };
  const protection = useFolderProtection(setArtworkId);
  const hiddenFolders = useMemo(() => protection.state.unlocked ? [] : protection.state.roots, [protection.state.unlocked, protection.state.roots]);
  const { t, tm, resolvedLanguage } = useI18n();
  const [toolsOpen, setToolsOpen] = useState(false);
  const artworkLabel = t("media.artwork");
  const noticeHost = document.querySelector<HTMLElement>(".app-shell");
  const [mediaFilter, setMediaFilter] = useState(() => librarySession.mediaFilter);
  const [flowSelection, setFlowSelection] = useState({ key: "", index: 0 });
  const filteredTracks = useMemo(() => tracksForMediaFilter(state.libraryTracks, mediaFilter), [state.libraryTracks, mediaFilter]);
  const videoCoverSources = useMemo(() => new Set(state.libraryTracks.filter(isVideoTrack).map(track => track.coverUrl).filter((source): source is string => typeof source === "string")), [state.libraryTracks]);
  const [query, setQuery] = useState(() => librarySession.query);
  const [removingFolder, setRemovingFolder] = useState<string | null>(null);
  const [folderManagerOpen, setFolderManagerOpen] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const [facet, setFacet] = useState<Facet>(() => librarySession.facet);
  const [value, setValue] = useState(() => librarySession.value);
  const [categoryId, setCategoryId] = useState(() => librarySession.categoryId);
  const [folderPath, setFolderPath] = useState(() => librarySession.folderPath);
  useEffect(() => { if (hiddenByFolders(folderPath, hiddenFolders)) setFolderPath(""); }, [hiddenFolders, folderPath]);
  // A remembered folder outside every root (the root was removed) returns to the overview.
  useEffect(() => { if (folderPath && !state.libraryFolders.some(root => libraryFolderWithin(folderPath, root))) setFolderPath(""); }, [state.libraryFolders, folderPath]);
  const [queueNotice, setQueueNotice] = useState<{ id: number; text: string } | null>(null);
  const [selectedFavoriteIds, setSelectedFavoriteIds] = useState<Set<string>>(() => new Set());
  const [libraryView, setLibraryViewState] = useState<LibraryView>(readStoredLibraryView);
  const libraryRootRef = useRef<HTMLDivElement>(null);
  const mosaicViewport = useRef<HTMLDivElement>(null);
  const mosaicPan = useRef<MosaicPan | null>(null);
  const mosaicStage = useRef<HTMLDivElement>(null);
  const mosaicCanvasOffset = useRef({ x: 0, y: 0 });
  const mosaicInertiaFrame = useRef<number | null>(null);
  const suppressMosaicClickUntil = useRef(0);
  const fullscreenBreadcrumbPointerAt = useRef(0);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(() => librarySession.previewZoom);
  const [mosaicPanning, setMosaicPanning] = useState(false);
  const [mosaicCenterPage, setMosaicCenterPage] = useState(0);
  // Until the user picks a sort, albums and folders list in album order (disc, track).
  const [librarySort, setLibrarySortState] = useState<LibrarySort>(() => readStoredChoice("auralis.library.sort", LIBRARY_SORTS, "track"));
  const [sortAscending, setSortAscending] = useState(() => {
    // Ascending is the default of the new "track" sort only; a sort chosen before
    // without a stored direction keeps the old default, descending.
    try {
      const stored = localStorage.getItem("auralis.library.sortAscending");
      return stored === null ? localStorage.getItem("auralis.library.sort") === null : stored === "true";
    } catch { return true; }
  });
  useEffect(() => {
    const syncFullscreen = () => setPreviewFullscreen(document.fullscreenElement === libraryRootRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);
  // Library stats sit in the page title row so the controls fit one row.
  const [statsSlot, setStatsSlot] = useState<HTMLElement | null>(null);
  const [shortWindow, setShortWindow] = useState(() => matchMedia(FLOW_TITLE_ROW_QUERY).matches);
  const [wideWindow, setWideWindow] = useState(() => matchMedia(FLOW_TITLE_ROW_FAVORITES_QUERY).matches);
  useEffect(() => {
    const media = matchMedia(FLOW_TITLE_ROW_QUERY), wide = matchMedia(FLOW_TITLE_ROW_FAVORITES_QUERY);
    const change = () => { setShortWindow(media.matches); setWideWindow(wide.matches); };
    change();
    media.addEventListener("change", change);
    wide.addEventListener("change", change);
    return () => { media.removeEventListener("change", change); wide.removeEventListener("change", change); };
  }, []);
  useLayoutEffect(() => {
    const page = libraryRootRef.current?.closest(".workspace-page");
    setStatsSlot(page?.querySelector<HTMLElement>(":scope > header > .page-header-aside") ?? null);
  }, [protection.state.ready]);
  useLayoutEffect(() => {
    const root = libraryRootRef.current;
    if (!protection.state.ready || !root || !librarySession.restorePreviewFullscreen) return;
    librarySession.restorePreviewFullscreen = false;
    void root.requestFullscreen().catch(() => undefined);
  }, [protection.state.ready]);
  useEffect(() => () => {
    if (mosaicInertiaFrame.current !== null) cancelAnimationFrame(mosaicInertiaFrame.current);
  }, []);
  const facets: Facet[] = ["文件夹", "收藏", "艺术家", "专辑"];
  const favoriteKeySet = useMemo(() => new Set(state.favoriteTrackKeys), [state.favoriteTrackKeys]);
  const availableFavoriteTrackIds = useMemo(() => new Set(state.libraryTracks
    .filter(track => favoriteKeySet.has(favoriteTrackKey(track)))
    .map(track => track.id)), [state.libraryTracks, favoriteKeySet]);
  const viewModel = useLibraryViewModel({
    tracks: filteredTracks,
    hiddenFolders,
    cache: mediaFilter === "all" ? state.libraryDerivedIndexCache : null,
    cacheWritable: mediaFilter === "all",
    roots: state.libraryFolders,
    revision: state.libraryRevision,
    favorites: state.favoriteTrackKeys,
    facet,
    value,
    categoryId,
    folderPath,
    search: deferredQuery,
    sort: librarySort,
    sortAscending,
    locale: resolvedLanguage
  });
  function openBatch() {
    const folderFacet=facet==="文件夹";
    // Search hits and categories are matched as listed; folders add their own subtree limit.
    const listIds=!folderFacet||deferredQuery?new Set(viewModel.trackPage(0,viewModel.trackTotal).items.map(item=>item.id)):null;
    const focused=folderFacet&&!folderPath&&!deferredQuery&&libraryView==="flow"?entriesAt(selectedFlowIndex,1)[0]:undefined;
    const folder=folderFacet?batchMatchFolder(folderPath,focused?.kind==="folder"?focused.item.path:undefined):"";
    const tracks=batchMatchTracks({tracks:usePlayerStore.getState().libraryTracks,hiddenFolders,folder,listIds});
    const place=folderFacet?folder||t("media.libraryAll"):t("media.currentList");
    useMatchTask.getState().open({kind:"batch",tracks,scope:folderFacet&&deferredQuery?`${place} · ${t("media.currentList")}`:place,initialMusic:mediaFilter==="audio"});
  }
  const { stats: libraryStats } = viewModel;
  const visibleMediaCount = useMemo(() => state.libraryTracks.reduce((count, track) => count + Number(!hiddenByFolders(track.sourcePath, hiddenFolders)), 0), [state.libraryTracks, hiddenFolders]);
  const progress = useMemo(() => state.libraryScanProgress && hiddenFolders.length ? {...state.libraryScanProgress,current:t("media.indexUpdating")} : state.libraryScanProgress, [state.libraryScanProgress,hiddenFolders,t]);
  const progressPercent = progress?.total ? Math.round(progress.completed / progress.total * 100) : 0;
  // "Up" stops at the library root: above it is outside the library.
  const parentFolder = useMemo(() => {
    const parent = parentFolderPath(folderPath);
    return parent && state.libraryFolders.some(root => libraryFolderWithin(parent, root)) ? parent : "";
  }, [folderPath, state.libraryFolders]);
  const categoryIcon = facet === "艺术家" ? <UserRound /> : <Album />;
  const facetLabel = t(`library.${facetTranslationKey(facet)}`);
  const showTrackCards = facet === "收藏" ? true : facet === "文件夹" ? Boolean(deferredQuery) || Boolean(folderPath) : value !== "全部";
  const folderItemsVisible = facet === "文件夹" && !deferredQuery;
  const categoryItemsVisible = facet !== "文件夹" && facet !== "收藏" && value === "全部";
  const totalListItems = folderItemsVisible
    ? viewModel.folderTotal + (showTrackCards ? viewModel.trackTotal : 0)
    : categoryItemsVisible ? viewModel.categoryTotal : viewModel.trackTotal;
  // Every zoom level keeps the collage: zooming out adds cells and shrinks the
  // tiles instead of switching to a uniform grid.
  const { columns: mosaicColumns, rows: mosaicRows } = mosaicGridSize(previewZoom);
  const mosaicBoardSlots = useMemo(() => mosaicSlots(mosaicColumns, mosaicRows), [mosaicColumns, mosaicRows]);
  const mosaicItemsPerBoard = mosaicBoardSlots.length;
  const mosaicBoardStyle = useMemo(() => ({
    gridTemplateColumns: `repeat(${mosaicColumns}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${mosaicRows}, minmax(0, 1fr))`
  }) as CSSProperties, [mosaicColumns, mosaicRows]);
  const mosaicPageCount = Math.max(1, Math.ceil(totalListItems / mosaicItemsPerBoard));
  const resultCount = categoryItemsVisible ? viewModel.categoryTotal
    : folderItemsVisible && !showTrackCards ? viewModel.folderTotal : viewModel.trackTotal;
  const browseKey = JSON.stringify([libraryView, facet, value, categoryId, folderPath, deferredQuery, mediaFilter, librarySort, sortAscending]);
  useEffect(() => {
    if (mosaicInertiaFrame.current !== null) cancelAnimationFrame(mosaicInertiaFrame.current);
    mosaicInertiaFrame.current = null;
    mosaicPan.current = null;
    mosaicCanvasOffset.current = { x: 0, y: 0 };
    mosaicStage.current?.style.setProperty("transform", "translate3d(-33.333333%, -33.333333%, 0)");
    setMosaicCenterPage(0);
    setMosaicPanning(false);
  }, [browseKey]);
  useEffect(() => {
    if (previewFullscreen) return;
    if (mosaicInertiaFrame.current !== null) cancelAnimationFrame(mosaicInertiaFrame.current);
    mosaicInertiaFrame.current = null;
    mosaicPan.current = null;
    setMosaicPanning(false);
  }, [previewFullscreen]);
  const position = useMemo(() => {
    let saved = browsePositions.get(browseKey);
    if (!saved) {
      saved = { flowIndex: 0, scrollTop: 0 };
      browsePositions.set(browseKey, saved);
      if (browsePositions.size > 256) browsePositions.delete(browsePositions.keys().next().value!);
    }
    return saved;
  }, [browseKey]);
  const flowIndex = flowSelection.key === browseKey ? flowSelection.index : position.flowIndex;
  const setFlowIndex = (index: number) => {
    position.flowIndex = index;
    setFlowSelection({ key: browseKey, index });
  };
  const virtual = useVirtualLibraryGrid(totalListItems, libraryView === "flow" ? "cards" : libraryView, browseKey, position, previewFullscreen);
  const selectedFlowIndex = Math.max(0, Math.min(flowIndex, totalListItems - 1));
  const flowVisibleRadius = Math.min(5, Math.ceil(3 / (previewFullscreen ? previewZoom : 1)));
  const flowOffset = Math.max(0, selectedFlowIndex - flowVisibleRadius);
  useEffect(() => {
    Object.assign(librarySession, { mediaFilter, flowIndex, query, facet, value, categoryId, folderPath });
  }, [mediaFilter, flowIndex, query, facet, value, categoryId, folderPath]);
  const hiddenIndicator = (file: string | undefined, track?: Track) => {
    if (!file || !protection.state.unlocked || !hiddenByFolders(file, protection.state.roots)) return null;
    const label = t("media.hiddenStatus");
    return <span className={`library-hidden-indicator ${track ? "with-favorite" : ""}`} role="img" title={label} aria-label={label}><EyeOff /></span>;
  };
  const entriesAt = (pageOffset: number, pageLimit: number): VisibleLibraryEntry[] => {
    const entries: VisibleLibraryEntry[] = [];
    let remaining = pageLimit;
    if (folderItemsVisible && remaining) {
      if (pageOffset < viewModel.folderTotal) {
        const page = viewModel.folderPage(pageOffset, Math.min(remaining, viewModel.folderTotal - pageOffset));
        page.items.forEach(item => entries.push({ kind: "folder", key: item.path, item }));
        remaining -= page.items.length;
        pageOffset = 0;
      } else pageOffset -= viewModel.folderTotal;
      if (showTrackCards && remaining) {
        const page = viewModel.trackPage(pageOffset, remaining);
        page.items.forEach(item => entries.push({ kind: "track", key: item.mediaId || item.id, item }));
      }
    } else if (categoryItemsVisible && remaining) {
      const page = viewModel.categoryPage(pageOffset, remaining);
      page.items.forEach(group => {
        const artists = Array.from(group.artists);
        const artistSummary = artists.length > 2
          ? resolvedLanguage === "en-US" ? `${artists.slice(0, 2).join(" · ")} + ${artists.length - 2} more`
            : resolvedLanguage === "ja-JP" ? `${artists.slice(0, 2).join(" · ")} ほか${artists.length - 2}名`
              : `${artists.slice(0, 2).join(" · ")} 等 ${artists.length} 位艺术家`
          : artists.join(" · ") || t("library.unknownArtist");
        entries.push({ kind: "category", key: group.key, item: { ...group, artistSummary } });
      });
    } else if (showTrackCards && remaining) {
      const page = viewModel.trackPage(pageOffset, remaining);
      page.items.forEach(item => entries.push({ kind: "track", key: item.mediaId || item.id, item }));
    }
    return entries;
  };
  const wrappedEntriesAt = (page: number): VisibleLibraryEntry[] => {
    if (!totalListItems) return [];
    const entries: VisibleLibraryEntry[] = [];
    let offset = positiveModulo(page, mosaicPageCount) * mosaicItemsPerBoard;
    while (entries.length < mosaicItemsPerBoard) {
      const amount = Math.min(mosaicItemsPerBoard - entries.length, totalListItems - offset);
      const batch = entriesAt(offset, amount);
      if (!batch.length) break;
      entries.push(...batch);
      offset = 0;
    }
    return entries;
  };
  const pageOffset = libraryView === "flow" ? flowOffset : virtual.offset;
  const pageRemaining = libraryView === "flow" ? Math.min(flowVisibleRadius * 2 + 1, totalListItems - flowOffset) : virtual.limit;
  const visibleEntries = entriesAt(pageOffset, pageRemaining);
  const infiniteMosaicBoards = previewFullscreen && libraryView === "mosaic" && totalListItems
    ? Array.from({ length: 9 }, (_, index) => {
      const column = index % 3 - 1;
      const row = Math.floor(index / 3) - 1;
      // World index: unbounded, so a board keeps its key while it stays in the
      // 3x3 window and panning one board only mounts the newly exposed ones.
      const world = mosaicCenterPage + column + row * 3;
      return { index, world, column, row, entries: wrappedEntriesAt(positiveModulo(world, mosaicPageCount)) };
    })
    : [];
  const hasVisibleEntries = totalListItems > 0;
  const queuedTrackIds = useMemo(() => new Set([...state.tracks, ...state.inactiveTracks].map(track => track.id)), [state.tracks, state.inactiveTracks]);
  const selectedFavoriteCount = selectedFavoriteIds.size;
  const allFilteredFavoritesSelected = facet === "收藏" && viewModel.favoriteSelectableIds.length > 0
    && viewModel.favoriteSelectableIds.every(id => selectedFavoriteIds.has(id));
  useEffect(() => {
    setSelectedFavoriteIds(current => {
      const next = new Set(Array.from(current).filter(id => availableFavoriteTrackIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [availableFavoriteTrackIds]);
  useEffect(() => {
    if (!queueNotice) return;
    const timer = window.setTimeout(() => setQueueNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [queueNotice]);
  const announceQueueChange = (added: number, playNow = false) => {
    const text = added > 0
      ? resolvedLanguage === "en-US"
        ? playNow ? `Added ${added} track and started playback` : `Added ${added} track${added === 1 ? "" : "s"} to the playlist`
        : resolvedLanguage === "ja-JP"
          ? playNow ? `${added}曲を追加して再生を開始しました` : `${added}曲をプレイリストに追加しました`
          : playNow ? `已添加 ${added} 个媒体并开始播放` : `已添加 ${added} 个媒体到播放列表`
      : resolvedLanguage === "en-US" ? playNow ? "Track was already in the playlist; playback started" : "All selected tracks are already in the playlist"
        : resolvedLanguage === "ja-JP" ? playNow ? "追加済みの曲を再生しました" : "選択した曲はすべてプレイリストに追加済みです"
          : playNow ? "媒体已在播放列表中，现已开始播放" : "所选媒体已全部在播放列表中，没有重复添加";
    setQueueNotice({ id: Date.now(), text });
  };
  const enqueueTracksWithFeedback = (ids: string[]) => {
    const snapshot = viewModel.selectionSnapshot(ids);
    let added = 0;
    snapshot.orderedMediaIds.forEach(id => { if (!queuedTrackIds.has(id)) added++; });
    if (added) state.enqueueLibraryTracks(snapshot.orderedMediaIds);
    announceQueueChange(added);
  };
  const enqueueTrackWithFeedback = (id: string, playNow = false) => {
    if (playNow) librarySession.restorePreviewFullscreen = previewFullscreen && Boolean(state.libraryTracks.find(track => track.id === id && isVideoTrack(track)));
    const added = queuedTrackIds.has(id) ? 0 : 1;
    void state.enqueueLibraryTrack(id, playNow);
    announceQueueChange(added, playNow);
  };
  const toggleFavoriteSelection = (id: string) => setSelectedFavoriteIds(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const toggleAllFilteredFavorites = () => setSelectedFavoriteIds(current => {
    const next = new Set(current);
    if (allFilteredFavoritesSelected) viewModel.favoriteSelectableIds.forEach(id => next.delete(id));
    else viewModel.favoriteSelectableIds.forEach(id => next.add(id));
    return next;
  });
  const enqueueSelectedFavorites = () => {
    const ids = viewModel.selectedFavoriteMediaIds(selectedFavoriteIds);
    if (ids.length) enqueueTracksWithFeedback(ids);
  };
  const updatePreviewZoom = (percent: number) => {
    const zoom = Math.max(MIN_PREVIEW_ZOOM, Math.min(1, percent / 100));
    librarySession.previewZoom = zoom;
    setPreviewZoom(zoom);
  };
  const setLibraryView = (view: LibraryView) => {
    setLibraryViewState(view);
    localStorage.setItem("auralis.library.view", view);
  };
  const setLibrarySort = (sort: LibrarySort) => {
    setLibrarySortState(sort);
    localStorage.setItem("auralis.library.sort", sort);
  };
  const toggleSortDirection = () => setSortAscending(current => {
    const next = !current;
    localStorage.setItem("auralis.library.sortAscending", String(next));
    return next;
  });
  const navigateToParentFolder = () => {
    setFacet("文件夹");
    setFolderPath(parentFolder);
    setValue("全部");
    setCategoryId("");
    setQuery("");
  };
  const onFullscreenBreadcrumbMouseDown = (event: ReactMouseEvent<HTMLButtonElement>, action: () => void) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    fullscreenBreadcrumbPointerAt.current = performance.now();
    action();
  };
  const onFullscreenBreadcrumbClick = (action: () => void) => {
    if (performance.now() - fullscreenBreadcrumbPointerAt.current < 500) {
      fullscreenBreadcrumbPointerAt.current = 0;
      return;
    }
    action();
  };
  const toggleMosaicFullscreen = async () => {
    const root = libraryRootRef.current;
    if (!root) return;
    if (document.fullscreenElement === root) {
      try { await document.exitFullscreen(); } catch { /* The native Escape shortcut can finish the exit first. */ }
      return;
    }
    if (facet !== "文件夹" && facet !== "收藏") {
      setFacet("文件夹");
      setFolderPath("");
      setValue("全部");
      setCategoryId("");
      setQuery("");
    }
    try { await root.requestFullscreen(); } catch { /* Fullscreen is available when the host grants the user gesture. */ }
  };
  const applyInfiniteMosaicPan = useCallback((deltaX: number, deltaY: number, width: number, height: number) => {
    const current = mosaicCanvasOffset.current;
    const rebase = (offset: number, extent: number) => {
      if (offset >= extent) {
        const steps = Math.floor(offset / extent);
        return { offset: offset - steps * extent, pages: -steps };
      }
      if (offset <= -extent) {
        const steps = Math.ceil(-offset / extent);
        return { offset: offset + steps * extent, pages: steps };
      }
      return { offset, pages: 0 };
    };
    const horizontal = rebase(current.x + deltaX, width);
    const vertical = rebase(current.y + deltaY, height);
    mosaicCanvasOffset.current = { x: horizontal.offset, y: vertical.offset };
    mosaicStage.current?.style.setProperty("transform", `translate3d(calc(-33.333333% + ${horizontal.offset}px), calc(-33.333333% + ${vertical.offset}px), 0)`);
    if (horizontal.pages || vertical.pages) {
      setMosaicCenterPage(center => center + horizontal.pages + vertical.pages * 3);
    }
  }, []);
  useEffect(() => {
    const viewport = mosaicViewport.current;
    if (!previewFullscreen || libraryView !== "mosaic" || !viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || !event.deltaY) return;
      const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport.clientHeight : 1;
      event.preventDefault();
      if (mosaicInertiaFrame.current !== null) cancelAnimationFrame(mosaicInertiaFrame.current);
      mosaicInertiaFrame.current = null;
      setMosaicPanning(false);
      applyInfiniteMosaicPan(0, -event.deltaY * multiplier, viewport.clientWidth, viewport.clientHeight);
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [previewFullscreen, libraryView, applyInfiniteMosaicPan]);
  const startMosaicInertia = (pan: MosaicPan) => {
    let velocityX = pan.velocityX;
    let velocityY = pan.velocityY;
    if (Math.max(Math.abs(velocityX), Math.abs(velocityY)) < .025) {
      setMosaicPanning(false);
      return;
    }
    let previousTime = performance.now();
    const animate = (time: number) => {
      const elapsed = Math.min(40, Math.max(1, time - previousTime));
      previousTime = time;
      const deltaX = velocityX * elapsed;
      const deltaY = velocityY * elapsed;
      if (pan.mode === "infinite") applyInfiniteMosaicPan(deltaX, deltaY, pan.viewportWidth, pan.viewportHeight);
      else {
        pan.scroller.scrollLeft -= deltaX;
        pan.scroller.scrollTop -= deltaY;
      }
      const friction = Math.exp(-elapsed / 340);
      velocityX *= friction;
      velocityY *= friction;
      if (Math.max(Math.abs(velocityX), Math.abs(velocityY)) < .012) {
        mosaicInertiaFrame.current = null;
        setMosaicPanning(false);
        return;
      }
      mosaicInertiaFrame.current = requestAnimationFrame(animate);
    };
    mosaicInertiaFrame.current = requestAnimationFrame(animate);
  };
  const onMosaicPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (mosaicInertiaFrame.current !== null) cancelAnimationFrame(mosaicInertiaFrame.current);
    mosaicInertiaFrame.current = null;
    setMosaicPanning(false);
    if (libraryView !== "mosaic" || (event.target as HTMLElement).closest("button,input,select,textarea,a,label")) return;
    const mode = previewFullscreen ? "infinite" : "scroll";
    const scroller = mode === "infinite" ? event.currentTarget : event.currentTarget.closest<HTMLElement>(".page-content");
    if (!scroller) return;
    suppressMosaicClickUntil.current = 0;
    mosaicPan.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, distanceX: 0, distanceY: 0, lastTime: performance.now(), velocityX: 0, velocityY: 0, scroller, mode, viewportWidth: Math.max(1, event.currentTarget.clientWidth), viewportHeight: Math.max(1, event.currentTarget.clientHeight), moved: false };
  };
  const onMosaicPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = mosaicPan.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const dx = event.clientX - pan.lastX;
    const dy = event.clientY - pan.lastY;
    const now = performance.now();
    const elapsed = Math.max(8, now - pan.lastTime);
    pan.distanceX += dx;
    pan.distanceY += dy;
    pan.lastX = event.clientX;
    pan.lastY = event.clientY;
    pan.lastTime = now;
    pan.velocityX = pan.velocityX * .64 + dx / elapsed * .36;
    pan.velocityY = pan.velocityY * .64 + dy / elapsed * .36;
    if (!pan.moved && Math.hypot(pan.distanceX, pan.distanceY) > 5) {
      pan.moved = true;
      setMosaicPanning(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (!pan.moved) return;
    event.preventDefault();
    if (pan.mode === "infinite") applyInfiniteMosaicPan(dx, dy, pan.viewportWidth, pan.viewportHeight);
    else {
      pan.scroller.scrollLeft -= dx;
      pan.scroller.scrollTop -= dy;
    }
  };
  const finishMosaicPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = mosaicPan.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    if (pan.moved) suppressMosaicClickUntil.current = Date.now() + 300;
    mosaicPan.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (event.type === "pointerup" && pan.moved) startMosaicInertia(pan);
    else setMosaicPanning(false);
  };
  const onMosaicClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() >= suppressMosaicClickUntil.current) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const renderLibraryEntry = (entry: VisibleLibraryEntry) => {
    if (entry.kind === "folder") {
      const group = entry.item;
      return <div className="library-entry library-folder-entry" role="button" tabIndex={0} key={entry.key} onContextMenu={e => protection.context(e, group.path)} onClick={() => setFolderPath(group.path)} onKeyDown={event => { if (event.key === "Enter" && event.target === event.currentTarget) setFolderPath(group.path); }}>
      <div className="library-entry-media"><CoverTile covers={group.covers} count={group.count} fallback={<Folder />} coverFlow={libraryView === "flow"} smartFocus={libraryView === "mosaic"} fullscreen={previewFullscreen} highResolutionSources={videoCoverSources} />{libraryView === "mosaic" ? <div className="library-folder-control">
        <span className="library-folder-badge"><FolderOpen /><span>{t("library.folder")} · {group.count}</span></span>
        {group.directIds.length > 0 && <button type="button" className="bulk-queue-action" onClick={event => { event.stopPropagation(); enqueueTracksWithFeedback(group.directIds); }}>+ {t("library.addLayer")} · {group.directIds.length}</button>}
      </div> : <span className="library-folder-badge"><FolderOpen />{t("library.folder")} · {group.count}</span>}{hiddenIndicator(group.path)}</div>
        <b className="library-entry-title">{group.path.split(/[\\/]/).filter(Boolean).pop() || group.path}</b>
        <small className="library-entry-primary" title={group.path}>{group.path}</small>
        <em className="library-entry-secondary">{group.formats.size} FORMATS</em>
        <span className="library-entry-type">{t("library.folder")}</span>
        <span className="library-entry-size">{group.count} TRACKS</span>
        {libraryView !== "mosaic" && group.directIds.length > 0 && <div className="library-entry-actions"><button type="button" className="bulk-queue-action" onClick={event => { event.stopPropagation(); enqueueTracksWithFeedback(group.directIds); }}>+ {t("library.addLayer")} · {group.directIds.length}</button></div>}
      </div>;
    }
    if (entry.kind === "category") {
      const group = entry.item;
      return <div className="library-entry library-category-entry" role="button" tabIndex={0} key={entry.key} onClick={() => { setValue(group.name); setCategoryId(group.key); setQuery(""); }} onKeyDown={event => { if (event.key === "Enter") { setValue(group.name); setCategoryId(group.key); setQuery(""); } }}>
        <div className="library-entry-media"><CoverTile covers={group.covers} count={group.count} fallback={categoryIcon} coverFlow={libraryView === "flow"} smartFocus={libraryView === "mosaic"} fullscreen={previewFullscreen} highResolutionSources={videoCoverSources} /></div>
        <b className="library-entry-title" title={group.name}>{group.name}</b>
        <small className="library-entry-primary" title={facet === "专辑" ? Array.from(group.artists).join(" · ") : undefined}>{facet === "专辑" ? group.artistSummary : t("library.collection")}</small>
        <em className="library-entry-secondary">{facet === "艺术家" ? `${group.albums.size} ALBUMS · ` : ""}{group.formats.size} FORMATS</em>
        <span className="library-entry-type">{facetLabel}</span>
        <span className="library-entry-size">{group.count} TRACKS</span>
        <div className="library-entry-actions"><button type="button" className="bulk-queue-action" onClick={event => { event.stopPropagation(); enqueueTracksWithFeedback(group.ids); }}>+ {t(facet === "艺术家" ? "library.addArtist" : "library.addAlbum")}</button><button type="button" className="library-open-action" aria-label={t("library.open")} onClick={event => { event.stopPropagation(); setValue(group.name); setCategoryId(group.key); setQuery(""); }}><ChevronRight /></button></div>
      </div>;
    }
    const track = entry.item;
    const favorite = favoriteKeySet.has(favoriteTrackKey(track));
    const selected = selectedFavoriteIds.has(track.id);
    return <div className={`library-entry library-track-entry ${queuedTrackIds.has(track.id) ? "queued" : ""} ${selected ? "selected-favorite" : ""}`} role="button" tabIndex={0} key={entry.key} onContextMenu={e => protection.context(e, undefined, track)} onDoubleClick={() => enqueueTrackWithFeedback(track.id, true)} onKeyDown={event => { if (event.key === "Enter") enqueueTrackWithFeedback(track.id, true); }}>
      <div className="library-entry-media library-art">{track.coverUrl ? <LibraryThumbnail source={track.coverUrl} coverFlow={libraryView === "flow"} highResolution={isVideoTrack(track)} smartFocus={libraryView === "mosaic"} fullscreen={previewFullscreen} /> : isVideoTrack(track) ? <Film /> : <AudioWaveform />}<span className="library-track-format">{track.format}</span>{facet === "收藏" && <label className="favorite-select-action" title={t("library.selectTrack")} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}><input type="checkbox" checked={selected} onChange={() => toggleFavoriteSelection(track.id)} /></label>}<button className={`favorite-track-action ${favorite ? "active" : ""}`} type="button" aria-label={t(favorite ? "library.unfavorite" : "library.favorite")} title={t(favorite ? "library.unfavorite" : "library.favorite")} onClick={event => { event.stopPropagation(); state.toggleFavoriteTrack(track); }} onDoubleClick={event => event.stopPropagation()}><Heart fill={favorite ? "currentColor" : "none"} /></button>{hiddenIndicator(track.sourcePath, track)}<div className="card-scanline" /></div>
      <b className="library-entry-title" title={track.name}>{track.name}</b>
      <small className="library-entry-primary">{track.artist}{isVideoTrack(track) && track.year ? ` · ${track.year}` : ""}</small>
      <em className="library-entry-secondary" title={track.videoInfo}>{isVideoTrack(track) ? track.videoInfo || track.format : track.album}</em>
      <span className="library-entry-type">{track.format}</span>
      <span className="library-entry-size">{(track.size / 1024 / 1024).toFixed(1)} MB</span>
      <div className="library-entry-actions"><button type="button" className="queue-track-action" onClick={event => { event.stopPropagation(); enqueueTrackWithFeedback(track.id); }}>{queuedTrackIds.has(track.id) ? t("library.inQueue") : `+ ${t("library.addQueue")}`}</button><button type="button" className="library-artwork-trigger" title={artworkLabel} aria-label={artworkLabel} onClick={event => { event.stopPropagation(); setArtworkId(track.id); }} onDoubleClick={event => event.stopPropagation()}>{track.coverLocked ? <LockKeyhole /> : <ImagePlus />}</button></div>
    </div>;
  };

  // Cover flow floor reflection: the artwork only. Mirroring the whole card put
  // reversed paths and button labels under the slider and doubled every card.
  const renderFlowReflection = (entry: VisibleLibraryEntry) => {
    if (entry.kind === "track") {
      const track = entry.item;
      return track.coverUrl ? <div className="library-entry-media library-art"><LibraryThumbnail source={track.coverUrl} coverFlow highResolution={isVideoTrack(track)} fullscreen={previewFullscreen} /></div> : null;
    }
    const covers = entry.item.covers;
    return covers.length ? <div className="library-entry-media"><div className={`folder-orbit cover-tile covers-${covers.length}`}>
      {covers.map(cover => <LibraryThumbnail source={cover} key={cover} coverFlow highResolution={videoCoverSources.has(cover)} fullscreen={previewFullscreen} />)}
    </div></div> : null;
  };

  const virtualRows = [];
  const virtualStride = virtual.rowHeight + virtual.gap;
  for (let localIndex = 0; localIndex < visibleEntries.length; localIndex += virtual.columns) {
    const globalRow = Math.floor((virtual.offset + localIndex) / virtual.columns);
    virtualRows.push({
      row: globalRow,
      entries: visibleEntries.slice(localIndex, localIndex + virtual.columns),
      top: globalRow * virtualStride
    });
  }

  if (!protection.state.ready) return <div className="library-status">{t("media.libraryLoading")}</div>;
  if (protection.state.broken) return <div className="library-status">{t("media.privacyBroken")}</div>;
  // Short windows: the cover flow's toggle and breadcrumb join the title row (one portal keeps their order).
  const flowTitleRow = shortWindow && libraryView === "flow" && totalListItems > 0 && !previewFullscreen && Boolean(statsSlot);
  const favoritesInTitleRow = flowTitleRow && wideWindow;
  const toolsToggle = <button className="library-tools-toggle" aria-expanded={toolsOpen} onClick={() => setToolsOpen(open => !open)}><Grid3X3 />{toolsOpen ? t("media.toolsHide") : t("media.toolsShow")}</button>;
  const breadcrumbs = <>
    {facet === "文件夹" && folderPath && !deferredQuery && <div className="folder-breadcrumb"><button onClick={() => setFolderPath("")}><Grid3X3 /> {t("library.root")}</button>{folderPath && <><ChevronRight />{parentFolder && <button className="folder-parent-action" aria-label={t("library.parent")} title={t("library.parent")} onClick={navigateToParentFolder}><ArrowUp /> {t("library.parent")}</button>}<span>{folderPath}</span></>}</div>}
    {facet !== "文件夹" && facet !== "收藏" && !deferredQuery && <div className="folder-breadcrumb"><button onClick={() => { setValue("全部"); setCategoryId(""); }}><Grid3X3 /> {facetLabel} · {t("library.categoryOverview")}</button>{value !== "全部" && <><ChevronRight /><span>{value}</span></>}</div>}
  </>;
  // The favorites bar joins the title row only where it is wide enough for its bulk actions.
  const favoritesBreadcrumb = facet === "收藏" && <div className="folder-breadcrumb favorites-breadcrumb"><div className="favorites-title"><Heart fill="currentColor" /> {t("library.favorites")} · {viewModel.trackTotal}</div><div className="favorite-bulk-actions"><label><input type="checkbox" checked={allFilteredFavoritesSelected} disabled={!viewModel.trackTotal} onChange={toggleAllFilteredFavorites} /><span>{t("library.selectAll")}</span></label><em>{t("library.selectedCount").replace("{count}", String(selectedFavoriteCount))}</em><button className="favorite-add-selected" type="button" disabled={!selectedFavoriteCount} onClick={enqueueSelectedFavorites}><ListPlus /> {t("library.addSelected")}</button></div></div>;
  const stats = <div className="library-page-stats">
      <b>{state.libraryTracks.length ? `${visibleMediaCount} ${t("library.stats.tracks")} · ${(libraryStats.totalBytes / 1024 ** 3).toFixed(1)} GB` : t("library.create")}</b>
      <span>{state.libraryFolders.length ? `${state.libraryFolders.length} · ${t("library.folder")}` : t("library.scanHint")}</span>
    </div>;
  return <div ref={libraryRootRef} className={`music-library ${libraryView === "flow" && totalListItems > 0 ? "library-flow-layout" : ""} ${toolsOpen ? "library-tools-open" : ""} ${previewFullscreen ? "library-mosaic-fullscreen" : ""} ${flowTitleRow ? "library-flow-title-row" : ""}`} onContextMenu={e => protection.context(e)}>
    {protection.overlays}
    {protection.error && <div className="library-status" role="alert">{protection.error}</div>}
    {!flowTitleRow && toolsToggle}
    <div className="library-header library-header-simple panel">
    {statsSlot ? createPortal(<>{flowTitleRow && toolsToggle}{flowTitleRow && breadcrumbs}{favoritesInTitleRow && favoritesBreadcrumb}{stats}</>, statsSlot) : <section className="library-command workspace-section panel">
      <div className="library-pulse"><AudioWaveform /></div>
      <div><h3>{state.libraryTracks.length ? `${visibleMediaCount} ${t("library.stats.tracks")} · ${(libraryStats.totalBytes / 1024 ** 3).toFixed(1)} GB` : t("library.create")}</h3><p>{state.libraryFolders.length ? `${state.libraryFolders.length} · ${t("library.folder")}` : t("library.scanHint")}</p></div>
    </section>}

    {state.libraryScanning && progress && <section className="library-scan-progress">
      <div className="scan-radar"><span /><AudioWaveform /></div>
      <div className="scan-copy"><div><b>{progress.phase === "discovering" ? t("library.scanDiscovering") : progress.phase === "complete" ? t("library.scanIndexing") : t("library.scanMetadata")}</b><em>{progress.total ? `${progress.completed} / ${progress.total}` : t("library.enumerating")}</em></div><p title={progress.current}>{progress.current}</p><div className="scan-track"><i style={{ width: `${progress.phase === "discovering" ? 8 : progressPercent}%` }} /></div></div>
      <strong>{progress.phase === "discovering" ? "···" : `${progressPercent}%`}</strong>
      {state.libraryScanRequestId && <button className="library-scan-cancel" disabled={state.libraryScanCancelling} onClick={() => void state.cancelLibraryScan()}>{t(state.libraryScanCancelling ? "media.scanCancelling" : "media.cancelScan")}</button>}
    </section>}

    {folderManagerOpen && <LibraryFolderManager onClose={() => { setFolderManagerOpen(false); setRemovingFolder(null); }}><section className="library-folder-manager" id="library-folder-manager" aria-label={t("library.manageFolders")}>
      <p>{t("library.removeHint")}</p>
      {state.libraryFolders.filter(folder => !hiddenByFolders(folder, hiddenFolders)).map(folder => <div className="library-managed-folder" key={folder}>
        <span title={folder}>{folder}</span>
        {removingFolder === folder ? <div>
          <span>{t("library.removeConfirm")}</span>
          <button disabled={state.libraryScanning} onClick={() => { setRemovingFolder(null); setFolderPath(""); void state.removeLibraryFolder(folder); }}>{t("library.confirmRemove")}</button>
          <button onClick={() => setRemovingFolder(null)}>{t("library.cancelRemove")}</button>
        </div> : <button disabled={state.libraryScanning} onClick={() => setRemovingFolder(folder)}>{t("library.removeFolder")}</button>}
      </div>)}
      <button className="primary-action" disabled={state.libraryScanning} onClick={() => void state.importLibraryFolder()}><FolderPlus />{t("library.addFolder")}</button>
    </section></LibraryFolderManager>}
    <section className="workspace-section panel library-browse" aria-label={t("module.browse")}>
    <div className="library-controls">
      <label className="library-search"><Search /><input value={query} onChange={event => setQuery(event.target.value)} aria-label={t("library.search")} placeholder={t("library.search")} /><kbd>{resultCount}</kbd></label>
      <LibrarySelect className="library-media-filter" label={t("media.mediaType")} value={mediaFilter} options={["all", "audio", "video"].map(kind => ({ value: kind, label: t("library.media." + kind) }))} onChange={kind => { setMediaFilter(kind); setFolderPath(""); setValue("全部"); setCategoryId(""); if (kind === "video") setFacet("文件夹"); }} />
      <LibraryMenu className="library-management" label={t("media.manage")} closeOnAction>
      <button className="primary-action scan-action" disabled={state.libraryScanning} onClick={() => void state.importLibraryFolder()}><FolderPlus />{state.libraryScanning ? t("library.scanning") : t("library.scan")}</button>
      <button className={`primary-action folder-manager-action ${folderManagerOpen ? "active" : ""}`} aria-expanded={folderManagerOpen} aria-controls="library-folder-manager" onClick={() => { setFolderManagerOpen(open => !open); setRemovingFolder(null); }}><FolderOpen />{t("library.manageFolders")}</button>
      <button className="icon-action" disabled={state.libraryScanning || !state.libraryFolders.length} title={t("library.rescan")} onClick={() => void state.rescanLibrary()}><RefreshCw className={state.libraryScanning ? "spinning" : ""} />{t("library.rescan")}</button>
      <button className="library-batch-trigger" title={t(mediaFilter === "audio" ? "music.title" : "media.batchTitle")} onClick={openBatch}><Film />{t("media.batchShort")}</button>
      </LibraryMenu>

      {facet !== "文件夹" && facet !== "收藏" && value !== "全部" && <button className="category-back" onClick={() => { setValue("全部"); setCategoryId(""); }}><ChevronRight /> {t("common.back")} · {facetLabel}</button>}
    </div>

    <div className="library-view-toolbar">
      {previewFullscreen && <div className="library-preview-breadcrumb">
        <button type="button" onMouseDown={event => onFullscreenBreadcrumbMouseDown(event, () => { setFacet("文件夹"); setFolderPath(""); setValue("全部"); setCategoryId(""); setQuery(""); })} onClick={() => onFullscreenBreadcrumbClick(() => { setFacet("文件夹"); setFolderPath(""); setValue("全部"); setCategoryId(""); setQuery(""); })}><Grid3X3 />{t("library.root")}</button>
        {facet === "文件夹" && folderPath && <><ChevronRight />{parentFolder && <button type="button" className="library-preview-parent" onMouseDown={event => onFullscreenBreadcrumbMouseDown(event, navigateToParentFolder)} onClick={() => onFullscreenBreadcrumbClick(navigateToParentFolder)}><ArrowUp />{t("library.parent")}</button>}<span title={folderPath}>{folderPath}</span></>}
        {facet !== "文件夹" && facet !== "收藏" && value !== "全部" && <><ChevronRight /><button type="button" className="library-preview-parent" onClick={() => { setValue("全部"); setCategoryId(""); }}><ArrowUp />{t("common.back")} · {facetLabel}</button><span>{value}</span></>}
      </div>}
      <div className="facet-tabs">{facets.filter(item => previewFullscreen ? item === "文件夹" || item === "收藏" : mediaFilter !== "video" || item === "文件夹" || item === "收藏").map(item => <button className={facet === item ? "active" : ""} key={item} onClick={() => { setFacet(item); setValue("全部"); setCategoryId(""); if (item !== "文件夹") setFolderPath(""); }}>{item === "文件夹" ? <FolderOpen /> : item === "收藏" ? <Heart /> : item === "艺术家" ? <UserRound /> : <Album />}<span>{t(`library.${facetTranslationKey(item)}`)}</span></button>)}</div>
      <LibrarySelect className="library-view-select" label={t("library.viewMode")} value={libraryView} options={libraryViews.map(view => ({ value: view.id, label: t(view.labelKey) }))} onChange={setLibraryView} />
      <button type="button" className="library-mosaic-preview-toggle" title={t(previewFullscreen ? "library.previewExit" : "library.previewFullscreen")} aria-label={t(previewFullscreen ? "library.previewExit" : "library.previewFullscreen")} aria-pressed={previewFullscreen} onClick={() => void toggleMosaicFullscreen()}>{previewFullscreen ? <X /> : <Expand />}<span>{t(previewFullscreen ? "library.previewExit" : "library.previewFullscreen")}</span></button>
      {/* Cover flow keeps the order set in the grid views (album order by default); the menu lives there. */}
      {libraryView !== "flow" && <LibraryMenu className="library-sort-controls" label={`${t("library.sort" + librarySort[0].toUpperCase() + librarySort.slice(1))} ${sortAscending ? "↑" : "↓"}`}>
        {LIBRARY_SORTS.map(sort => <button key={sort} aria-pressed={librarySort === sort} onClick={() => setLibrarySort(sort as LibrarySort)}>{t("library.sort" + sort[0].toUpperCase() + sort.slice(1))}</button>)}
        <button className="library-sort-direction" onClick={toggleSortDirection}><ArrowUpDown />{t(sortAscending ? "library.sortAscending" : "library.sortDescending")}</button>
      </LibraryMenu>}
      {previewFullscreen && (libraryView === "mosaic" || libraryView === "flow") && <label className="library-preview-zoom" title={t("library.zoom")}>
        <ZoomOut aria-hidden="true" />
        <input type="range" min={MIN_PREVIEW_ZOOM * 100} max={100} step={5} value={Math.round(previewZoom * 100)} aria-label={t("library.zoom")} onChange={event => updatePreviewZoom(Number(event.target.value))} />
        <ZoomIn aria-hidden="true" />
        <output>{Math.round(previewZoom * 100)}%</output>
      </label>}
    </div>

    </section>
    </div>
    {!flowTitleRow && breadcrumbs}
    {!favoritesInTitleRow && favoritesBreadcrumb}

    {state.libraryError && <div className="library-status"><Tags />{hiddenFolders.length ? t("media.privacyError") : tm(state.libraryError)}</div>}
    {libraryView === "flow" && totalListItems > 0 ? <MediaFlow navigationKey={`${facet}|${folderPath}|${categoryId}|${deferredQuery}|${mediaFilter}`} count={totalListItems} selected={selectedFlowIndex} offset={flowOffset} zoom={previewFullscreen ? previewZoom : 1} visibleRadius={previewFullscreen ? flowVisibleRadius : 3} onSelect={setFlowIndex} onItemContextMenu={(index, e) => { const entry = visibleEntries[index - flowOffset]; if (entry?.kind === "folder") protection.context(e, entry.item.path); else if (entry?.kind === "track") protection.context(e, undefined, entry.item); else protection.context(e); }} onActivate={() => {
      const entry = visibleEntries[selectedFlowIndex - flowOffset];
      if (!entry) return;
      if (entry.kind === "track") enqueueTrackWithFeedback(entry.item.id, true);
      else if (entry.kind === "folder") setFolderPath(entry.item.path);
      else { setValue(entry.item.name); setCategoryId(entry.item.key); setQuery(""); }
    }} reflections={visibleEntries.map(renderFlowReflection)}>{visibleEntries.map(renderLibraryEntry)}</MediaFlow> : <div className={`library-grid advanced virtualized library-view-${libraryView}${previewFullscreen ? libraryView === "mosaic" ? " library-infinite-viewport" : " library-fullscreen-scroll" : ""}${mosaicPanning ? " mosaic-panning" : ""}`} ref={previewFullscreen && libraryView === "mosaic" ? mosaicViewport : undefined} onPointerDown={onMosaicPointerDown} onPointerMove={onMosaicPointerMove} onPointerUp={finishMosaicPan} onPointerCancel={finishMosaicPan} onLostPointerCapture={finishMosaicPan} onClickCapture={onMosaicClickCapture}>
      {libraryView === "details" && hasVisibleEntries && <div className="library-detail-head"><span>{t("library.cover")}</span><span>{t("library.item")}</span><span>{t("library.info")}</span><span>{t("library.summary")}</span><span>{t("library.type")}</span><span>{t("library.countSize")}</span><span>{t("library.actions")}</span></div>}
      {previewFullscreen && libraryView === "mosaic" && totalListItems > 0
        ? <div ref={mosaicStage} className="library-infinite-stage" style={{ transform: `translate3d(calc(-33.333333% + ${mosaicCanvasOffset.current.x}px), calc(-33.333333% + ${mosaicCanvasOffset.current.y}px), 0)` }}>
          {infiniteMosaicBoards.map(board => <div className="library-infinite-cell" key={`world-${board.world}`} style={{ gridColumn: board.column + 2, gridRow: board.row + 2 }}><div className="library-mosaic-board" data-layout="slots" style={mosaicBoardStyle}>{board.entries.map((entry, index) => {
            const keyedEntry = { ...entry, key: `${entry.key}-world-${board.world}-${index}` } as VisibleLibraryEntry;
            const slot = mosaicBoardSlots[index];
            return <div className={`library-mosaic-tile mosaic-slot-${index + 1}`} key={keyedEntry.key} style={slot ? { gridColumn: `${slot.column} / span ${slot.columnSpan}`, gridRow: `${slot.row} / span ${slot.rowSpan}` } : undefined}>{renderLibraryEntry(keyedEntry)}</div>;
          })}</div></div>)}
        </div>
        : totalListItems > 0 && <div className="library-virtual-body" ref={virtual.containerRef} style={{ height: virtual.totalHeight }}>
        {virtualRows.map(row => <div className={`library-virtual-row${libraryView === "mosaic" ? " library-mosaic-row" : ""}`} key={row.row} style={{ top: row.top, height: virtual.rowHeight, gridTemplateColumns: libraryView === "details" ? "minmax(900px, 1fr)" : `repeat(${virtual.columns}, minmax(0, 1fr))`, gap: virtual.gap }}>
          {libraryView === "mosaic"
            ? <div className="library-mosaic-board">{row.entries.map((entry, index) => <div className={`library-mosaic-tile mosaic-slot-${index + 1}`} key={entry.key}>{renderLibraryEntry(entry)}</div>)}</div>
            : row.entries.map(renderLibraryEntry)}
        </div>)}
      </div>}
      {!totalListItems && <div className="library-empty">{facet === "收藏" ? <Heart /> : <FolderOpen />}<b>{facet === "收藏" ? t("library.noFavorites") : state.libraryTracks.length ? t("library.noMatch") : t("library.awaiting")}</b><span>{facet === "收藏" ? t("library.noFavoritesHint") : state.libraryTracks.length ? t("library.tryFilter") : t("library.awaitingHint")}</span>{facet !== "收藏" && <button onClick={() => void state.importLibraryFolder()}><FolderPlus /> {t("library.scan")}</button>}</div>}
    </div>
    }
    {queueNotice && noticeHost && createPortal(<div className="library-queue-notice" role="status" aria-live="polite" key={queueNotice.id}><CheckCircle2 /><div><b>{t("library.queueUpdated")}</b><span>{queueNotice.text}</span></div></div>, noticeHost)}
  </div>;
});

function CoverTile({ covers, count, fallback, coverFlow = false, smartFocus = false, fullscreen = false, highResolutionSources }: { covers: string[]; count: number; fallback: React.ReactNode; coverFlow?: boolean; smartFocus?: boolean; fullscreen?: boolean; highResolutionSources: ReadonlySet<string> }) {
  return <div className={`folder-orbit cover-tile covers-${covers.length}`}>
    {covers.length ? covers.map(cover => <LibraryThumbnail source={cover} key={cover} coverFlow={coverFlow} highResolution={highResolutionSources.has(cover)} smartFocus={smartFocus} fullscreen={fullscreen} />) : fallback}
    <span>{count}</span>
  </div>;
}
