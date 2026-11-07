import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LibraryOperationError } from "../errors";
import { upgradeLibraryDomain } from "../domain/LibraryDomain";
import type {
  LegacyLibraryImportResult,
  LegacyLibraryPayload,
  LibraryCommandMeta,
  LibraryLoadResult,
  LibraryMigrationFailpoint,
  LibraryMigrationMarker,
  LibraryPayloadV2,
  LibraryRepository,
  LibrarySnapshot
} from "../types";
import { validateLegacyLibraryPayload, validateLibraryPayloadV2 } from "../validation/LibraryValidator";

export interface LibraryMigratorOptions {
  storageDirectory: string;
  legacyPath?: string;
  failpoint?: (point: LibraryMigrationFailpoint) => void | Promise<void>;
}

const FILE_MIGRATION = "library-v1-to-v2" as const;
const LOCAL_STORAGE_MIGRATION = "legacy-localstorage-v1-to-v2" as const;

function stablePayload(payload: LegacyLibraryPayload) {
  return JSON.stringify({ tracks: payload.tracks, folders: payload.folders });
}

function hashBytes(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function trackIdentity(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const track = value as Record<string, unknown>;
  return String(track.sourcePath || track.nativePath || track.id || "").trim().replace(/\//g, "\\").toLowerCase();
}

function mergeLegacyPayload(current: LibrarySnapshot, incoming: LegacyLibraryPayload): LibraryPayloadV2 {
  const tracks = [...current.tracks];
  const identities = new Set(tracks.map(trackIdentity).filter(Boolean));
  for (const track of incoming.tracks) {
    const identity = trackIdentity(track);
    if (!identity || identities.has(identity)) continue;
    identities.add(identity);
    tracks.push(track);
  }
  const folders = [...new Set([...current.folders, ...incoming.folders].map(folder => folder.trim()).filter(Boolean))];
  return { schemaVersion: 2, tracks, folders, migration: current.migration };
}

export class LibraryMigrator {
  readonly migrationsDirectory: string;
  private readonly legacyPath?: string;
  private readonly failpoint?: LibraryMigratorOptions["failpoint"];

  constructor(
    private readonly repository: LibraryRepository,
    options: LibraryMigratorOptions
  ) {
    this.migrationsDirectory = path.join(path.resolve(options.storageDirectory), "migrations");
    this.legacyPath = options.legacyPath ? path.resolve(options.legacyPath) : undefined;
    this.failpoint = options.failpoint;
  }

  private markerPath(migration: LibraryMigrationMarker["migration"]) {
    return path.join(this.migrationsDirectory, `${migration}.json`);
  }

  private async trigger(point: LibraryMigrationFailpoint) {
    await this.failpoint?.(point);
    if (process.env.AURALIS_LIBRARY_FAILPOINT === point) {
      throw new Error(`Simulated library migration interruption at ${point}`);
    }
  }

  private async readMarker(migration: LibraryMigrationMarker["migration"]) {
    try {
      const value = JSON.parse(await fs.promises.readFile(this.markerPath(migration), "utf8")) as Partial<LibraryMigrationMarker>;
      if (value.migration !== migration || typeof value.sourceHash !== "string"
        || !Number.isSafeInteger(value.targetRevision) || Number(value.targetRevision) <= 0 || value.completed !== true) return undefined;
      return value as LibraryMigrationMarker;
    } catch {
      return undefined;
    }
  }

  private async writeMarker(marker: LibraryMigrationMarker) {
    await fs.promises.mkdir(this.migrationsDirectory, { recursive: true });
    const destination = this.markerPath(marker.migration);
    const temporary = `${destination}.tmp.${crypto.randomUUID()}`;
    const handle = await fs.promises.open(temporary, "wx");
    try {
      await handle.writeFile(JSON.stringify(marker), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(temporary, destination);
    const verified = await this.readMarker(marker.migration);
    if (!verified || verified.sourceHash !== marker.sourceHash || verified.targetRevision !== marker.targetRevision) {
      throw new LibraryOperationError("LIBRARY_MIGRATION_FAILED", "Migration marker read-back validation failed", true);
    }
  }

  private async legacySourceHash(snapshot: LibrarySnapshot) {
    if (snapshot.revision === 0 && this.legacyPath) {
      try {
        return hashBytes(await fs.promises.readFile(this.legacyPath));
      } catch {
        // The validated in-memory snapshot remains a safe deterministic source if the file moved after load.
      }
    }
    return hashBytes(stablePayload(snapshot));
  }

  private async completeMarker(
    migration: LibraryMigrationMarker["migration"],
    sourceHash: string,
    targetRevision: number
  ) {
    const existing = await this.readMarker(migration);
    if (existing?.completed && existing.sourceHash === sourceHash) return;
    await this.trigger("BEFORE_MIGRATION_MARKER");
    await this.writeMarker({ migration, sourceHash, targetRevision, completed: true });
    await this.trigger("AFTER_MIGRATION_MARKER");
  }

  async ensureMigrated(): Promise<LibraryLoadResult> {
    try {
      const loaded = await this.repository.loadLatestValid();
      if (loaded.status === "empty" || loaded.status === "error" || !loaded.snapshot) return loaded;
      const source = loaded.snapshot;

      if (source.schemaVersion === 2 && source.domainVersion === 2) {
        if (source.migration?.migration === FILE_MIGRATION) {
          await this.completeMarker(FILE_MIGRATION, source.migration.sourceHash, source.revision);
        }
        await this.trigger("BEFORE_IPC_ACK");
        return await this.repository.loadLatestValid();
      }

      if (source.schemaVersion === 2) {
        const upgraded = upgradeLibraryDomain({
          schemaVersion: 2,
          tracks: source.tracks,
          folders: source.folders,
          migration: source.migration
        });
        const sourceHash = hashBytes(stablePayload(source));
        const committed = await this.repository.commit(upgraded, {
          expectedRevision: source.revision,
          requestId: `migration:library-domain-v2:${sourceHash}`
        });
        if (committed.status === "conflict") {
          throw new LibraryOperationError("LIBRARY_MIGRATION_FAILED", "Library changed during domain migration", true);
        }
        const verified = await this.repository.loadLatestValid();
        if (!verified.snapshot || verified.snapshot.domainVersion !== 2) {
          throw new LibraryOperationError("LIBRARY_MIGRATION_FAILED", "Domain migration failed read-back validation", true);
        }
        return verified;
      }

      await this.trigger("AFTER_LEGACY_READ");
      const sourceHash = await this.legacySourceHash(source);
      const transformed = upgradeLibraryDomain({
        schemaVersion: 2,
        tracks: source.tracks,
        folders: source.folders,
        migration: { migration: FILE_MIGRATION, sourceHash }
      });
      validateLibraryPayloadV2(transformed);
      await this.trigger("AFTER_TRANSFORM");

      const committed = await this.repository.commit(transformed, {
        expectedRevision: source.revision,
        requestId: `migration:${FILE_MIGRATION}:${sourceHash}`
      });
      if (committed.status === "conflict") {
        throw new LibraryOperationError("LIBRARY_MIGRATION_FAILED", "Library changed during v2 migration", true);
      }
      await this.trigger("AFTER_REVISION_COMMIT");
      const verified = await this.repository.loadLatestValid();
      if (!verified.snapshot || verified.snapshot.schemaVersion !== 2
        || verified.snapshot.migration?.sourceHash !== sourceHash) {
        throw new LibraryOperationError("LIBRARY_MIGRATION_FAILED", "Migrated revision failed read-back validation", true);
      }
      await this.completeMarker(FILE_MIGRATION, sourceHash, verified.snapshot.revision);
      await this.trigger("BEFORE_IPC_ACK");
      return await this.repository.loadLatestValid();
    } catch (error) {
      if (error instanceof LibraryOperationError && error.libraryError.code === "LIBRARY_MIGRATION_FAILED") throw error;
      throw new LibraryOperationError(
        "LIBRARY_MIGRATION_FAILED",
        error instanceof Error ? error.message : "Library migration failed",
        true
      );
    }
  }

  async importLegacyState(payload: LegacyLibraryPayload, meta: LibraryCommandMeta): Promise<LegacyLibraryImportResult> {
    validateLegacyLibraryPayload(payload);
    if (!meta?.requestId?.trim()) {
      throw new LibraryOperationError("LIBRARY_INVALID_SCHEMA", "Legacy import requires requestId", false);
    }
    if (!payload.tracks.length && !payload.folders.length) {
      const loaded = await this.ensureMigrated();
      return {
        status: "noop",
        revision: loaded.snapshot?.revision || 0,
        requestId: meta.requestId,
        sourceHash: hashBytes(stablePayload(payload))
      };
    }

    const sourceHash = hashBytes(stablePayload(payload));
    const ready = await this.ensureMigrated();
    if (ready.status === "error") {
      throw new LibraryOperationError(
        ready.error?.code || "LIBRARY_MIGRATION_FAILED",
        ready.error?.message || "Cannot import legacy browser state without a valid library",
        true
      );
    }
    const current = ready.snapshot || {
      schemaVersion: 2 as const,
      revision: 0,
      createdAt: new Date(0).toISOString(),
      tracks: [],
      folders: []
    };
    const existingMarker = await this.readMarker(LOCAL_STORAGE_MIGRATION);
    if (existingMarker?.sourceHash === sourceHash && current.schemaVersion === 2) {
      return { status: "alreadyImported", revision: current.revision, requestId: meta.requestId, sourceHash };
    }

    const merged = upgradeLibraryDomain(mergeLegacyPayload(current, payload));
    merged.migration = { migration: LOCAL_STORAGE_MIGRATION, sourceHash };
    validateLibraryPayloadV2(merged);
    const committed = await this.repository.commit(merged, {
      expectedRevision: meta.expectedRevision ?? current.revision,
      requestId: meta.requestId
    });
    if (committed.status === "conflict") {
      return { status: "conflict", revision: committed.revision, requestId: committed.requestId, sourceHash, error: committed.error };
    }
    const verified = await this.repository.loadLatestValid();
    if (!verified.snapshot || verified.snapshot.schemaVersion !== 2) {
      throw new LibraryOperationError("LIBRARY_MIGRATION_FAILED", "Legacy browser import failed read-back validation", true);
    }
    await this.completeMarker(LOCAL_STORAGE_MIGRATION, sourceHash, verified.snapshot.revision);
    return {
      status: committed.status === "noop" ? "noop" : "imported",
      revision: verified.snapshot.revision,
      requestId: committed.requestId,
      sourceHash
    };
  }
}
