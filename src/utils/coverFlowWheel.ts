/** Accumulate high-resolution wheels; accelerate intentional same-direction bursts. */
export class CoverFlowWheel {
  private time = -Infinity;
  private direction = 0;
  private remainder = 0;
  private allowance = 3;
  step(delta: number, mode: number, now: number) {
    if (!Number.isFinite(delta) || delta === 0) return 0;
    const direction = Math.sign(delta), gap = now - this.time;
    const fresh = gap > 180 || direction !== this.direction;
    if (fresh) { this.remainder = 0; this.allowance = Math.max(1, this.allowance); }
    const gain = fresh ? 1 : gap < 45 ? 1.6 : gap < 100 ? 1.3 : 1;
    const pixels = Math.abs(delta) * (mode === 1 ? 40 : mode === 2 ? 240 : 1);
    this.allowance = Math.min(3, this.allowance + Math.max(0, gap) * .01);
    this.remainder = Math.min(160, this.remainder + Math.min(160, pixels) * gain);
    const steps = Math.min(2, Math.floor(this.allowance), Math.floor(this.remainder / 80));
    this.remainder -= steps * 80;
    this.allowance -= steps;
    this.time = now; this.direction = direction;
    return steps ? direction * steps : 0;
  }
}
