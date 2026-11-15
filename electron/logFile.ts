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
