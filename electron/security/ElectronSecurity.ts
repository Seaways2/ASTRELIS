import fs from "node:fs";
import path from "node:path";

function canonical(input: string) {
  const resolved = path.resolve(input);
  try { return fs.realpathSync.native(resolved); }
  catch { return resolved; }
}

export function pathIsContained(candidate: string, root: string) {
  const relative = path.relative(canonical(root), canonical(candidate));
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

export function sameCanonicalPath(left: string, right: string) {
  return canonical(left) === canonical(right);
}

export class LocalMediaAccessPolicy {
  blocked?: (file: string) => boolean;
  private readonly roots = new Set<string>();
  private readonly applicationDirectories = new Set<string>();
  private readonly authorizedFiles = new Set<string>();

  registerRoot(rootPath: string) {
    if (path.isAbsolute(rootPath)) this.roots.add(canonical(rootPath));
  }

  isRegisteredRoot(rootPath: string) {
    return path.isAbsolute(rootPath) && this.roots.has(canonical(rootPath));
  }

  registerApplicationDirectory(directory: string) {
    if (path.isAbsolute(directory)) this.applicationDirectories.add(canonical(directory));
  }

  authorizeFile(filePath: string) {
    if (!path.isAbsolute(filePath) || this.isAllowed(filePath)) return;
    try {
      if (fs.statSync(filePath).isFile()) this.authorizedFiles.add(canonical(filePath));
    } catch { /* A missing file cannot be granted by an explicit-file capability. */ }
  }

  isAllowed(filePath: string) {
    if (typeof filePath !== "string" || !path.isAbsolute(filePath)) return false;
    if (this.blocked?.(filePath)) return false;
    const candidate = canonical(filePath);
    if (this.authorizedFiles.has(candidate)) return true;
    return [...this.roots, ...this.applicationDirectories].some(root => pathIsContained(candidate, root));
  }
}

export function safeExternalUrl(value: string) {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function sameOriginNavigation(value: string, allowedOrigin?: string) {
  if (!allowedOrigin) return false;
  try { return new URL(value).origin === new URL(allowedOrigin).origin; }
  catch { return false; }
}
