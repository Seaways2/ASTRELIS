import fs from "node:fs";
import path from "node:path";

/**
 * A library root as it is stored and shown. Trailing separators are dropped,
 * except on a drive root: "E:\" must stay "E:\", because "E:" is a
 * drive-relative path (it resolves to that drive's current directory), which
 * the payload validator rejects and the access policy ignores.
 */
export function libraryRootPath(value: string) {
  const resolved = path.resolve(value.trim()).replace(/\//g, "\\");
  const trimmed = resolved.replace(/\\+$/, "");
  return /^[a-z]:$/i.test(trimmed) ? `${trimmed}\\` : trimmed;
}

/**
 * Comparison key for a path or root: no trailing separator, lower case, so a
 * child test is `key === root || key.startsWith(root + "\\")`, drive roots
 * included ("e:" contains "e:\music"). Never resolve a key again.
 */
export function libraryPathKey(value: string) {
  return libraryRootPath(value).replace(/\\+$/, "").toLocaleLowerCase();
}

export function libraryPathWithin(candidateKey: string, rootKey: string) {
  return candidateKey === rootKey || candidateKey.startsWith(rootKey + "\\");
}

/**
 * True only when the scan of `parent` is known to cover the folder `nested`
 * below it: every level between them is a plain folder, or a level is
 * missing although the levels above it were read (nothing there to keep).
 * A junction or symbolic link at any level points somewhere else, which the
 * parent's scan never enters. When the parent cannot be read (drive unplugged,
 * network share offline) or a level fails otherwise, nothing is known, so the
 * answer is false: a registered root is never dropped on a guess.
 */
export function libraryRootCovers(parent: string, nested: string) {
  const parentRoot = libraryRootPath(parent), nestedRoot = libraryRootPath(nested);
  if (!libraryPathWithin(libraryPathKey(nestedRoot), libraryPathKey(parentRoot))) return false;
  // stat, not lstat: a parent that is itself a link must reach its target.
  try { if (!fs.statSync(parentRoot).isDirectory()) return false; }
  catch { return false; }
  let current = parentRoot;
  for (const segment of path.relative(parentRoot, nestedRoot).split(/[\\/]+/).filter(Boolean)) {
    current = path.join(current, segment);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === "ENOENT" || code === "ENOTDIR";
    }
    if (stat.isSymbolicLink()) return false;
    if (!stat.isDirectory()) return true;
  }
  return true;
}

/**
 * A library folder sent by the renderer. A bare drive ("E:") can only mean
 * that drive's root: older renderers trimmed the separator off "E:\", and the
 * drive-relative reading would fail validation or point somewhere else.
 */
export function libraryFolderArgument(value: unknown) {
  return typeof value === "string" && /^\s*[a-z]:\s*$/i.test(value) ? `${value.trim()}\\` : value;
}

/**
 * True when a rescan request names exactly the registered roots. The renderer
 * folds nested folders into their parent, so a registered root that is a
 * junction inside another one may be missing from the request: it is covered
 * by its parent there, and the rescan still scans every registered root.
 */
export function rescanCoversRegisteredRoots(requested: string[], registered: string[],
  same: (left: string, right: string) => boolean = (left, right) => libraryPathKey(left) === libraryPathKey(right)) {
  if (!requested.length || !registered.length) return false;
  if (requested.some(root => !registered.some(known => same(root, known)))) return false;
  const requestedKeys = requested.map(libraryPathKey);
  return registered.every(known => requested.some(root => same(root, known))
    || requestedKeys.some(key => libraryPathWithin(libraryPathKey(known), key)));
}
