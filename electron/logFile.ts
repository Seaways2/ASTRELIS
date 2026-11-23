import fs from "node:fs";
import path from "node:path";

/**
 * The application log: one line per entry, appended synchronously so the last
 * lines before a crash are on disk, and rotated by size so it no longer grows
 * without bound (a long-running install had reached 7 MB). `<name>.log` is
 * the current file; `<name>.1.log` … `<name>.<keep>.log` hold older entries.
 */
export class RotatingLogFile {
  /** Bytes in the current file; -1 until the first write looks it up. */
  private size = -1;

  constructor(
    readonly directory: string,
    private readonly maxBytes = 5 * 1024 * 1024,
    private readonly keep = 2,
    private readonly name = "auralis"
  ) {}

  private path(index = 0) {
    return path.join(this.directory, index ? `${this.name}.${index}.log` : `${this.name}.log`);
  }

  write(line: string) {
    if (this.size < 0) {
      fs.mkdirSync(this.directory, { recursive: true });
      try { this.size = fs.statSync(this.path()).size; } catch { this.size = 0; }
    }
    const bytes = Buffer.byteLength(line);
    if (this.size > 0 && this.size + bytes > this.maxBytes) this.rotate();
    fs.appendFileSync(this.path(), line);
    this.size += bytes;
  }

  private rotate() {
    try {
      fs.rmSync(this.path(this.keep), { force: true });
      for (let index = this.keep - 1; index >= 0; index--)
        if (fs.existsSync(this.path(index))) fs.renameSync(this.path(index), this.path(index + 1));
    } catch { /* A locked backup only delays rotation; the current file keeps growing. */ }
    try { this.size = fs.statSync(this.path()).size; } catch { this.size = 0; }
  }
}

/** Marks a renderer console line that reports a file the player could not play. */
export const PLAYBACK_CONSOLE_PREFIX = "[playback]";

/**
 * The renderer has no log channel of its own; it reports playback failures on
 * its console as "[playback] cannot play <path>: MediaError <code> <message>".
 * This forwards those lines, and nothing else from the console, to the log:
 * one line each, cut to a sane length, and at most `limit` per interval so a
 * queue of broken files skipping one after another cannot flood the file. The
 * number left out is written with the next line that gets through, or on a
 * line of its own when the interval ends, so a burst that is followed by
 * nothing still says how many failures it had.
 */
export class RendererPlaybackLog {
  private intervalStart = Number.NEGATIVE_INFINITY;
  private written = 0;
  private dropped = 0;
  private summaryScheduled = false;

  constructor(
    private readonly write: (message: string) => void,
    private readonly limit = 3,
    private readonly intervalMs = 1000,
    private readonly now: () => number = Date.now,
    private readonly maxLength = 1000,
    // The timer never keeps the process alive; quitting within the interval only loses the count.
    private readonly schedule: (run: () => void, delayMs: number) => void =
      (run, delayMs) => { setTimeout(run, delayMs).unref?.(); }
  ) {}

  /** Writes the number of lines left out, if any, on a line of its own. */
  flush() {
    if (!this.dropped) return;
    const count = this.dropped;
    this.dropped = 0;
    this.write(`${PLAYBACK_CONSOLE_PREFIX} ${count} more playback failure line(s) were not logged`);
  }

  /** Returns whether the message was written. */
  accept(message: unknown) {
    if (typeof message !== "string" || !message.startsWith(PLAYBACK_CONSOLE_PREFIX)) return false;
    const time = this.now();
    if (time - this.intervalStart >= this.intervalMs) {
      this.intervalStart = time;
      this.written = 0;
    }
    if (this.written >= this.limit) {
      this.dropped++;
      if (!this.summaryScheduled) {
        this.summaryScheduled = true;
        this.schedule(() => { this.summaryScheduled = false; this.flush(); }, Math.max(0, this.intervalStart + this.intervalMs - time));
      }
      return false;
    }
    this.written++;
    let line = message.replace(/[\r\n]+/g, " ").trim();
    if (line.length > this.maxLength) line = `${line.slice(0, this.maxLength)}…`;
    if (this.dropped) {
      line += ` (${this.dropped} more playback failure line(s) were not logged)`;
      this.dropped = 0;
    }
    this.write(line);
    return true;
  }
}
