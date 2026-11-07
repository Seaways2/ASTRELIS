import crypto from "node:crypto";
import path from "node:path";
import type {
  Album,
  Artist,
  ArtistReference,
  LegacyLibraryPayload,
  LegacyTrackRecord,
  LibraryPayloadV2,
  LibraryRoot,
  TrackRecord,
  TrackTags
} from "../types";

const unknownArtist = new Set(["", "未知艺术家", "unknown artist", "本地音频"]);
const unknownAlbum = new Set(["", "未分类专辑", "未识别专辑", "unknown album"]);
const unknownGenre = new Set(["", "未分类", "unknown genre"]);

export function normalizeDomainText(value?: string) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function known(value: string | undefined, unknown: Set<string>) {
  const normalized = normalizeDomainText(value);
  return normalized && !unknown.has(normalized) ? String(value).trim() : undefined;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function optionalFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function digest(namespace: string, value: string) {
  return crypto.createHash("sha256").update(`${namespace}:${value}`).digest("hex");
}

function rootId(rootPath: string) {
  const canonical = path.resolve(rootPath).replace(/\//g, "\\").replace(/\\+$/, "").toLocaleLowerCase();
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export function artistReference(name: string): ArtistReference {
  const normalizedName = normalizeDomainText(name);
  return { artistId: digest("artist", normalizedName), name: name.trim() };
}

export function albumIdentity(title: string, albumArtist: string | undefined, compilation = false) {
  return digest("album", `${compilation ? "compilation" : normalizeDomainText(albumArtist)}:${normalizeDomainText(title)}`);
}

function owningRoot(sourcePath: string, folders: string[]) {
  const canonical = path.resolve(sourcePath).replace(/\//g, "\\").toLocaleLowerCase();
  return [...folders]
    .map(folder => ({ folder, canonical: path.resolve(folder).replace(/\//g, "\\").replace(/\\+$/, "").toLocaleLowerCase() }))
    .filter(root => canonical === root.canonical || canonical.startsWith(root.canonical + "\\"))
    .sort((left, right) => right.canonical.length - left.canonical.length)[0]?.folder || path.dirname(sourcePath);
}

export interface DomainTrackInput {
  track: LegacyTrackRecord;
  folders: string[];
  fingerprint?: string;
  mtimeMs?: number;
  artistNames?: string[];
  albumArtist?: string;
  genres?: string[];
  trackNumber?: number;
  discNumber?: number;
  compilation?: boolean;
}

export function toTrackRecord(input: DomainTrackInput): TrackRecord {
  const sourcePath = input.track.sourcePath || input.track.nativePath || input.track.url;
  const duration = optionalFiniteNumber(input.track.duration);
  const year = optionalFiniteNumber(input.track.year);
  const rootPath = owningRoot(sourcePath, input.folders);
  const existingTags = input.track.tags;
  const artists = ((input.artistNames || existingTags?.artists.map(artist => artist.name))
    ?.map(name => known(name, unknownArtist)).filter((name): name is string => Boolean(name))
    || [known(input.track.artist, unknownArtist)].filter((name): name is string => Boolean(name)))
    .filter((name, index, values) => values.findIndex(candidate => normalizeDomainText(candidate) === normalizeDomainText(name)) === index)
    .map(artistReference);
  const album = known(input.track.album, unknownAlbum);
  const albumArtist = known(input.albumArtist || existingTags?.albumArtist, unknownArtist);
  const genres = (input.genres || existingTags?.genres || [input.track.genre || ""])
    .map(genre => known(genre, unknownGenre))
    .filter((genre): genre is string => Boolean(genre));
  const tags: TrackTags = {
    title: known(input.track.name, new Set([""])),
    artists,
    album,
    albumArtist,
    genres,
    year,
    trackNumber: input.trackNumber ?? existingTags?.trackNumber,
    discNumber: input.discNumber ?? existingTags?.discNumber,
    compilation: input.compilation ?? existingTags?.compilation
  };
  const fingerprint = input.fingerprint || input.track.file?.fingerprint || digest("legacy-fingerprint", JSON.stringify({
    size: input.track.size,
    duration: duration ? Math.round(duration * 10) : undefined,
    title: normalizeDomainText(tags.title),
    artists: artists.map(artist => artist.artistId),
    album: normalizeDomainText(album)
  }));
  const mediaId = input.track.mediaId || digest("media", fingerprint);
  const resolvedAlbumId = album ? albumIdentity(album, albumArtist || artists[0]?.name, tags.compilation) : undefined;
  const canonicalPath = path.resolve(sourcePath).replace(/\//g, "\\");
  return {
    ...input.track,
    id: mediaId,
    mediaId,
    albumId: input.track.albumId || resolvedAlbumId,
    coverUrl: optionalString(input.track.coverUrl),
    nativePath: optionalString(input.track.nativePath),
    sourcePath,
    duration,
    year,
    genre: optionalString(input.track.genre),
    folder: optionalString(input.track.folder) || path.dirname(sourcePath),
    location: { rootId: rootId(rootPath), sourcePath, canonicalPath },
    file: { size: input.track.size, mtimeMs: input.mtimeMs ?? input.track.file?.mtimeMs ?? 0, fingerprint },
    tags
  };
}

export function disambiguateMediaIds<T extends TrackRecord>(tracks: T[]): T[] {
  const counts = new Map<string, number>();
  for (const track of tracks) counts.set(track.mediaId, (counts.get(track.mediaId) || 0) + 1);
  const occurrences = new Map<string, number>();
  return tracks.map(track => {
    if ((counts.get(track.mediaId) || 0) < 2) return track;
    const locationKey = track.location.canonicalPath.replace(/\//g, "\\").toLocaleLowerCase();
    const occurrenceKey = `${track.mediaId}:${locationKey}`;
    const occurrence = occurrences.get(occurrenceKey) || 0;
    occurrences.set(occurrenceKey, occurrence + 1);
    const mediaId = digest("media-instance", `${occurrenceKey}:${occurrence}`);
    return { ...track, id: mediaId, mediaId };
  });
}

export function buildDomainEntities(tracks: TrackRecord[]) {
  const artists = new Map<string, Artist>();
  const albums = new Map<string, Album>();
  for (const track of tracks) {
    for (const artist of track.tags.artists) {
      if (!artists.has(artist.artistId)) artists.set(artist.artistId, {
        artistId: artist.artistId,
        name: artist.name,
        normalizedName: normalizeDomainText(artist.name)
      });
    }
    const albumArtistName = track.tags.albumArtist || track.tags.artists[0]?.name;
    if (track.tags.albumArtist) {
      const albumArtist = artistReference(track.tags.albumArtist);
      if (!artists.has(albumArtist.artistId)) artists.set(albumArtist.artistId, {
        artistId: albumArtist.artistId,
        name: albumArtist.name,
        normalizedName: normalizeDomainText(albumArtist.name)
      });
    }
    if (track.tags.album) {
      const albumArtistId = albumArtistName ? artistReference(albumArtistName).artistId : undefined;
      const albumId = albumIdentity(track.tags.album, albumArtistName, track.tags.compilation);
      if (!albums.has(albumId)) albums.set(albumId, {
        albumId,
        title: track.tags.album,
        albumArtistId,
        compilation: track.tags.compilation
      });
    }
  }
  return { artists: [...artists.values()], albums: [...albums.values()] };
}

export function upgradeLibraryDomain(payload: LegacyLibraryPayload & Partial<LibraryPayloadV2>): LibraryPayloadV2 {
  const folders = [...new Set(payload.folders.map(folder => folder.trim()).filter(Boolean))];
  const tracks = disambiguateMediaIds(payload.tracks.map(track => toTrackRecord({ track: track as LegacyTrackRecord, folders })));
  const roots: LibraryRoot[] = folders.map(rootPath => ({ rootId: rootId(rootPath), path: rootPath }));
  const entities = buildDomainEntities(tracks);
  return {
    schemaVersion: 2,
    domainVersion: 2,
    tracks,
    folders,
    roots,
    artists: entities.artists,
    albums: entities.albums,
    migration: payload.migration
  };
}
