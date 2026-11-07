import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PluginDirectory, PluginDirectorySource, PluginDirectoryState } from "./pluginDomain";

const DIRECTORY_SCHEMA_VERSION = 1;

interface PersistedDirectory {
  path: string;
  source: PluginDirectorySource;
  enabled: boolean;
}

interface PersistedDirectoryFile {
  schemaVersion: number;
  directories: PersistedDirectory[];
}

export interface DirectoryScanOutcome {
  normalizedPath: string;
  state: PluginDirectoryState;
  candidateModuleCount: number;
  acceptedPluginCount: number;
  message?: string;
}

export function normalizePluginDirectoryPath(input: string) {
  if (!path.isAbsolute(input)) throw new Error("插件目录必须是绝对路径");
  let resolved = path.normalize(path.resolve(input));
  const root = path.parse(resolved).root;
  if (resolved !== root) resolved = resolved.replace(/[\\/]+$/, "");
  const normalizedPath = process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
  return { path: resolved, normalizedPath };
}

function directoryId(normalizedPath: string) {
  return crypto.createHash("sha256").update(normalizedPath).digest("hex").slice(0, 24);
}

function makeDirectory(input: string, source: PluginDirectorySource, enabled: boolean): PluginDirectory {
  const normalized = normalizePluginDirectoryPath(input);
  return {
    id: directoryId(normalized.normalizedPath),
    path: normalized.path,
    normalizedPath: normalized.normalizedPath,
    source,
    enabled,
    state: "not-scanned",
    candidateModuleCount: 0,
    acceptedPluginCount: 0
  };
}

export class PluginDirectoryStore {
  private directories: PluginDirectory[];

  constructor(private readonly filePath: string, standardPaths: string[]) {
    const persisted = this.readPersisted();
    const byPath = new Map<string, PluginDirectory>();
    for (const entry of persisted) {
      try {
        const directory = makeDirectory(entry.path, entry.source, entry.enabled);
        byPath.set(directory.normalizedPath, directory);
      } catch { /* Ignore obsolete relative or malformed entries. */ }
    }
    for (const standardPath of standardPaths) {
      try {
        const standard = makeDirectory(standardPath, "standard", true);
        const previous = byPath.get(standard.normalizedPath);
        byPath.set(standard.normalizedPath, { ...standard, enabled: previous?.enabled ?? true });
      } catch { /* Environment variables can contain malformed paths. */ }
    }
    this.directories = [...byPath.values()].sort((left, right) =>
      Number(left.source === "user") - Number(right.source === "user") || left.path.localeCompare(right.path)
    );
    this.persist();
  }

  list() {
    return this.directories.map(directory => ({ ...directory }));
  }

  importUserDirectories(paths: string[]) {
    let changed = false;
    for (const input of paths) {
      try {
        const candidate = makeDirectory(input, "user", true);
        const existing = this.directories.find(directory => directory.normalizedPath === candidate.normalizedPath);
        if (existing) {
          if (!existing.enabled) { existing.enabled = true; changed = true; }
          continue;
        }
        this.directories.push(candidate);
        changed = true;
      } catch { /* Legacy renderer state may contain stale values. */ }
    }
    if (changed) this.persist();
    return this.list();
  }

  addUserDirectory(input: string) {
    const candidate = makeDirectory(input, "user", true);
    const existing = this.directories.find(directory => directory.normalizedPath === candidate.normalizedPath);
    if (existing) {
      existing.enabled = true;
      this.persist();
      return { directory: { ...existing }, added: false };
    }
    this.directories.push(candidate);
    this.persist();
    return { directory: { ...candidate }, added: true };
  }

  removeDirectory(id: string) {
    const existing = this.directories.find(directory => directory.id === id);
    if (!existing || existing.source === "standard") return false;
    this.directories = this.directories.filter(directory => directory.id !== id);
    this.persist();
    return true;
  }

  setEnabled(id: string, enabled: boolean) {
    const existing = this.directories.find(directory => directory.id === id);
    if (!existing) return false;
    existing.enabled = enabled;
    existing.state = "not-scanned";
    existing.candidateModuleCount = 0;
    existing.acceptedPluginCount = 0;
    delete existing.message;
    this.persist();
    return true;
  }

  applyScanOutcomes(outcomes: DirectoryScanOutcome[]) {
    const byPath = new Map(outcomes.map(outcome => [outcome.normalizedPath, outcome]));
    for (const directory of this.directories) {
      const outcome = byPath.get(directory.normalizedPath);
      if (!outcome) continue;
      directory.state = outcome.state;
      directory.candidateModuleCount = outcome.candidateModuleCount;
      directory.acceptedPluginCount = outcome.acceptedPluginCount;
      if (outcome.message) directory.message = outcome.message;
      else delete directory.message;
    }
    return this.list();
  }

  private readPersisted(): PersistedDirectory[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as PersistedDirectoryFile;
      if (parsed.schemaVersion !== DIRECTORY_SCHEMA_VERSION || !Array.isArray(parsed.directories)) return [];
      return parsed.directories;
    } catch { return []; }
  }

  private persist() {
    const payload: PersistedDirectoryFile = {
      schemaVersion: DIRECTORY_SCHEMA_VERSION,
      directories: this.directories.map(({ path: directoryPath, source, enabled }) => ({ path: directoryPath, source, enabled }))
    };
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(payload, null, 2));
      fs.renameSync(temporary, this.filePath);
    } catch { /* Directory preferences must never prevent player startup. */ }
  }
}
