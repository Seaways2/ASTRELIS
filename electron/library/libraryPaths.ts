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
