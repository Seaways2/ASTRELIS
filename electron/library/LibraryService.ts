import { LibraryOperationError } from "./errors";
import { LibraryMigrator } from "./migration/LibraryMigrator";
import { upgradeLibraryDomain } from "./domain/LibraryDomain";
import { LibraryReconciler } from "./reconcile/LibraryReconciler";
import type {
  LegacyLibraryPayload,
  LegacyLibraryImportResult,
  LibraryCommandMeta,
  LibraryCommitResult,
  LibraryLoadResult,
  LibraryRepository,
  LibraryScanCommitResult,
  LibraryScanResult
} from "./types";

export type LibraryLogEvent = {
  action: "library.load" | "library.recover" | "library.commit" | "library.reconcile" | "library.import-legacy";
  revision?: number;
  requestId?: string;
  result: string;
  durationMs: number;
  errorCode?: string;
};

export class LibraryService {
  private writeTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: LibraryRepository,
    private readonly log?: (event: LibraryLogEvent) => void,
    private readonly reconciler = new LibraryReconciler(),
    private readonly migrator?: LibraryMigrator
  ) {}

  private async measuredLoad(action: "library.load" | "library.recover", operation: () => Promise<LibraryLoadResult>) {
    const started = Date.now();
    const result = await operation();
    this.log?.({
      action,
      revision: result.snapshot?.revision,
      result: result.status,
      durationMs: Date.now() - started,
      errorCode: result.error?.code
    });
    return result;
  }

  private loadReady() {
    return this.migrator ? this.migrator.ensureMigrated() : this.repository.loadLatestValid();
  }

  getSnapshot() {
    return this.serialize(() => this.measuredLoad("library.load", () => this.loadReady()));
  }

  recoverLatestValid() {
    return this.measuredLoad("library.recover", () => this.repository.recoverLatestValid());
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeTail.then(operation, operation);
    this.writeTail = result.then(() => undefined, () => undefined);
    return result;
  }

  commitLegacySnapshot(payload: LegacyLibraryPayload, meta: LibraryCommandMeta): Promise<LibraryCommitResult> {
    if (!meta || typeof meta.requestId !== "string" || !meta.requestId.trim()) {
      return Promise.reject(new LibraryOperationError("LIBRARY_INVALID_SCHEMA", "Library mutation requires requestId", false));
    }
    return this.serialize(async () => {
      const started = Date.now();
      try {
        const current = await this.loadReady();
        if (current.status === "error") {
          throw new LibraryOperationError(
            current.error?.code || "LIBRARY_NO_VALID_REVISION",
            current.error?.message || "Cannot commit without a valid library",
            false
          );
        }
        const result = await this.repository.commit(upgradeLibraryDomain({
          schemaVersion: 2,
          tracks: payload.tracks,
          folders: payload.folders,
          migration: current.snapshot?.migration
        }), {
          requestId: meta.requestId,
          expectedRevision: meta.expectedRevision
        });
        this.log?.({
          action: "library.commit",
          revision: result.revision,
          requestId: result.requestId,
          result: result.status,
          durationMs: Date.now() - started,
          errorCode: result.error?.code
        });
        return result;
      } catch (error) {
        const errorCode = error instanceof LibraryOperationError ? error.libraryError.code : "LIBRARY_UNKNOWN_ERROR";
        this.log?.({
          action: "library.commit",
          requestId: meta.requestId,
          result: "error",
          durationMs: Date.now() - started,
          errorCode
        });
        throw error;
      }
    });
  }

  applyScan(scan: LibraryScanResult, requestedRoots: string[], meta: LibraryCommandMeta): Promise<LibraryScanCommitResult> {
    if (!meta || typeof meta.requestId !== "string" || !meta.requestId.trim()) {
      return Promise.reject(new LibraryOperationError("LIBRARY_INVALID_SCHEMA", "Library scan commit requires requestId", false));
    }
    return this.serialize(async () => {
      const started = Date.now();
      const current = await this.loadReady();
      if (current.status === "error") {
        throw new LibraryOperationError(
          current.error?.code || "LIBRARY_NO_VALID_REVISION",
          current.error?.message || "Cannot reconcile without a valid base revision",
          false
        );
      }
      const reconcile = this.reconciler.reconcile(
        current.snapshot
          ? { tracks: current.snapshot.tracks, folders: current.snapshot.folders }
          : { tracks: [], folders: [] },
        scan,
        requestedRoots
      );
      const mutation = await this.repository.commit(upgradeLibraryDomain({
        schemaVersion: 2,
        tracks: reconcile.snapshot.tracks,
        folders: reconcile.snapshot.folders,
        migration: current.snapshot?.migration
      }), {
        requestId: meta.requestId,
        expectedRevision: meta.expectedRevision
      });
      this.log?.({
        action: "library.reconcile",
        revision: mutation.revision,
        requestId: mutation.requestId,
        result: mutation.status,
        durationMs: Date.now() - started,
        errorCode: mutation.error?.code
      });
      return { mutation, reconcile };
    });
  }

  importLegacyState(payload: LegacyLibraryPayload, meta: LibraryCommandMeta): Promise<LegacyLibraryImportResult> {
    if (!this.migrator) {
      return Promise.reject(new LibraryOperationError("LIBRARY_MIGRATION_FAILED", "Legacy importer is not configured", false));
    }
    return this.serialize(async () => {
      const started = Date.now();
      try {
        const result = await this.migrator!.importLegacyState(payload, meta);
        this.log?.({
          action: "library.import-legacy",
          revision: result.revision,
          requestId: result.requestId,
          result: result.status,
          durationMs: Date.now() - started,
          errorCode: result.error?.code
        });
        return result;
      } catch (error) {
        this.log?.({
          action: "library.import-legacy",
          requestId: meta?.requestId,
          result: "error",
          durationMs: Date.now() - started,
          errorCode: error instanceof LibraryOperationError ? error.libraryError.code : "LIBRARY_UNKNOWN_ERROR"
        });
        throw error;
      }
    });
  }

  listValidRevisions() {
    return this.repository.listValidRevisions();
  }
}
