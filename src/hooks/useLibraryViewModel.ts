import { hiddenByFolders } from "../utils/folderVisibility";
import { useEffect, useMemo } from "react";
import { favoriteTrackKey } from "../stores/playerStore";
import type { Track } from "../types/audio";
import {
  reusableHiddenFolderIndex,
  reusableLibraryIndex,
  type LibraryDerivedIndexSnapshot,
  trackAlbumId,
  trackArtistIds,
  trackMediaId,
  type LibraryCategoryFacet,
  type LibraryQueryScope,
  type LibrarySort
} from "../library/LibraryQueryService";

type Facet = "文件夹" | "艺术家" | "专辑" | "收藏";
const savedDerivedIndexes = new WeakSet<object>();

export interface LibraryViewModelInput {
  tracks: Track[];
  cacheWritable?: boolean;
  hiddenFolders?: string[];
  cache: LibraryDerivedIndexSnapshot | null;
  roots: string[];
  revision: number;
  favorites: string[];
  facet: Facet;
  value: string;
  categoryId: string;
  folderPath: string;
  search: string;
  sort: LibrarySort;
  sortAscending: boolean;
  locale: string;
}

export function useLibraryViewModel(input: LibraryViewModelInput) {
  // Reused across page visits while the store's track array is unchanged.
  const canonicalIndex = useMemo(() => reusableLibraryIndex(input.tracks, input.cache, input.revision), [input.tracks, input.cache, input.revision]);
  useEffect(() => {
    if (input.cacheWritable === false || !input.tracks.length || canonicalIndex.usedDerivedCache || savedDerivedIndexes.has(canonicalIndex)
      || !window.desktop?.library.saveDerivedIndex) return;
    const save = () => {
      // The index is reused across page visits; export and write it only once.
      savedDerivedIndexes.add(canonicalIndex);
      void window.desktop?.library.saveDerivedIndex(input.revision, canonicalIndex.exportSnapshot());
    };
    const handle = window.requestIdleCallback(save, { timeout: 5000 });
    return () => window.cancelIdleCallback(handle);
  }, [canonicalIndex, input.revision, input.tracks.length, input.cacheWritable]);
  const index = useMemo(() => input.hiddenFolders?.length
    ? reusableHiddenFolderIndex(canonicalIndex, input.hiddenFolders, track => hiddenByFolders(track.sourcePath, input.hiddenFolders!))
    : canonicalIndex, [canonicalIndex, input.hiddenFolders]);
  const roots = useMemo(() => input.hiddenFolders?.length ? input.roots.filter(root => !hiddenByFolders(root, input.hiddenFolders!)) : input.roots, [input.roots, input.hiddenFolders]);
  const favoriteMediaIds = useMemo(() => {
    const favoriteKeys = new Set(input.favorites);
    return input.tracks
      .filter(track => favoriteKeys.has(favoriteTrackKey(track)))
      .map(trackMediaId);
  }, [input.tracks, input.favorites]);
  const scope = useMemo<LibraryQueryScope>(() => {
    const scope: LibraryQueryScope = {
      search: input.search,
      sort: input.sort,
      sortAscending: input.sortAscending
    };
    if (input.facet === "收藏") scope.favoriteMediaIds = favoriteMediaIds;
    else if (input.facet === "文件夹" && !input.search && input.folderPath) scope.folders = [input.folderPath];
    else if (input.value !== "全部") {
      const representative = input.tracks.find(track => input.facet === "艺术家" ? track.artist === input.value
        : input.facet === "专辑" ? track.album === input.value : false);
      if (input.facet === "艺术家" && input.categoryId) scope.artistIds = [input.categoryId];
      else if (input.facet === "专辑" && input.categoryId) scope.albumIds = [input.categoryId];
      else if (input.facet === "艺术家" && representative) {
        const exact = representative.tags?.artists.find(artist => artist.name === input.value)?.artistId;
        scope.artistIds = [exact || trackArtistIds(representative)[0]].filter((id): id is string => Boolean(id));
      }
      else if (input.facet === "专辑" && representative) scope.albumIds = [trackAlbumId(representative)];
    }
    return scope;
  }, [input.search, input.sort, input.sortAscending, input.facet, input.folderPath, input.value, input.categoryId, input.tracks, favoriteMediaIds]);
  const showTracks = input.facet === "收藏"
    || (input.facet === "文件夹" ? Boolean(input.search) || Boolean(input.folderPath) : input.value !== "全部");
  const sortedTrackIds = useMemo(() => showTracks ? index.queryIds(scope, input.locale) : [], [index, scope, input.locale, showTracks]);
  const favoriteSelectableIds = useMemo(() => input.facet === "收藏"
    ? index.orderedTracks(sortedTrackIds).map(track => track.id) : [], [index, input.facet, sortedTrackIds]);
  const folderOverview = useMemo(() => index.folderPage(roots, input.folderPath, 0, 1, input.sort, input.sortAscending), [index, roots, input.folderPath, input.sort, input.sortAscending]);
  const categoryOverview = useMemo(() => input.facet === "文件夹" || input.facet === "收藏" ? null
    : index.categoryPage(input.facet as LibraryCategoryFacet, input.search, {
      sort: input.sort,
      sortAscending: input.sortAscending
    }, input.locale, 0, 1), [index, input.facet, input.search, input.sort, input.sortAscending, input.locale]);
  const stats = useMemo(() => index.stats(), [index]);
  const selectionSnapshot = (orderedMediaIds: string[]) => index.selectionSnapshot(input.revision, orderedMediaIds, scope);
  const trackPage = (offset: number, limit: number) => ({
    items: index.orderedTracks(sortedTrackIds.slice(offset, offset + limit)),
    total: sortedTrackIds.length
  });
  const folderPage = (offset: number, limit: number) => index.folderPage(roots, input.folderPath, offset, limit, input.sort, input.sortAscending);
  const categoryPage = (offset: number, limit: number) => input.facet === "文件夹" || input.facet === "收藏"
    ? { items: [], total: 0, offset, limit, hasMore: false }
    : index.categoryPage(input.facet as LibraryCategoryFacet, input.search, {
      sort: input.sort,
      sortAscending: input.sortAscending
    }, input.locale, offset, limit);
  const selectedFavoriteMediaIds = (selectedTrackIds: Set<string>) => sortedTrackIds.filter(mediaId => {
    const track = index.byMediaId.get(mediaId);
    return Boolean(track && selectedTrackIds.has(track.id));
  });
  return {
    index,
    scope,
    trackTotal: sortedTrackIds.length,
    folderTotal: folderOverview.total,
    categoryTotal: categoryOverview?.total || 0,
    favoriteSelectableIds,
    trackPage,
    folderPage,
    categoryPage,
    selectedFavoriteMediaIds,
    stats,
    selectionSnapshot
  };
}
