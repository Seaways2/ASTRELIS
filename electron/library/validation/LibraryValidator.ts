import { validFilmMetadata } from "../media/TmdbClient";
import crypto from "node:crypto";
import path from "node:path";
import { LibraryOperationError } from "../errors";
import type {
  LegacyLibraryPayload,
  LibraryPayloadV2,
  PersistedLibraryRevision,
  StoredLibraryPayload
} from "../types";

const optionalStrings = ["coverUrl", "nativePath", "sourcePath", "genre", "folder", "videoInfo"] as const;
const optionalNumbers = ["duration", "year"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validLegacyTrack(value: unknown) {
  if (!isRecord(value)) return false;
  for (const field of ["id", "name", "artist", "album", "url", "format"] as const) {
    if (typeof value[field] !== "string") return false;
  }
  if (typeof value.size !== "number" || !Number.isFinite(value.size) || value.size < 0) return false;
  if (value.onlineMetadata !== undefined && !validFilmMetadata(value.onlineMetadata)) return false;
  if (value.coverLocked !== undefined && typeof value.coverLocked !== "boolean") return false;
  for (const field of optionalStrings) {
    if (value[field] !== undefined && value[field] !== null && typeof value[field] !== "string") return false;
  }
  for (const field of optionalNumbers) {
    if (value[field] !== undefined && value[field] !== null
      && (typeof value[field] !== "number" || !Number.isFinite(value[field]))) return false;
  }
  return true;
}

function validDomainTrack(value: unknown) {
  if (!isRecord(value) || typeof value.mediaId !== "string" || !/^[a-f0-9]{64}$/.test(value.mediaId)) return false;
  if (!isRecord(value.location) || typeof value.location.rootId !== "string"
    || typeof value.location.sourcePath !== "string" || typeof value.location.canonicalPath !== "string") return false;
  if (!isRecord(value.file) || typeof value.file.size !== "number" || typeof value.file.mtimeMs !== "number"
    || (value.file.fingerprint !== undefined && typeof value.file.fingerprint !== "string")) return false;
  if (!isRecord(value.tags) || !Array.isArray(value.tags.artists) || !Array.isArray(value.tags.genres)) return false;
  return value.tags.artists.every(artist => isRecord(artist)
      && typeof artist.artistId === "string" && typeof artist.name === "string")
    && value.tags.genres.every(genre => typeof genre === "string");
}

function absolutePath(value: unknown): value is string {
  return typeof value === "string" && (path.win32.isAbsolute(value) || path.posix.isAbsolute(value));
}

function canonicalPath(value: string) {
  const api = path.win32.isAbsolute(value) ? path.win32 : path.posix;
  const normalized = api.normalize(value);
  return (normalized === api.parse(normalized).root ? normalized : normalized.replace(/[\\/]+$/, "")).toLocaleLowerCase();
}

function containedPath(candidate: string, root: string) {
  const api = path.win32.isAbsolute(root) ? path.win32 : path.posix;
  const relative = api.relative(canonicalPath(root), canonicalPath(candidate));
  return relative === "" || (!relative.startsWith(".." + api.sep) && relative !== ".." && !api.isAbsolute(relative));
}

export function validateLegacyLibraryPayload(value: unknown): asserts value is LegacyLibraryPayload {
  if (!isRecord(value) || !Array.isArray(value.tracks) || !Array.isArray(value.folders)) {
    throw new LibraryOperationError("LIBRARY_INVALID_SCHEMA", "Library payload must contain tracks and folders arrays", false);
  }
  if (!value.folders.every(folder => typeof folder === "string")) {
    throw new LibraryOperationError("LIBRARY_INVALID_SCHEMA", "Library folders must be strings", false);
  }
  if (!value.tracks.every(validLegacyTrack)) {
    throw new LibraryOperationError("LIBRARY_INVALID_SCHEMA", "Library contains an invalid legacy Track", false);
  }
}

export function validateLibraryPayloadV2(value: unknown): asserts value is LibraryPayloadV2 {
  validateLegacyLibraryPayload(value);
  if (!isRecord(value) || value.schemaVersion !== 2) {
    throw new LibraryOperationError("LIBRARY_INVALID_SCHEMA", "Library payload schemaVersion must be 2", false);
  }
  if (value.migration !== undefined) {
    if (!isRecord(value.migration)
      || !["library-v1-to-v2", "legacy-localstorage-v1-to-v2"].includes(String(value.migration.migration))
      || typeof value.migration.sourceHash !== "string"
      || !/^[a-f0-9]{64}$/.test(value.migration.sourceHash)) {
      throw new LibraryOperationError("LIBRARY_INVALID_SCHEMA", "Library migration provenance is invalid", false);
    }
  }
  if (value.domainVersion !== undefined && value.domainVersion !== 2) {
    throw new LibraryOperationError("LIBRARY_INVALID_SCHEMA", "Library domainVersion is invalid", false);
  }
  if (value.domainVersion === 2) {
    if (!value.tracks.every(validDomainTrack) || !Array.isArray(value.roots)
      || !Array.isArray(value.artists) || !Array.isArray(value.albums)) {
      throw new LibraryOperationError("LIBRARY_INVALID_SCHEMA", "Library domain entities are invalid", false);
    }
    const roots = value.roots as unknown[];
    const artists = value.artists as unknown[];
    const albums = value.albums as unknown[];
    if (!roots.every(root => isRecord(root) && typeof root.rootId === "string" && /^[a-f0-9]{64}$/.test(root.rootId)
      && absolutePath(root.path))) {
      throw new LibraryOperationError("LIBRARY_INVALID_SCHEMA", "Library root entities are invalid", false);
    }
    if (!artists.every(artist => isRecord(artist) && typeof artist.artistId === "string" && /^[a-f0-9]{64}$/.test(artist.artistId)
      && typeof artist.name === "string" && Boolean(artist.name.trim())
      && typeof artist.normalizedName === "string" && Boolean(artist.normalizedName.trim()))) {
      throw new LibraryOperationError("LIBRARY_INVALID_SCHEMA", "Library artist entities are invalid", false);
    }
    if (!albums.every(album => isRecord(album) && typeof album.albumId === "string" && /^[a-f0-9]{64}$/.test(album.albumId)
      && typeof album.title === "string" && Boolean(album.title.trim())
      && (album.albumArtistId === undefined || (typeof album.albumArtistId === "string" && /^[a-f0-9]{64}$/.test(album.albumArtistId))))) {
      throw new LibraryOperationError("LIBRARY_INVALID_SCHEMA", "Library album entities are invalid", false);
    }
    const rootById = new Map(roots.map(root => [(root as Record<string, unknown>).rootId as string, (root as Record<string, unknown>).path as string]));
    const artistIds = new Set(artists.map(artist => (artist as Record<string, unknown>).artistId as string));
    const albumIds = new Set(albums.map(album => (album as Record<string, unknown>).albumId as string));
    const mediaIds = value.tracks.map(track => (track as Record<string, unknown>).mediaId as string);
    if (rootById.size !== roots.length || artistIds.size !== artists.length || albumIds.size !== albums.length
      || new Set(mediaIds).size !== mediaIds.length) {
      throw new LibraryOperationError("LIBRARY_INVALID_SCHEMA", "Library domain identities must be unique", false);
    }
    for (const album of albums as Array<Record<string, unknown>>) {
      if (album.albumArtistId !== undefined && !artistIds.has(album.albumArtistId as string))
        throw new LibraryOperationError("LIBRARY_INVALID_SCHEMA", "Album artist reference is invalid", false);
    }
    for (const track of value.tracks as Array<Record<string, unknown>>) {
      const location = track.location as Record<string, unknown>;
      const tags = track.tags as Record<string, unknown>;
      const file = track.file as Record<string, unknown>;
      const rootPath = rootById.get(location.rootId as string);
      if (track.id !== track.mediaId || !rootPath || !absolutePath(location.sourcePath) || !absolutePath(location.canonicalPath)
        || !containedPath(location.sourcePath, rootPath) || !containedPath(location.canonicalPath, rootPath)
        || !Number.isFinite(file.size) || Number(file.size) < 0 || !Number.isFinite(file.mtimeMs) || Number(file.mtimeMs) < 0) {
        throw new LibraryOperationError("LIBRARY_INVALID_SCHEMA", "Track location or file identity is invalid", false);
      }
      if ((track.albumId !== undefined && !albumIds.has(track.albumId as string))
        || !(tags.artists as Array<Record<string, unknown>>).every(artist => artistIds.has(artist.artistId as string))) {
        throw new LibraryOperationError("LIBRARY_INVALID_SCHEMA", "Track domain reference is invalid", false);
      }
    }
  }
}

export function validateStoredLibraryPayload(value: unknown): asserts value is StoredLibraryPayload {
  validateLegacyLibraryPayload(value);
  if (isRecord(value) && value.schemaVersion !== undefined) validateLibraryPayloadV2(value);
}

function checksumInput(revision: Omit<PersistedLibraryRevision, "checksum">) {
  return JSON.stringify({
    formatVersion: revision.formatVersion,
    revision: revision.revision,
    createdAt: revision.createdAt,
    requestId: revision.requestId,
    payload: revision.payload
  });
}

export function revisionChecksum(revision: Omit<PersistedLibraryRevision, "checksum">) {
  return crypto.createHash("sha256").update(checksumInput(revision)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().filter(key => value[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function payloadChecksum(payload: StoredLibraryPayload) {
  return crypto.createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

export function validatePersistedRevision(value: unknown, expectedRevision?: number): PersistedLibraryRevision {
  if (!isRecord(value) || value.formatVersion !== 1 || !Number.isSafeInteger(value.revision) || Number(value.revision) <= 0
    || typeof value.createdAt !== "string" || typeof value.checksum !== "string"
    || (value.requestId !== undefined && typeof value.requestId !== "string")) {
    throw new LibraryOperationError("LIBRARY_INVALID_SCHEMA", "Library revision envelope is invalid", false);
  }
  if (expectedRevision !== undefined && value.revision !== expectedRevision) {
    throw new LibraryOperationError("LIBRARY_INVALID_SCHEMA", "Library revision does not match its filename", false);
  }
  validateStoredLibraryPayload(value.payload);
  const revision = value as unknown as PersistedLibraryRevision;
  const { checksum, ...unsigned } = revision;
  if (checksum !== revisionChecksum(unsigned)) {
    throw new LibraryOperationError("LIBRARY_SNAPSHOT_CORRUPT", "Library revision checksum does not match", true);
  }
  return revision;
}
