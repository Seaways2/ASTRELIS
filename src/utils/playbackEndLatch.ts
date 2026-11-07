export class PlaybackEndLatch {
  private claimedToken = "";

  claim(token: string) {
    if (!token || this.claimedToken === token) return false;
    this.claimedToken = token;
    return true;
  }

  release(token: string) {
    if (this.claimedToken === token) this.claimedToken = "";
  }
}

export function nextQueueIndex(length: number, currentIndex: number, shuffle: boolean, random = Math.random) {
  if (length <= 0) return -1;
  if (!shuffle || length === 1) return (currentIndex + 1) % length;
  const offset = 1 + Math.floor(Math.max(0, Math.min(.999999, random())) * (length - 1));
  return (currentIndex + offset) % length;
}

/** Natural completion respects the queue boundary; a manual Next can still wrap. */
export function nextQueueIndexAfterEnd(length: number, currentIndex: number, shuffle: boolean, repeat: "off" | "all" | "one", random = Math.random) {
  if (length <= 0 || currentIndex < 0 || currentIndex >= length) return -1;
  if (repeat === "one") return currentIndex;
  if (repeat === "off" && currentIndex === length - 1) return -1;
  return nextQueueIndex(length, currentIndex, shuffle, random);
}

export function nativeStatusCompletesTrack(
  status: { position?: number; duration?: number; playbackToken?: string },
  expectedToken: string,
  backendReady: boolean
) {
  if (!backendReady || !expectedToken) return false;
  if (status.playbackToken && status.playbackToken !== expectedToken) return false;
  const position = Number(status.position);
  const duration = Number(status.duration);
  return Number.isFinite(position) && Number.isFinite(duration) && duration > 0 && position >= duration - .05;
}
