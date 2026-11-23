import path from "node:path";
import { LibraryOperationError } from "../errors";
import { libraryFolderArgument } from "../libraryPaths";
import type { LegacyLibraryImportRequest, LegacyLibraryPayload, LibraryCommandMeta } from "../types";
import { validateLegacyLibraryPayload } from "./LibraryValidator";

function invalid(message: string): never {
  throw new LibraryOperationError("LIBRARY_INVALID_SCHEMA", message, false);
}

export function parseCommandMeta(value: unknown): LibraryCommandMeta {
  if (!value || typeof value !== "object") invalid("Library command metadata is required");
  const meta = value as Record<string, unknown>;
  if (typeof meta.requestId !== "string" || !meta.requestId.trim() || meta.requestId.length > 200) invalid("Library requestId is invalid");
  if (meta.expectedRevision !== undefined
    && (!Number.isSafeInteger(meta.expectedRevision) || Number(meta.expectedRevision) < 0)) invalid("Library expectedRevision is invalid");
  return { requestId: meta.requestId.trim(), expectedRevision: meta.expectedRevision as number | undefined };
}

export function parseAbsolutePath(value: unknown, label = "path") {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || value.length > 32767 || !path.isAbsolute(value))
    invalid(`Library ${label} is invalid`);
  return path.resolve(value);
}

export function parsePathList(value: unknown, label = "paths", limit = 10000) {
  if (!Array.isArray(value) || value.length > limit) invalid(`Library ${label} are invalid`);
  return value.map(item => parseAbsolutePath(item, label));
}

export function parseRescanRequest(value: unknown) {
  if (!value || typeof value !== "object") invalid("Library rescan request is invalid");
  const request = value as Record<string, unknown>;
  const folders = Array.isArray(request.folders) ? request.folders.map(libraryFolderArgument) : request.folders;
  return { folders: parsePathList(folders, "folders", 1000), meta: parseCommandMeta(request.meta) };
}

export function parseLegacyMutation(value: unknown): LegacyLibraryImportRequest {
  if (!value || typeof value !== "object") invalid("Legacy library request is invalid");
  const request = value as Partial<LegacyLibraryPayload> & { meta?: unknown };
  if (!Array.isArray(request.tracks) || request.tracks.length > 200000) invalid("Legacy library track count is invalid");
  const payload = { tracks: request.tracks, folders: request.folders };
  validateLegacyLibraryPayload(payload);
  return {
    tracks: payload.tracks,
    folders: parsePathList(payload.folders, "legacy folders", 1000),
    meta: parseCommandMeta(request.meta)
  };
}
