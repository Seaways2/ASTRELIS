// Thumbnail blob store and work queue, import-free with DOM side effects injected so tests can load them.
type StoredThumbnail = { url: string; weight: number };

/** LRU store of thumbnail object URLs budgeted by blob bytes. Pinned keys are on screen: revoking one
 * blanked a visible cover and the effect that loaded it did not run again, so eviction skips them. */
export function createThumbnailStore({ maxWeight, revoke }: { maxWeight: number; revoke(url: string): void }) {
  const entries = new Map<string, StoredThumbnail>();
  const pins = new Map<string, number>();
  let total = 0;
  const drop = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    total -= entry.weight;
    revoke(entry.url);
  };
  const evict = () => {
    if (total <= maxWeight) return;
    let newest: string | undefined;
    for (const key of entries.keys()) newest = key;
    // Oldest first; the newest entry stays even over budget, as does anything pinned. One pass, so it always ends.
    for (const key of entries.keys()) {
      if (total <= maxWeight) break;
      if (key === newest || pins.get(key)) continue;
      drop(key);
    }
  };
  return {
    get(key: string) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry.url;
    },
    has(key: string) { return entries.has(key); },
    /** Returns the URL now stored under `key`. A pinned key keeps its URL: a mounted <img> shows it and
     * would not re-render onto a replacement, so the duplicate is revoked instead. */
    keep(key: string, url: string, weight: number) {
      const existing = entries.get(key);
      if (existing && pins.get(key)) {
        revoke(url);
        entries.delete(key);
        entries.set(key, existing);
        return existing.url;
      }
      drop(key);
      entries.set(key, { url, weight });
      total += weight;
      evict();
      return url;
    },
    invalidate(key: string) { drop(key); },
    clear() {
      entries.forEach(entry => revoke(entry.url));
      entries.clear();
      total = 0;
    },
    pin(key: string) { pins.set(key, (pins.get(key) ?? 0) + 1); },
    unpin(key: string) {
      const count = (pins.get(key) ?? 0) - 1;
      if (count > 0) pins.set(key, count); else pins.delete(key);
      evict();
    },
    weight() { return total; },
    size() { return entries.size; }
  };
}

const ABANDONED = "ThumbnailAbandoned";
export function isAbandonedThumbnail(error: unknown) {
  return error instanceof Error && error.name === ABANDONED;
}

/** At most `limit` thumbnail jobs at once. Fast paging mounts every card it passes and each queued a
 * fetch, decode and readback; a job whose cards all left before its turn is skipped instead. */
export function createThumbnailQueue(limit: number) {
  let active = 0;
  const interest = new Map<string, number>();
  const waiting: Array<{ key: string; start(): void; abandon(): void }> = [];
  const pump = () => {
    while (active < limit && waiting.length) {
      const next = waiting.shift()!;
      if (interest.get(next.key)) next.start(); else next.abandon();
    }
  };
  return {
    /** Registers a viewer of `key`; the returned release is idempotent. */
    claim(key: string) {
      interest.set(key, (interest.get(key) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const count = (interest.get(key) ?? 0) - 1;
        if (count > 0) interest.set(key, count); else interest.delete(key);
      };
    },
    interested(key: string) { return (interest.get(key) ?? 0) > 0; },
    run<T>(key: string, job: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waiting.push({
          key,
          start() {
            active++;
            Promise.resolve().then(job).then(resolve, reject).finally(() => { active--; pump(); });
          },
          abandon() {
            const error = new Error("Thumbnail no longer on screen");
            error.name = ABANDONED;
            reject(error);
          }
        });
        pump();
      });
    },
    active() { return active; },
    waiting() { return waiting.length; }
  };
}
