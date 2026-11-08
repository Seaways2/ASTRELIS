// rAF timestamps jitter around the vsync period; without slack a 30 FPS
// target on a 60 Hz display randomly waits an extra frame.
export const FRAME_PACING_SLACK_MS = 2;

export function frameIsDue(now: number, nextDue: number) {
  return now - nextDue >= -FRAME_PACING_SLACK_MS;
}

// Keeps the average at the target rate on displays whose period does not
// divide it (30 FPS at 72/144 Hz alternates 2 and 3 frames), but never tries
// to catch up after a long pause or a skipped frame budget.
export function nextFrameDue(now: number, nextDue: number, frameInterval: number) {
  if (now - nextDue > frameInterval) return now + frameInterval;
  return Math.max(nextDue + frameInterval, now + frameInterval / 2);
}
