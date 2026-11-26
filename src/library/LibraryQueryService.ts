import type { Track } from "../types/audio";

/** "track" is album order: album, then disc and track number, then title. */
export type LibrarySort = "track" | "title" | "artist" | "album" | "format" | "size";
export const LIBRARY_SORTS: readonly LibrarySort[] = ["track", "title", "artist", "album", "format", "size"];

export interface LibraryQueryScope {
  search?: string;
  artistIds?: string[];
  albumIds?: string[];
  genres?: string[];
  rootIds?: string[];
  formats?: string[];
  folders?: string[];
  favoriteMediaIds?: string[];
  sort?: LibrarySort;
  sortAscending?: boolean;
  availability?: Array<"available" | "unavailable">;
}

export interface SelectionSnapshot {
  libraryRevision: number;
  orderedMediaIds: string[];
  scope: LibraryQueryScope;
}

export type LibraryCategoryFacet = "艺术家" | "专辑";

export interface LibraryPage<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface LibraryCategoryGroup {
  key: string;
  name: string;
  count: number;
  ids: string[];
  artists: Set<string>;
  albums: Set<string>;
  formats: Set<string>;
  covers: string[];
}

export interface LibraryFolderNode {
  path: string;
  count: number;
  directIds: string[];
  formats: Set<string>;
  covers: string[];
}

/** A folder as folderPage lists it: how many listed folders are directly inside it. */
export interface LibraryFolderEntry extends LibraryFolderNode {
  subfolderCount: number;
}

interface CachedCategoryGroup {
  key: string;
  name: string;
  ids: string[];
  artists: Set<string>;
  albums: Set<string>;
  formats: Set<string>;
  covers: string[];
  coverSet: Set<string>;
  searchText: string;
}

interface CachedFolderNode extends LibraryFolderNode {
  totalBytes: number;
  descendantIds: string[];
  descendantSet: Set<string>;
  formatSet: Set<string>;
  coverSet: Set<string>;
}

export interface SerializedLibraryCategoryGroup {
  key: string;
  name: string;
  ids: string[];
  artists: string[];
  albums: string[];
  formats: string[];
  covers: string[];
  searchText: string;
}

export interface SerializedLibraryFolderNode {
  path: string;
  directIds: string[];
  descendantIds: string[];
  formats: string[];
  covers: string[];
}

export interface LibraryDerivedIndexSnapshot {
  schemaVersion: 1;
  normalizationVersion: 1;
  libraryRevision: number;
  trackSignature: string;
  searchTextEntries: Array<[string, string]>;
  artists: SerializedLibraryCategoryGroup[];
  albums: SerializedLibraryCategoryGroup[];
  folders: SerializedLibraryFolderNode[];
  stats: { totalBytes: number; hiRes: number; artistCount: number; albumCount: number };
}

// Folder paths, artists, albums and formats repeat across thousands of tracks,
// and NFKC + regex + lowercase was the top cost of opening the library.
const NORMALIZE_CACHE_LIMIT = 200_000;
const normalizeCache = new Map<string, string>();
const normalize = (value?: string) => {
  const raw = String(value || "");
  const cached = normalizeCache.get(raw);
  if (cached !== undefined) return cached;
  const result = raw.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  if (normalizeCache.size >= NORMALIZE_CACHE_LIMIT) normalizeCache.clear();
  normalizeCache.set(raw, result);
  return result;
};
const mediaIdOf = (track: Track) => track.mediaId || track.id;
const artistIdsOf = (track: Track) => track.tags?.artists.map(artist => artist.artistId)
  || (track.artist ? [`legacy-artist:${normalize(track.artist)}`] : []);
const albumIdOf = (track: Track) => track.albumId
  || `legacy-album:${normalize(track.tags?.albumArtist || track.artist)}:${normalize(track.tags?.album || track.album)}`;

const trimmedFolder = (value?: string) => String(value || "").trim().replace(/\//g, "\\").replace(/\\+$/, "");
/** A folder node's path: no trailing separator, except a drive root keeps it ("E:" and "E:\" are both "E:\"). */
const canonicalFolder = (value?: string) => {
  const folder = trimmedFolder(value);
  return /^[a-z]:$/i.test(folder) ? `${folder}\\` : folder;
};
const parentFolder = (value: string) => {
  if (/^[a-z]:\\?$/i.test(value) || /^\\\\[^\\]+\\[^\\]+\\?$/i.test(value)) return "";
  const index = value.lastIndexOf("\\");
  if (index <= 0) return "";
  const parent = value.slice(0, index);
  return /^[a-z]:$/i.test(parent) ? `${parent}\\` : parent;
};
const folderComparisonKey = (value: string) => normalize(trimmedFolder(value));
/** The index key of a folder node (byFolder and the folder tree use the same one). */
const folderNodeKey = (value: string) => normalize(canonicalFolder(value));
/** True when `folder` is `root` or below it (case-insensitive, drive roots included). */
export function libraryFolderWithin(folder: string, root: string) {
  const candidate = folderComparisonKey(folder), parent = folderComparisonKey(root);
  return Boolean(parent) && (candidate === parent || candidate.startsWith(parent + "\\"));
}
const folderAncestors = (value?: string) => {
  const paths: string[] = [];
  let current = canonicalFolder(value);
  const visited = new Set<string>();
  while (current && !visited.has(normalize(current))) {
    visited.add(normalize(current));
    paths.push(current);
    const parent = parentFolder(current);
    if (!parent || normalize(parent) === normalize(current)) break;
    current = parent;
  }
  return paths;
};

const clampPage = (total: number, offset = 0, limit = 100) => {
  const safeOffset = Math.max(0, Math.min(total, Math.floor(offset) || 0));
  const requestedLimit = Math.floor(limit) || 100;
  const safeLimit = requestedLimit >= total ? Math.max(1, total) : Math.max(1, Math.min(1000, requestedLimit));
  return { offset: safeOffset, limit: safeLimit };
};

function addIndex(map: Map<string, string[]>, key: string, mediaId: string) {
  if (!key) return;
  const values = map.get(key);
  if (values) values.push(mediaId);
  else map.set(key, [mediaId]);
}

function intersect(candidate: Set<string> | undefined, values: string[]) {
  if (!candidate) return new Set(values);
  const allowed = new Set(values);
  return new Set([...candidate].filter(value => allowed.has(value)));
}

const collators = new Map<string, Intl.Collator>();
function trackCollator(locale: string) {
  let collator = collators.get(locale);
  if (!collator) {
    collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
    collators.set(locale, collator);
    if (collators.size > 8) collators.delete(collators.keys().next().value || "");
  }
  return collator;
}

// Missing disc or track numbers sort after numbered tracks of the same album.
const positionNumber = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : Number.MAX_SAFE_INTEGER;

// Albums with the same title ("Greatest Hits", "Live") stay apart: after the
// title come the album artist and the album identity, then disc and track.
function compareAlbumIdentity(left: Track, right: Track) {
  const leftAlbum = albumIdOf(left), rightAlbum = albumIdOf(right);
  return leftAlbum < rightAlbum ? -1 : leftAlbum > rightAlbum ? 1 : 0;
}

function compareAlbumOrder(left: Track, right: Track, collator: Intl.Collator) {
  return collator.compare(String(left.tags?.album || left.album || ""), String(right.tags?.album || right.album || ""))
    || collator.compare(String(left.tags?.albumArtist || ""), String(right.tags?.albumArtist || ""))
    || compareAlbumIdentity(left, right)
    || positionNumber(left.tags?.discNumber) - positionNumber(right.tags?.discNumber)
    || positionNumber(left.tags?.trackNumber) - positionNumber(right.tags?.trackNumber);
}

function compareTracks(left: Track, right: Track, scope: LibraryQueryScope, locale: string) {
  const sort = scope.sort || "title";
  const direction = scope.sortAscending === false ? -1 : 1;
  const collator = trackCollator(locale);
  let comparison = sort === "track" ? compareAlbumOrder(left, right, collator) : sort === "size" ? left.size - right.size : collator.compare(String(
    sort === "artist" ? left.artist : sort === "album" ? left.album : sort === "format" ? left.format : left.name
  ), String(
    sort === "artist" ? right.artist : sort === "album" ? right.album : sort === "format" ? right.format : right.name
  ));
  if (!comparison) comparison = collator.compare(left.name, right.name);
  return comparison * direction;
}

const trackSearchText = (track: Track) => normalize([
  track.name, track.artist, track.album, track.genre, track.format, track.folder,
  ...(track.tags?.artists.map(artist => artist.name) || []), track.tags?.albumArtist,
  ...(track.tags?.genres || [])
].join(" "));

function trackSignature(tracks: Track[]) {
  if (!tracks.length) return "0:0:0";
  let totalSize = 0;
  let rolling = 2166136261;
  for (const track of tracks) {
    totalSize = (totalSize + Number(track.size || 0)) % 2147483647;
    const sample = `${mediaIdOf(track)}|${track.name}|${track.artist}|${track.album}`;
    for (let index = 0; index < sample.length; index++) {
      rolling ^= sample.charCodeAt(index);
      rolling = Math.imul(rolling, 16777619);
    }
  }
  return `${tracks.length}:${totalSize}:${(rolling >>> 0).toString(16)}`;
}

export class LibraryIndex {
  readonly byMediaId = new Map<string, Track>();
  readonly byArtistId = new Map<string, string[]>();
  readonly byAlbumId = new Map<string, string[]>();
  readonly byRootId = new Map<string, string[]>();
  readonly byNormalizedTitle = new Map<string, string[]>();
  readonly byGenre = new Map<string, string[]>();
  readonly byFormat = new Map<string, string[]>();
  readonly byFolder = new Map<string, string[]>();
  readonly orderedMediaIds: string[] = [];
  readonly searchTextByMediaId = new Map<string, string>();

  private readonly artistGroups = new Map<string, CachedCategoryGroup>();
  private readonly albumGroups = new Map<string, CachedCategoryGroup>();
  private readonly folderNodesByPath = new Map<string, CachedFolderNode>();
  private readonly folderChildren = new Map<string, string[]>();
  private readonly subfolderCounts = new Map<string, number>();
  private readonly sortedGroupIds = new Map<string, string[]>();
  private readonly queryCache = new Map<string, string[]>();
  private derivedStats = { totalBytes: 0, hiRes: 0, artistCount: 0, albumCount: 0 };
  private readonly signature: string;
  readonly usedDerivedCache: boolean;

  constructor(readonly tracks: Track[], cache?: LibraryDerivedIndexSnapshot | null, readonly libraryRevision = 0) {
    for (const track of tracks) {
      const mediaId = mediaIdOf(track);
      if (this.byMediaId.has(mediaId)) continue;
      this.byMediaId.set(mediaId, track);
      this.orderedMediaIds.push(mediaId);
      addIndex(this.byRootId, track.location?.rootId || "", mediaId);
      addIndex(this.byNormalizedTitle, normalize(track.tags?.title || track.name), mediaId);
      for (const genre of track.tags?.genres || (track.genre ? [track.genre] : [])) addIndex(this.byGenre, normalize(genre), mediaId);
      addIndex(this.byFormat, normalize(track.format), mediaId);
    }
    this.signature = trackSignature(tracks);
    // A cache from before drive roots kept their separator has a bare "E:" node
    // for files directly on the drive, next to "E:\" for its folders: rebuild.
    this.usedDerivedCache = Boolean(cache && cache.schemaVersion === 1 && cache.normalizationVersion === 1
      && cache.libraryRevision === libraryRevision && cache.trackSignature === this.signature
      && !cache.folders.some(folder => /^[a-z]:$/i.test(folder.path)));
    if (this.usedDerivedCache) this.hydrateDerived(cache!);
    else this.buildDerived();
  }

  private makeCategoryGroup(map: Map<string, CachedCategoryGroup>, key: string, name: string) {
    let group = map.get(key);
    if (!group) {
      group = { key, name, ids: [], artists: new Set(), albums: new Set(), formats: new Set(), covers: [], coverSet: new Set(), searchText: "" };
      map.set(key, group);
    }
    return group;
  }

  private addTrackToCategory(group: CachedCategoryGroup, track: Track, mediaId: string) {
    group.ids.push(mediaId);
    if (track.artist) group.artists.add(track.artist);
    for (const artist of track.tags?.artists || []) group.artists.add(artist.name);
    if (track.tags?.albumArtist) group.artists.add(track.tags.albumArtist);
    if (track.album) group.albums.add(track.album);
    if (track.format) group.formats.add(track.format);
    if (track.coverUrl && group.covers.length < 4 && !group.coverSet.has(track.coverUrl)) {
      group.coverSet.add(track.coverUrl);
      group.covers.push(track.coverUrl);
    }
  }

  private ensureFolderNode(path: string) {
    const key = normalize(path);
    let node = this.folderNodesByPath.get(key);
    if (!node) {
      node = { path, count: 0, totalBytes: 0, directIds: [], descendantIds: [], descendantSet: new Set(), formats: new Set(), formatSet: new Set(), covers: [], coverSet: new Set() };
      this.folderNodesByPath.set(key, node);
    }
    return node;
  }

  private addFolderTrack(track: Track, mediaId: string) {
    const ancestors = folderAncestors(track.folder);
    if (!ancestors.length) return;
    const exact = this.ensureFolderNode(ancestors[0]);
    exact.directIds.push(mediaId);
    addIndex(this.byFolder, normalize(exact.path), mediaId);
    for (const path of ancestors) {
      const node = this.ensureFolderNode(path);
      if (!node.descendantSet.has(mediaId)) {
        node.descendantSet.add(mediaId);
        node.descendantIds.push(mediaId);
        node.count = node.descendantIds.length;
        node.totalBytes += Math.max(0, Number(track.size) || 0);
      }
      if (track.format) { node.formatSet.add(track.format); node.formats = node.formatSet; }
      if (track.coverUrl && node.covers.length < 4 && !node.coverSet.has(track.coverUrl)) {
        node.coverSet.add(track.coverUrl);
        node.covers.push(track.coverUrl);
      }
    }
  }

  private rebuildFolderChildren() {
    this.folderChildren.clear();
    this.subfolderCounts.clear();
    for (const node of this.folderNodesByPath.values()) {
      const parent = normalize(parentFolder(node.path));
      if (!parent) continue;
      const children = this.folderChildren.get(parent);
      if (children) children.push(normalize(node.path));
      else this.folderChildren.set(parent, [normalize(node.path)]);
    }
    for (const [parent, children] of this.folderChildren) this.folderChildren.set(parent, Array.from(new Set(children)));
  }

  private buildDerived() {
    let totalBytes = 0;
    let hiRes = 0;
    for (const track of this.byMediaId.values()) {
      const mediaId = mediaIdOf(track);
      totalBytes += Number(track.size || 0);
      if (/^(FLAC|APE|DSF|WAV|AIFF|AIF)$/.test(track.format)) hiRes++;
      this.searchTextByMediaId.set(mediaId, trackSearchText(track));
      const artists = track.tags?.artists.length
        ? track.tags.artists.map(artist => ({ key: artist.artistId, name: artist.name }))
        : [{ key: artistIdsOf(track)[0] || "unknown-artist", name: track.artist || "未知艺术家" }];
      for (const artist of artists) {
        addIndex(this.byArtistId, artist.key, mediaId);
        this.addTrackToCategory(this.makeCategoryGroup(this.artistGroups, artist.key, artist.name), track, mediaId);
      }
      const albumKey = albumIdOf(track);
      addIndex(this.byAlbumId, albumKey, mediaId);
      this.addTrackToCategory(this.makeCategoryGroup(this.albumGroups, albumKey, track.album || "未分类专辑"), track, mediaId);
      this.addFolderTrack(track, mediaId);
    }
    for (const group of this.artistGroups.values()) group.searchText = normalize(group.name);
    for (const group of this.albumGroups.values()) group.searchText = normalize([group.name, ...group.artists].join(" "));
    this.rebuildFolderChildren();
    this.derivedStats = { totalBytes, hiRes, artistCount: this.artistGroups.size, albumCount: this.albumGroups.size };
  }

  private hydrateGroup(map: Map<string, CachedCategoryGroup>, serialized: SerializedLibraryCategoryGroup, index: Map<string, string[]>) {
    const ids = serialized.ids.filter(id => this.byMediaId.has(id));
    const group: CachedCategoryGroup = {
      key: serialized.key, name: serialized.name, ids,
      artists: new Set(serialized.artists), albums: new Set(serialized.albums), formats: new Set(serialized.formats),
      covers: serialized.covers, coverSet: new Set(serialized.covers), searchText: serialized.searchText
    };
    map.set(group.key, group);
    index.set(group.key, ids);
  }

  private hydrateDerived(cache: LibraryDerivedIndexSnapshot) {
    for (const [mediaId, searchText] of cache.searchTextEntries) if (this.byMediaId.has(mediaId)) this.searchTextByMediaId.set(mediaId, searchText);
    cache.artists.forEach(group => this.hydrateGroup(this.artistGroups, group, this.byArtistId));
    cache.albums.forEach(group => this.hydrateGroup(this.albumGroups, group, this.byAlbumId));
    for (const serialized of cache.folders) {
      const directIds = serialized.directIds.filter(id => this.byMediaId.has(id));
      const descendantIds = serialized.descendantIds.filter(id => this.byMediaId.has(id));
      const node: CachedFolderNode = {
        path: serialized.path, count: descendantIds.length,
        totalBytes: descendantIds.reduce((sum, id) => sum + Math.max(0, Number(this.byMediaId.get(id)?.size) || 0), 0),
        directIds, descendantIds,
        descendantSet: new Set(descendantIds), formats: new Set(serialized.formats), formatSet: new Set(serialized.formats),
        covers: serialized.covers, coverSet: new Set(serialized.covers)
      };
      this.folderNodesByPath.set(normalize(node.path), node);
      this.byFolder.set(normalize(node.path), directIds);
    }
    this.rebuildFolderChildren();
    this.derivedStats = cache.stats;
  }

  exportSnapshot(): LibraryDerivedIndexSnapshot {
    const serializeGroup = (group: CachedCategoryGroup): SerializedLibraryCategoryGroup => ({
      key: group.key, name: group.name, ids: [...group.ids], artists: [...group.artists], albums: [...group.albums],
      formats: [...group.formats], covers: [...group.covers], searchText: group.searchText
    });
    return {
      schemaVersion: 1, normalizationVersion: 1, libraryRevision: this.libraryRevision, trackSignature: this.signature,
      searchTextEntries: [...this.searchTextByMediaId],
      artists: [...this.artistGroups.values()].map(serializeGroup), albums: [...this.albumGroups.values()].map(serializeGroup),
      folders: [...this.folderNodesByPath.values()].map(node => ({
        path: node.path, directIds: [...node.directIds], descendantIds: [...node.descendantIds],
        formats: [...node.formats], covers: [...node.covers]
      })),
      stats: { ...this.derivedStats }
    };
  }

  private idsFor(map: Map<string, string[]>, keys: string[]) {
    return keys.flatMap(key => map.get(key) || map.get(normalize(key)) || []);
  }

  queryIds(scope: LibraryQueryScope = {}, locale = "zh-CN") {
    const cacheKey = JSON.stringify([scope, locale]);
    const cached = this.queryCache.get(cacheKey);
    if (cached) return cached;
    let candidates: Set<string> | undefined;
    if (scope.artistIds) candidates = intersect(candidates, this.idsFor(this.byArtistId, scope.artistIds));
    if (scope.albumIds) candidates = intersect(candidates, this.idsFor(this.byAlbumId, scope.albumIds));
    if (scope.rootIds) candidates = intersect(candidates, this.idsFor(this.byRootId, scope.rootIds));
    if (scope.genres) candidates = intersect(candidates, this.idsFor(this.byGenre, scope.genres));
    if (scope.formats) candidates = intersect(candidates, this.idsFor(this.byFormat, scope.formats));
    if (scope.folders) candidates = intersect(candidates, this.idsFor(this.byFolder, scope.folders.map(folderNodeKey)));
    if (scope.favoriteMediaIds) candidates = intersect(candidates, scope.favoriteMediaIds);
    const search = normalize(scope.search);
    // Id lists from outside (favorites) may name media this index left out, such as
    // media under hidden folders: keep only what the index holds, so totals and pages agree.
    let result = candidates ? [...candidates].filter(mediaId => this.byMediaId.has(mediaId)) : [...this.orderedMediaIds];
    if (search) result = result.filter(mediaId => (this.searchTextByMediaId.get(mediaId) || "").includes(search));
    if (scope.availability?.length === 1) {
      const available = scope.availability[0] === "available";
      result = result.filter(mediaId => {
        const track = this.byMediaId.get(mediaId);
        return Boolean(track && Boolean(track.sourcePath || track.nativePath) === available);
      });
    }
    result.sort((leftId, rightId) => {
      const left = this.byMediaId.get(leftId), right = this.byMediaId.get(rightId);
      return left && right ? compareTracks(left, right, scope, locale) : 0;
    });
    this.queryCache.set(cacheKey, result);
    if (this.queryCache.size > 24) this.queryCache.delete(this.queryCache.keys().next().value || "");
    return result;
  }

  query(scope: LibraryQueryScope = {}, locale = "zh-CN") { return this.orderedTracks(this.queryIds(scope, locale)); }

  queryPage(scope: LibraryQueryScope = {}, locale = "zh-CN", offset = 0, limit = 100): LibraryPage<Track> {
    const ids = this.queryIds(scope, locale);
    const page = clampPage(ids.length, offset, limit);
    return { items: this.orderedTracks(ids.slice(page.offset, page.offset + page.limit)), total: ids.length, ...page, hasMore: page.offset + page.limit < ids.length };
  }

  orderedTracks(mediaIds: string[]) { return mediaIds.map(mediaId => this.byMediaId.get(mediaId)).filter((track): track is Track => Boolean(track)); }

  selectionSnapshot(libraryRevision: number, orderedMediaIds: string[], scope: LibraryQueryScope): SelectionSnapshot {
    return { libraryRevision, orderedMediaIds: [...orderedMediaIds], scope: {
      ...scope,
      artistIds: scope.artistIds ? [...scope.artistIds] : undefined, albumIds: scope.albumIds ? [...scope.albumIds] : undefined,
      genres: scope.genres ? [...scope.genres] : undefined, rootIds: scope.rootIds ? [...scope.rootIds] : undefined,
      formats: scope.formats ? [...scope.formats] : undefined, folders: scope.folders ? [...scope.folders] : undefined,
      favoriteMediaIds: scope.favoriteMediaIds ? [...scope.favoriteMediaIds] : undefined,
      availability: scope.availability ? [...scope.availability] : undefined
    } };
  }

  stats() { return { ...this.derivedStats }; }

  /** Folders with media directly inside `node` (the ones browsing into it would list). */
  private subfolderCount(node: CachedFolderNode) {
    const nodeKey = normalize(node.path);
    const cached = this.subfolderCounts.get(nodeKey);
    if (cached !== undefined) return cached;
    let count = 0;
    for (const key of this.folderChildren.get(nodeKey) || []) if (this.folderNodesByPath.get(key)?.count) count++;
    this.subfolderCounts.set(nodeKey, count);
    return count;
  }

  // Folders holding other folders (a genre or artist shelf) come first, then the
  // folders holding only media (albums), then the media themselves (MusicLibrary
  // lists tracks after every folder). The chosen sort orders each group; the
  // groups stay in this order whatever the sort and its direction.
  folderPage(roots: string[], currentPath: string, offset = 0, limit = 100, sort: LibrarySort = "title", sortAscending = true): LibraryPage<LibraryFolderEntry> {
    // The index keeps every ancestor up to the drive, but browsing stays inside
    // the library roots: a folder above them is not part of the library.
    const insideRoots = !currentPath || roots.some(root => libraryFolderWithin(currentPath, root));
    const keys = !insideRoots ? [] : currentPath ? this.folderChildren.get(folderNodeKey(currentPath)) || [] : [...new Set(roots.map(folderNodeKey))].filter(key => this.folderNodesByPath.has(key));
    const nodes = keys.map(key => this.folderNodesByPath.get(key)).filter((node): node is CachedFolderNode => Boolean(node))
      .filter(node => node.count).map(node => ({ node, subfolderCount: this.subfolderCount(node) }))
      .sort((left, right) => {
        const grouping = Number(right.subfolderCount > 0) - Number(left.subfolderCount > 0);
        if (grouping) return grouping;
        if (sort === "size") {
          const sizeDifference = (left.node.totalBytes - right.node.totalBytes) * (sortAscending ? 1 : -1);
          if (sizeDifference) return sizeDifference;
        }
        return left.node.path.localeCompare(right.node.path, "zh-CN");
      });
    const page = clampPage(nodes.length, offset, limit);
    return {
      items: nodes.slice(page.offset, page.offset + page.limit).map(({ node, subfolderCount }) => ({
        path: node.path, count: node.count, directIds: [...node.directIds], formats: new Set(node.formats), covers: [...node.covers], subfolderCount
      })), total: nodes.length, ...page, hasMore: page.offset + page.limit < nodes.length
    };
  }

  folderNodes(roots: string[], currentPath: string, sort: LibrarySort = "title", sortAscending = true) {
    return this.folderPage(roots, currentPath, 0, Number.MAX_SAFE_INTEGER, sort, sortAscending).items;
  }

  private sortedIdsForGroup(facet: LibraryCategoryFacet, group: CachedCategoryGroup, scope: LibraryQueryScope, locale: string) {
    const cacheKey = `${facet}|${group.key}|${scope.sort || "title"}|${scope.sortAscending === false ? "desc" : "asc"}|${locale}`;
    const cached = this.sortedGroupIds.get(cacheKey);
    if (cached) return cached;
    const ids = [...group.ids].sort((leftId, rightId) => {
      const left = this.byMediaId.get(leftId), right = this.byMediaId.get(rightId);
      return left && right ? compareTracks(left, right, scope, locale) : 0;
    });
    this.sortedGroupIds.set(cacheKey, ids);
    return ids;
  }

  // A group's ids are what "add album/artist to queue" enqueues, so they always
  // follow album order (disc, then track number), whatever the list is sorted by.
  categoryPage(facet: LibraryCategoryFacet, search: string, _sortScope: LibraryQueryScope, locale: string, offset = 0, limit = 100): LibraryPage<LibraryCategoryGroup> {
    const albumOrder: LibraryQueryScope = { sort: "track", sortAscending: true };
    const normalizedSearch = normalize(search);
    const source = facet === "艺术家" ? this.artistGroups : this.albumGroups;
    const groups = [...source.values()].filter(group => !normalizedSearch || group.searchText.includes(normalizedSearch))
      .sort((left, right) => right.ids.length - left.ids.length || left.name.localeCompare(right.name, locale));
    const page = clampPage(groups.length, offset, limit);
    return {
      items: groups.slice(page.offset, page.offset + page.limit).map(group => ({
        key: group.key, name: group.name, count: group.ids.length,
        ids: [...this.sortedIdsForGroup(facet, group, albumOrder, locale)], artists: new Set(group.artists), albums: new Set(group.albums),
        formats: new Set(group.formats), covers: [...group.covers]
      })), total: groups.length, ...page, hasMore: page.offset + page.limit < groups.length
    };
  }

  categoryGroups(facet: LibraryCategoryFacet, search: string, sortScope: LibraryQueryScope, locale: string) {
    return this.categoryPage(facet, search, sortScope, locale, 0, Number.MAX_SAFE_INTEGER).items;
  }
}

// Track arrays from the store are immutable snapshots: a new scan or edit
// produces a new array. An index built for one array therefore stays valid
// for as long as that array is the input, so re-opening the library page can
// reuse it instead of rebuilding (previously ~0.7 s on every visit).
const canonicalIndexes = new WeakMap<Track[], { cache: LibraryDerivedIndexSnapshot | null; revision: number; index: LibraryIndex }>();
const hiddenIndexes = new WeakMap<LibraryIndex, { key: string; index: LibraryIndex }>();

export function reusableLibraryIndex(tracks: Track[], cache: LibraryDerivedIndexSnapshot | null, revision: number) {
  const reused = canonicalIndexes.get(tracks);
  if (reused && reused.cache === cache && reused.revision === revision) return reused.index;
  const index = new LibraryIndex(tracks, cache, revision);
  canonicalIndexes.set(tracks, { cache, revision, index });
  return index;
}

/** Index without tracks under protected folders, reused per canonical index and folder set. */
export function reusableHiddenFolderIndex(canonical: LibraryIndex, hiddenFolders: string[], isHidden: (track: Track) => boolean) {
  const key = hiddenFolders.join("\u0000");
  const reused = hiddenIndexes.get(canonical);
  if (reused && reused.key === key) return reused.index;
  const index = new LibraryIndex(canonical.tracks.filter(track => !isHidden(track)), null, canonical.libraryRevision);
  hiddenIndexes.set(canonical, { key, index });
  return index;
}

export const trackMediaId = mediaIdOf;
export const trackArtistIds = artistIdsOf;
export const trackAlbumId = albumIdOf;
