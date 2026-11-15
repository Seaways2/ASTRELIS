/**
 * A parsed response from a third-party web API (MusicBrainz, TMDB, NetEase).
 * Its shape is never trusted: every field read from it goes through a check
 * (text(), Array.isArray, the id validators) before it is used, so it is typed
 * loosely on purpose, in this one place rather than at every read.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ExternalJson = any;
