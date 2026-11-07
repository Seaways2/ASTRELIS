import fs from "node:fs";
import path from "node:path";

/**
 * Persists explicit single-file grants (dropped files, "open with", picked
 * videos) so a restored playback queue can still read files that live outside
 * the registered library roots after a restart.
 *
 * Only the main process writes this list, and only from grants it already
 * made; entries are re-validated by LocalMediaAccessPolicy.authorizeFile on
 * restore, so missing files drop out and folder protection still applies.
 */
export class AuthorizedFileStore {
  private files: string[] = [];
  private saveTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly filePath: string,
    private readonly limit = 2000,
    private readonly saveDelayMs = 500
  ) {}

  /** Reads persisted grants; a missing or damaged file yields an empty list. */
  load(): string[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as { version?: unknown; files?: unknown };
      const files = parsed.version === 1 && Array.isArray(parsed.files) ? parsed.files : [];
      this.files = files.filter((file): file is string => typeof file === "string" && path.isAbsolute(file)).slice(-this.limit);
    } catch {
      this.files = [];
    }
    return [...this.files];
  }

  /** Replaces the list with the grants that survived validation. */
  reset(files: string[]) {
    const next = [...new Set(files)].slice(-this.limit);
    const changed = next.length !== this.files.length || next.some((file, index) => file !== this.files[index]);
    this.files = next;
    if (changed) this.scheduleSave();
  }

  /** Records a new grant as the most recent entry. */
  record(file: string) {
    const key = file.toLocaleLowerCase();
    this.files = this.files.filter(existing => existing.toLocaleLowerCase() !== key);
    this.files.push(file);
    if (this.files.length > this.limit) this.files = this.files.slice(-this.limit);
    this.scheduleSave();
  }

  list() {
    return [...this.files];
  }

  /** Writes pending changes immediately (used on quit). */
  flush() {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.write();
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.write();
    }, this.saveDelayMs);
    this.saveTimer.unref?.();
  }

  private write() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, files: this.files }), "utf8");
      fs.renameSync(temporary, this.filePath);
    } catch {
      // Losing the grant list only means those files need to be opened again.
    }
  }
}
