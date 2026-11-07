// A route under construction is not a failed audio device. Check both sides
// of the async poll, including the store token before React effect cleanup.
export function nativeStatusReady(s: {
  cancelled: boolean; ready: boolean; native: boolean; video: boolean;
  expected: string; backend?: string; current: string;
}) {
  return !s.cancelled && s.ready && s.native && !s.video && Boolean(s.expected)
    && s.expected === s.backend && s.expected === s.current;
}
