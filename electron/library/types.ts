import type { FilmMetadata } from "./media/TmdbClient";
export type LibraryRevision = number;

export type LibraryErrorCode =
  | "LIBRARY_SNAPSHOT_CORRUPT"
  | "LIBRARY_NO_VALID_REVISION"
  | "LIBRARY_WRITE_FAILED"
  | "LIBRARY_REVISION_CONFLICT"
  | "LIBRARY_MIGRATION_FAILED"
  | "LIBRARY_ROOT_OFFLINE"
  | "LIBRARY_PERMISSION_DENIED"
  | "LIBRARY_PARTIAL_SCAN"
  | "LIBRARY_INVALID_SCHEMA"
  | "LIBRARY_UNKNOWN_ERROR";

export interface LibraryError {
  code: LibraryErrorCode;
  message: string;
  recoverable: boolean;
  details?: Record<string, string | number | boolean>;
}

export interface LibraryCommandMeta {
  requestId: string;
  expectedRevision?: number;
}

export interface LegacyLibraryPayload {
  tracks: unknown[];
  folders: string[];
}

export interface LibraryMigrationProvenance {
  migration: "library-v1-to-v2" | "legacy-localstorage-v1-to-v2";
  sourceHash: string;
}

export interface LibraryPayloadV2 extends LegacyLibraryPayload {
  schemaVersion: 2;
  domainVersion?: 2;
  roots?: LibraryRoot[];
  artists?: Artist[];
  albums?: Album[];
  migration?: LibraryMigrationProvenance;
}

export type StoredLibraryPayload = LegacyLibraryPayload | LibraryPayloadV2;

export interface LegacyTrackRecord {
  id: string;
  name: string;
  artist: string;
  album: string;
  url: string;
  format: string;
  size: number;
  coverUrl?: string;
  videoInfo?: string;
  coverLocked?: boolean;
  onlineMetadata?: FilmMetadata;
  nativePath?: string;
  sourcePath?: string;
  duration?: number;
  year?: number;
  genre?: string;
  folder?: string;
  mediaId?: string;
  albumId?: string;
  location?: TrackLocation;
  file?: FileIdentity;
  tags?: TrackTags;
}

export interface LibraryRoot {
  rootId: string;
  path: string;
}

export interface TrackLocation {
  rootId: string;
  sourcePath: string;
  canonicalPath: string;
}

export interface FileIdentity {
  size: number;
  mtimeMs: number;
  fingerprint?: string;
}

export interface ArtistReference {
  artistId: string;
  name: string;
}

export interface TrackTags {
  title?: string;
  artists: ArtistReference[];
  album?: string;
  albumArtist?: string;
  genres: string[];
  year?: number;
  trackNumber?: number;
  discNumber?: number;
  compilation?: boolean;
}

export interface TrackRecord extends LegacyTrackRecord {
  mediaId: string;
  location: TrackLocation;
  file: FileIdentity;
  tags: TrackTags;
}

export interface Artist {
  artistId: string;
  name: string;
  normalizedName: string;
}

export interface Album {
  albumId: string;
  title: string;
  albumArtistId?: string;
  compilation?: boolean;
}

export type ScannedTrack = LegacyTrackRecord & { metadataRead?: boolean };

export type RootScanStatus =
  | "complete"
  | "partial"
  | "offline"
  | "permissionDenied"
  | "cancelled";

export interface ScanFailure {
  stage: "root" | "directory" | "stat" | "metadata" | "artwork";
  path: string;
  code: string;
  message: string;
}

export interface RootScanResult {
  rootId: string;
  path: string;
  status: RootScanStatus;
  scannedFiles: number;
  skippedFiles: number;
  unreadableDirectories: string[];
}

export interface LibraryScanResult {
  scanId: string;
  startedAt: string;
  completedAt: string;
  roots: RootScanResult[];
  tracks: ScannedTrack[];
  failures: ScanFailure[];
}

export interface LibraryReconcileResult {
  added: string[];
  updated: string[];
  relocated: string[];
  unavailable: string[];
  removed: string[];
  preserved: string[];
  failures: ScanFailure[];
  snapshot: LegacyLibraryPayload;
}

export interface LibraryScanCommitResult {
  mutation: LibraryCommitResult;
  reconcile: LibraryReconcileResult;
}

export interface LibrarySnapshot extends LegacyLibraryPayload {
  schemaVersion: 1 | 2;
  domainVersion?: 2;
  revision: LibraryRevision;
  createdAt: string;
  roots?: LibraryRoot[];
  artists?: Artist[];
  albums?: Album[];
  migration?: LibraryMigrationProvenance;
}

export interface LibraryLoadResult {
  status: "ok" | "recovered" | "empty" | "error";
  snapshot?: LibrarySnapshot;
  recoveredFromRevision?: number;
  error?: LibraryError;
}

export interface LibraryCommitResult {
  status: "committed" | "noop" | "conflict";
  revision: number;
  requestId: string;
  error?: LibraryError;
}

export interface PersistedLibraryRevision {
  formatVersion: 1;
  revision: number;
  createdAt: string;
  requestId?: string;
  payload: StoredLibraryPayload;
  checksum: string;
}

export type LibraryMigrationFailpoint =
  | "AFTER_LEGACY_READ"
  | "AFTER_TRANSFORM"
  | "AFTER_TMP_WRITE"
  | "AFTER_REVISION_COMMIT"
  | "BEFORE_MIGRATION_MARKER"
  | "AFTER_MIGRATION_MARKER"
  | "BEFORE_IPC_ACK";

export interface LibraryMigrationMarker {
  migration: "library-v1-to-v2" | "legacy-localstorage-v1-to-v2";
  sourceHash: string;
  targetRevision: number;
  completed: true;
}

export interface LegacyLibraryImportRequest extends LegacyLibraryPayload {
  meta: LibraryCommandMeta;
}

export interface LegacyLibraryImportResult {
  status: "imported" | "alreadyImported" | "noop" | "conflict";
  revision: number;
  requestId: string;
  sourceHash: string;
  error?: LibraryError;
}

export interface LibraryRepository {
  loadLatestValid(): Promise<LibraryLoadResult>;
  commit(snapshot: LibraryPayloadV2, options?: {
    expectedRevision?: number;
    requestId?: string;
  }): Promise<LibraryCommitResult>;
  recoverLatestValid(): Promise<LibraryLoadResult>;
  listValidRevisions(): Promise<number[]>;
}
