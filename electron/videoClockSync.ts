/** Audio is the master clock. Small errors settle without visible frame jumps. */
export function videoClockCorrection(audio: number, video: number) {
  if (!Number.isFinite(audio) || !Number.isFinite(video) || audio < 0) return { speed: 1 };
  const drift = audio - video;
  if (Math.abs(drift) > 0.25) return { speed: 1, seek: audio };
  return { speed: Math.abs(drift) < 0.045 ? 1 : drift > 0 ? 1.03 : 0.97 };
}
