import type { LibraryError, LibraryErrorCode } from "./types";

export class LibraryOperationError extends Error {
  readonly libraryError: LibraryError;

  constructor(code: LibraryErrorCode, message: string, recoverable = true, details?: LibraryError["details"]) {
    super(`${code}: ${message}`);
    this.name = "LibraryOperationError";
    this.libraryError = { code, message, recoverable, details };
  }
}

export function libraryErrorFrom(error: unknown, fallbackCode: LibraryErrorCode = "LIBRARY_UNKNOWN_ERROR"): LibraryError {
  if (error instanceof LibraryOperationError) return error.libraryError;
  const message = error instanceof Error ? error.message : String(error || "Unknown library error");
  return { code: fallbackCode, message, recoverable: true };
}
