import fs from "node:fs";
import path from "node:path";

/** Result code for a queued file that is no longer on disk (moved, renamed or deleted). */
export const SOURCE_MISSING = "SOURCE_MISSING";

/**
 * Whether an audio source is gone. Only "no such file" counts: an unreadable
 * drive or a permission error keeps its own, more useful message.
 */
export async function sourceIsMissing(source: string) {
  try {
    return !(await fs.promises.stat(source)).isFile();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR";
  }
}

/** The answer for a missing source: a plain message instead of the raw ENOENT. */
export function missingSourceResult(source: string) {
  return {
    ok: false as const,
    code: SOURCE_MISSING,
    error: `找不到音频文件「${path.basename(source)}」：它可能已被移动、重命名或删除。`
  };
}
