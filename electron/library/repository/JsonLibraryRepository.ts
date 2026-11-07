import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { LibraryOperationError, libraryErrorFrom } from "../errors";
import {
  payloadChecksum,
  revisionChecksum,
  validateLegacyLibraryPayload,
  validateLibraryPayloadV2,
  validatePersistedRevision
} from "../validation/LibraryValidator";
import type {
  LibraryPayloadV2,
  LibraryCommitResult,
  LibraryLoadResult,
  LibraryRepository,
  LibrarySnapshot,
  PersistedLibraryRevision
} from "../types";

export type LibraryRepositoryFailpoint =
  | "after-temp-sync"
  | "after-rename"
  | "after-readback";

export interface JsonLibraryRepositoryOptions {
  storageDirectory: string;
  legacyPath?: string;
  retentionCount?: number;
  now?: () => Date;
  failpoint?: (point: LibraryRepositoryFailpoint, revision: number) => void | Promise<void>;
}

const revisionPattern = /^(\d{10})\.json$/;

function snapshotFrom(revision: PersistedLibraryRevision): LibrarySnapshot {
  const schemaVersion = "schemaVersion" in revision.payload && revision.payload.schemaVersion === 2 ? 2 : 1;
  return {
    schemaVersion,
    domainVersion: schemaVersion === 2 ? (revision.payload as LibraryPayloadV2).domainVersion : undefined,
    revision: revision.revision,
    createdAt: revision.createdAt,
    tracks: revision.payload.tracks,
    folders: revision.payload.folders,
    migration: schemaVersion === 2 ? (revision.payload as LibraryPayloadV2).migration : undefined,
    roots: schemaVersion === 2 ? (revision.payload as LibraryPayloadV2).roots : undefined,
    artists: schemaVersion === 2 ? (revision.payload as LibraryPayloadV2).artists : undefined,
    albums: schemaVersion === 2 ? (revision.payload as LibraryPayloadV2).albums : undefined
  };
}

export class JsonLibraryRepository implements LibraryRepository {
  readonly storageDirectory: string;
  readonly revisionsDirectory: string;
  readonly legacyPath?: string;
  readonly retentionCount: number;
  // Cache validation identities, not historical payloads. A stat change forces revalidation.
  private readonly identities = new Map<number, { stamp: string; revision: number; requestId?: string }>();
  private latestRead?: { revision: number; stamp: string; value: PersistedLibraryRevision };
  private readonly now: () => Date;
  private readonly failpoint?: JsonLibraryRepositoryOptions["failpoint"];

  constructor(options: JsonLibraryRepositoryOptions) {
    this.storageDirectory = path.resolve(options.storageDirectory);
    this.revisionsDirectory = path.join(this.storageDirectory, "revisions");
    this.legacyPath = options.legacyPath ? path.resolve(options.legacyPath) : undefined;
    this.retentionCount = Math.max(3, Math.floor(options.retentionCount || 5));
    this.now = options.now || (() => new Date());
    this.failpoint = options.failpoint;
  }

  private revisionPath(revision: number) {
    return path.join(this.revisionsDirectory, String(revision).padStart(10, "0") + ".json");
  }

  private async revisionNumbers() {
    let entries: string[];
    try {
      entries = await fs.promises.readdir(this.revisionsDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return entries
      .map(entry => revisionPattern.exec(entry))
      .filter((match): match is RegExpExecArray => Boolean(match))
      .map(match => Number(match[1]))
      .filter(Number.isSafeInteger)
      .sort((left, right) => right - left);
  }

  private async revisionStamp(revision: number) {
    const stat = await fs.promises.stat(this.revisionPath(revision), { bigint: true });
    return `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.ino}`;
  }

  private async readRevision(revision: number) {
    const stamp = await this.revisionStamp(revision);
    if (this.latestRead?.revision === revision && this.latestRead.stamp === stamp)
      return structuredClone(this.latestRead.value);
    const raw = await fs.promises.readFile(this.revisionPath(revision), "utf8");
    const value = validatePersistedRevision(JSON.parse(raw), revision);
    if (stamp === await this.revisionStamp(revision)) {
      this.identities.set(revision, { stamp, revision, requestId: value.requestId });
      while (this.identities.size > this.retentionCount + 8)
        this.identities.delete(this.identities.keys().next().value!);
      if (!this.latestRead || revision >= this.latestRead.revision)
        this.latestRead = { revision, stamp, value: structuredClone(value) };
    }
    return value;
  }

  private async revisionIdentity(revision: number) {
    const cached = this.identities.get(revision);
    if (cached && cached.stamp === await this.revisionStamp(revision)) return cached;
    return this.readRevision(revision);
  }

  private async loadLegacy(): Promise<LibraryLoadResult> {
    if (!this.legacyPath) return { status: "empty" };
    try {
      const raw = await fs.promises.readFile(this.legacyPath, "utf8");
      const payload = JSON.parse(raw) as unknown;
      validateLegacyLibraryPayload(payload);
      return {
        status: "ok",
        snapshot: {
          schemaVersion: 1,
          revision: 0,
          createdAt: new Date(0).toISOString(),
          tracks: payload.tracks,
          folders: payload.folders
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "empty" };
      return {
        status: "error",
        error: {
          code: error instanceof SyntaxError ? "LIBRARY_SNAPSHOT_CORRUPT" : libraryErrorFrom(error, "LIBRARY_SNAPSHOT_CORRUPT").code,
          message: error instanceof Error ? error.message : "Legacy music library cannot be read",
          recoverable: true
        }
      };
    }
  }

  async loadLatestValid(): Promise<LibraryLoadResult> {
    let revisions: number[];
    try {
      revisions = await this.revisionNumbers();
    } catch (error) {
      return { status: "error", error: libraryErrorFrom(error, "LIBRARY_UNKNOWN_ERROR") };
    }
    if (!revisions.length) return this.loadLegacy();

    const latestRevision = revisions[0];
    for (const revision of revisions) {
      try {
        const stored = await this.readRevision(revision);
        const recovered = revision !== latestRevision;
        return {
          status: recovered ? "recovered" : "ok",
          snapshot: snapshotFrom(stored),
          recoveredFromRevision: recovered ? revision : undefined
        };
      } catch {
        continue;
      }
    }
    return {
      status: "error",
      error: {
        code: "LIBRARY_NO_VALID_REVISION",
        message: "No valid music library revision is available",
        recoverable: false,
        details: { revisionFiles: revisions.length }
      }
    };
  }

  async recoverLatestValid() {
    return this.loadLatestValid();
  }

  async listValidRevisions() {
    const valid: number[] = [];
    for (const revision of await this.revisionNumbers()) {
      try {
        await this.revisionIdentity(revision);
        valid.push(revision);
      } catch {
        continue;
      }
    }
    return valid.sort((left, right) => left - right);
  }

  private async committedRequest(requestId: string) {
    for (const revision of await this.revisionNumbers()) {
      try {
        const stored = await this.revisionIdentity(revision);
        if (stored.requestId === requestId) return stored;
      } catch {
        continue;
      }
    }
    return undefined;
  }

  private async pruneOldValidRevisions() {
    const valid = await this.listValidRevisions();
    const obsolete = valid.slice(0, Math.max(0, valid.length - this.retentionCount));
    await Promise.all(obsolete.map(async revision => {
      try {
        await fs.promises.unlink(this.revisionPath(revision));
        this.identities.delete(revision);
      } catch {
        // Retention cleanup must never invalidate an already committed revision.
      }
    }));
  }

  async commit(payload: LibraryPayloadV2, options: {
    expectedRevision?: number;
    requestId?: string;
  } = {}): Promise<LibraryCommitResult> {
    validateLibraryPayloadV2(payload);
    const requestId = options.requestId?.trim() || crypto.randomUUID();
    if (options.expectedRevision !== undefined
      && (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0)) {
      throw new LibraryOperationError("LIBRARY_INVALID_SCHEMA", "expectedRevision must be a non-negative integer", false);
    }

    const previousRequest = await this.committedRequest(requestId);
    if (previousRequest) {
      return { status: "committed", revision: previousRequest.revision, requestId };
    }

    const current = await this.loadLatestValid();
    if (current.status === "error") {
      throw new LibraryOperationError(
        current.error?.code || "LIBRARY_NO_VALID_REVISION",
        current.error?.message || "Cannot commit without a valid base revision",
        false
      );
    }
    const currentRevision = current.snapshot?.revision || 0;
    if (options.expectedRevision !== undefined && options.expectedRevision !== currentRevision) {
      return {
        status: "conflict",
        revision: currentRevision,
        requestId,
        error: {
          code: "LIBRARY_REVISION_CONFLICT",
          message: "The music library changed before this command was committed",
          recoverable: true,
          details: { expectedRevision: options.expectedRevision, actualRevision: currentRevision }
        }
      };
    }
    if (currentRevision > 0 && current.snapshot
      && current.snapshot.schemaVersion === 2
      && payloadChecksum(payload) === payloadChecksum({
        schemaVersion: 2,
        domainVersion: current.snapshot.domainVersion,
        tracks: current.snapshot.tracks,
        folders: current.snapshot.folders,
        migration: current.snapshot.migration,
        roots: current.snapshot.roots,
        artists: current.snapshot.artists,
        albums: current.snapshot.albums
      })) {
      return { status: "noop", revision: currentRevision, requestId };
    }

    const knownRevisions = await this.revisionNumbers();
    const nextRevision = (knownRevisions[0] || 0) + 1;
    const unsigned: Omit<PersistedLibraryRevision, "checksum"> = {
      formatVersion: 1,
      revision: nextRevision,
      createdAt: this.now().toISOString(),
      requestId,
      payload
    };
    const stored: PersistedLibraryRevision = { ...unsigned, checksum: revisionChecksum(unsigned) };
    const finalPath = this.revisionPath(nextRevision);
    const temporaryPath = finalPath + ".tmp." + crypto.randomUUID();

    try {
      await fs.promises.mkdir(this.revisionsDirectory, { recursive: true });
      const handle = await fs.promises.open(temporaryPath, "wx");
      try {
        await handle.writeFile(JSON.stringify(stored), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.failpoint?.("after-temp-sync", nextRevision);
      await fs.promises.rename(temporaryPath, finalPath);
      await this.failpoint?.("after-rename", nextRevision);
      const verified = await this.readRevision(nextRevision);
      await this.failpoint?.("after-readback", nextRevision);
      await this.pruneOldValidRevisions();
      return { status: "committed", revision: verified.revision, requestId };
    } catch (error) {
      if (error instanceof LibraryOperationError) throw error;
      throw new LibraryOperationError(
        "LIBRARY_WRITE_FAILED",
        error instanceof Error ? error.message : "Music library commit failed",
        true,
        { revision: nextRevision }
      );
    }
  }
}
