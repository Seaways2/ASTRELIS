import fs from "node:fs";
import path from "node:path";

export interface SavedQueues {
  kind: "music" | "video";
  tracks: Array<Record<string, unknown> & { sourcePath: string }>;
  selection: Record<string, string>;
  bookmarks: Record<string, number>;
}

export const QUEUE_FILE = "queues-v1.json";
export const QUEUE_BACKUP_DIRECTORY = "queue-backups";
const MAX_TRACKS = 20_000;
const MAX_BYTES = 32 * 1024 * 1024;

/** Validates a queue snapshot sent by the renderer; returns null if malformed. */
export function parseSavedQueues(input: unknown): SavedQueues | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  if (!Array.isArray(value.tracks) || value.tracks.length > MAX_TRACKS) return null;
  const tracks = value.tracks.filter((track): track is SavedQueues["tracks"][number] =>
    Boolean(track) && typeof track === "object" && typeof (track as { sourcePath?: unknown }).sourcePath === "string"
    && ((track as { sourcePath: string }).sourcePath.length > 0) && ((track as { sourcePath: string }).sourcePath.length <= 4096));
  const record = <T>(source: unknown, accept: (item: unknown) => item is T) => {
    const result: Record<string, T> = {};
    if (source && typeof source === "object" && !Array.isArray(source))
      for (const [key, item] of Object.entries(source)) if (key.length <= 512 && accept(item)) result[key] = item;
    return result;
  };
  return {
    kind: value.kind === "video" ? "video" : "music",
    tracks,
    selection: record(value.selection, (item): item is string => typeof item === "string" && item.length <= 512),
    bookmarks: record(value.bookmarks, (item): item is number => typeof item === "number" && Number.isFinite(item) && item >= 0)
  };
}

/**
 * Main-owned persistence for the playback queues.
 *
 * The queue used to live only in the renderer's localStorage, where a single
 * bad write replaced it for good. Here every write is atomic, and whenever the
 * set of queued files changes the previous file is kept in a rotating backup,
 * so a queue that is accidentally emptied or replaced can be recovered.
 */
export class QueueStore {
  private pending: SavedQueues | null = null;
  private timer: NodeJS.Timeout | undefined;
  private writtenSignature: string | undefined;

  constructor(
    private readonly directory: string,
    private readonly options: { backups?: number; saveDelayMs?: number; now?: () => number } = {}
  ) {}

  get filePath() { return path.join(this.directory, QUEUE_FILE); }
  get backupDirectory() { return path.join(this.directory, QUEUE_BACKUP_DIRECTORY); }

  /** The saved queues, falling back to the newest readable backup. */
  load(): SavedQueues | null {
    if (this.pending) return this.pending;
    for (const file of [this.filePath, ...this.backupFiles()]) {
      const parsed = this.read(file);
      if (parsed) {
        if (file === this.filePath) this.writtenSignature = signature(parsed);
        return parsed;
      }
    }
    return null;
  }

  save(input: unknown): boolean {
    const parsed = parseSavedQueues(input);
    if (!parsed) return false;
    this.pending = parsed;
    if (!this.timer) {
      this.timer = setTimeout(() => { this.timer = undefined; this.flush(); }, this.options.saveDelayMs ?? 1000);
      this.timer.unref?.();
    }
    return true;
  }

  /** Writes a pending snapshot now (used on quit). */
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    const value = this.pending;
    if (!value) return;
    this.pending = null;
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > MAX_BYTES) return;
    try {
      fs.mkdirSync(this.directory, { recursive: true });
      const nextSignature = signature(value);
      if (this.writtenSignature === undefined) {
        const current = this.read(this.filePath);
        this.writtenSignature = current ? signature(current) : "";
      }
      // The queued files changed: keep the previous queue before replacing it.
      if (nextSignature !== this.writtenSignature && fs.existsSync(this.filePath)) this.backupCurrent();
      const temporary = `${this.filePath}.tmp`;
      fs.writeFileSync(temporary, text, "utf8");
      fs.renameSync(temporary, this.filePath);
      this.writtenSignature = nextSignature;
    } catch {
      // A failed write keeps the previous file and backups intact.
    }
  }

  backupFiles() {
    try {
      return fs.readdirSync(this.backupDirectory).filter(name => /^queues-\d+\.json$/.test(name)).sort().reverse()
        .map(name => path.join(this.backupDirectory, name));
    } catch { return []; }
  }

  private backupCurrent() {
    const current = this.read(this.filePath);
    if (!current || current.tracks.length === 0) return;
    fs.mkdirSync(this.backupDirectory, { recursive: true });
    const stamp = String(this.options.now?.() ?? Date.now()).padStart(15, "0");
    fs.copyFileSync(this.filePath, path.join(this.backupDirectory, `queues-${stamp}.json`));
    for (const stale of this.backupFiles().slice(this.options.backups ?? 10)) {
      try { fs.unlinkSync(stale); } catch { /* Pruning is best effort. */ }
    }
  }

  private read(file: string) {
    try { return parseSavedQueues(JSON.parse(fs.readFileSync(file, "utf8"))); }
    catch { return null; }
  }
}

const signature = (value: SavedQueues) => value.tracks.map(track => track.sourcePath.toLocaleLowerCase()).join("\n");
