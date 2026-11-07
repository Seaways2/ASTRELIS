import * as fs from "node:fs";
import * as path from "node:path";

const MAX_TRACKS = 500_000;
const MAX_GROUPS = 500_000;
const MAX_TEXT = 8192;

const plainObject = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const shortString = (value: unknown, max = MAX_TEXT): value is string => typeof value === "string" && value.length <= max;
const stringArray = (value: unknown, max = MAX_TRACKS) => Array.isArray(value) && value.length <= max && value.every(item => shortString(item));

function validGroup(value: unknown) {
  return plainObject(value) && shortString(value.key, 1024) && shortString(value.name, 2048)
    && stringArray(value.ids) && stringArray(value.artists, 4096) && stringArray(value.albums, 4096)
    && stringArray(value.formats, 256) && stringArray(value.covers, 8) && shortString(value.searchText, 16_384);
}

function validFolder(value: unknown) {
  return plainObject(value) && shortString(value.path, 4096) && stringArray(value.directIds)
    && stringArray(value.descendantIds) && stringArray(value.formats, 256) && stringArray(value.covers, 8);
}

export function validateLibraryDerivedIndex(value: unknown, expectedRevision: number) {
  if (!plainObject(value) || value.schemaVersion !== 1 || value.normalizationVersion !== 1
    || value.libraryRevision !== expectedRevision || !shortString(value.trackSignature, 256)) return false;
  if (!Array.isArray(value.searchTextEntries) || value.searchTextEntries.length > MAX_TRACKS
    || !value.searchTextEntries.every(entry => Array.isArray(entry) && entry.length === 2
      && shortString(entry[0], 1024) && shortString(entry[1], 32_768))) return false;
  if (!Array.isArray(value.artists) || value.artists.length > MAX_GROUPS || !value.artists.every(validGroup)) return false;
  if (!Array.isArray(value.albums) || value.albums.length > MAX_GROUPS || !value.albums.every(validGroup)) return false;
  if (!Array.isArray(value.folders) || value.folders.length > MAX_GROUPS || !value.folders.every(validFolder)) return false;
  const stats = value.stats;
  return plainObject(stats) && ["totalBytes", "hiRes", "artistCount", "albumCount"]
    .every(key => typeof stats[key] === "number" && Number.isFinite(stats[key]));
}

export class LibraryDerivedIndexCache {
  readonly cacheDirectory: string;
  readonly cachePath: string;

  constructor(storageDirectory: string) {
    const resolvedStorage = path.resolve(storageDirectory);
    this.cacheDirectory = path.join(resolvedStorage, "cache");
    this.cachePath = path.join(this.cacheDirectory, "derived-index-v1.json");
  }

  async load(expectedRevision: number): Promise<unknown | null> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return null;
    try {
      const parsed: unknown = JSON.parse(await fs.promises.readFile(this.cachePath, "utf8"));
      if (!validateLibraryDerivedIndex(parsed, expectedRevision)) throw new Error("derived index cache mismatch");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      try { await fs.promises.unlink(this.cachePath); } catch { /* Cache removal is best effort; the index remains rebuildable. */ }
      return null;
    }
  }

  async save(expectedRevision: number, snapshot: unknown) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0
      || !validateLibraryDerivedIndex(snapshot, expectedRevision)) return { ok: false };
    await fs.promises.mkdir(this.cacheDirectory, { recursive: true });
    const temporaryPath = path.join(this.cacheDirectory,
      `derived-index-v1.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
    try {
      await fs.promises.writeFile(temporaryPath, JSON.stringify(snapshot), { encoding: "utf8", flag: "wx" });
      await fs.promises.rename(temporaryPath, this.cachePath);
      return { ok: true };
    } catch {
      try { await fs.promises.unlink(temporaryPath); } catch { /* Temporary file may not exist. */ }
      return { ok: false };
    }
  }
}
