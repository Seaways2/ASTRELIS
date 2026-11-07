const REFERENCE_FRAME_MS = 1000 / 60;

export function smoothFrequencyFrame(
  input: Uint8Array,
  previous: Uint8Array | undefined,
  smoothing: number,
  elapsedMs: number
) {
  const amount = Math.max(0, Math.min(.98, smoothing));
  if (!previous || previous.length !== input.length || amount <= 0 || !Number.isFinite(elapsedMs) || elapsedMs <= 0)
    return Uint8Array.from(input);

  const retention = Math.pow(amount, elapsedMs / REFERENCE_FRAME_MS);
  const next = new Uint8Array(input.length);
  for (let index = 0; index < input.length; index++)
    next[index] = Math.round(previous[index] * retention + input[index] * (1 - retention));
  return next;
}
