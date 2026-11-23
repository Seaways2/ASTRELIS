export type WebPlaybackEvent = "timeupdate" | "loadedmetadata" | "ended" | "play" | "pause" | "error";

export interface WebPlaybackEventSource {
  on(event: WebPlaybackEvent, listener: () => void): () => void;
  readonly element: { readonly ended: boolean };
}

export interface WebPlaybackEventHandlers {
  /** Position or duration changed. */
  sync(): void;
  /** The source played to its end. */
  ended(): void;
  /** The element started or was paused by something other than the player. */
  observed(playing: boolean): void;
  /** The source cannot be loaded or decoded. */
  failed(): void;
}

/**
 * Routes the shared audio element's events for one play request (`token`).
 *
 * Until the next track is loaded the element still carries the previous one:
 * its fade-out pause, a late end or its last time updates belong to that
 * source and must not stop, advance or reposition the newly chosen track.
 * `loadedToken` names the play request whose source the element holds.
 *
 * A pause dispatched because the media reached its end is part of completion,
 * not a user pause; the `ended` handler decides what happens next (repeat one,
 * the next entry or stopping).
 */
export function bindWebPlaybackEvents(
  source: WebPlaybackEventSource,
  token: string,
  loadedToken: () => string,
  handlers: WebPlaybackEventHandlers
) {
  const current = () => Boolean(token) && loadedToken() === token;
  const cleanups = [
    source.on("timeupdate", () => { if (current()) handlers.sync(); }),
    source.on("loadedmetadata", () => { if (current()) handlers.sync(); }),
    source.on("ended", () => { if (current()) handlers.ended(); }),
    source.on("play", () => { if (current()) handlers.observed(true); }),
    source.on("pause", () => { if (current() && !source.element.ended) handlers.observed(false); }),
    source.on("error", () => { if (current()) handlers.failed(); })
  ];
  return () => cleanups.forEach(cleanup => cleanup());
}
