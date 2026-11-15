/**
 * Turns the analyser spectrum into the signals the particle scenes light up
 * with. The spectrum arrives on a dB scale (80 dB over 0–255), so a loudly
 * mastered song keeps every band near the top of the range: measured in
 * absolute terms the stars sat almost fully lit and barely moved. Everything
 * here is measured against the song's own recent level instead, and the beat
 * envelope falls back to dark between kicks.
 */

export interface MusicDynamicsSettings {
  sensitivity: number;
  decaySpeed: number;
}

/** Bins the particle scenes tie stars to; the analyser posts 256. */
const TRACKED_BINS = 128;
/** Below this the input is silence or hiss, and nothing should light up. */
const SILENCE = .03;
const AUDIBLE = .12;
/** Fastest repeat: sixteenths at 160 BPM stay apart, flams merge. */
const MIN_BEAT_GAP_SECONDS = .17;
/** How long a detected beat keeps rising before its strength is final. */
const ATTACK_WINDOW_SECONDS = .09;
/** The flash swells in over about twice this and fades with this time constant. */
const BEAT_SWELL_SECONDS = .045;
const BEAT_RELEASE_SECONDS = .22;
/** Without a beat for this long, the expected kick size starts to relax... */
const BEAT_DROUGHT_SECONDS = 1.2;
/** ...towards this floor, so a quieter song's kicks are found again. */
const TYPICAL_ONSET_FLOOR = .05;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const audible = (value: number) => clamp01((value - SILENCE) / (AUDIBLE - SILENCE));
/** Exponential approach, the same at any frame rate. */
const ease = (value: number, target: number, dt: number, seconds: number) =>
  value + (target - value) * (1 - Math.exp(-dt / seconds));

/**
 * A level measured against its own recent average: 0.5 when steady, towards 1
 * when louder than usual, towards 0 when quieter. The average takes seconds,
 * so a louder chorus glows for a while before it settles, and a quiet passage
 * stays dim longer still.
 *
 * With an anchor the average only closes part of the gap to a typical level,
 * so a section that stays loud stays brighter and a quiet song stays calmer.
 * Coming out of silence it catches up at once: otherwise every song started
 * with seconds of glare.
 */
class RelativeLevel {
  private mean = 0;
  private catchingUp = false;
  constructor(
    private readonly gain: number,
    private readonly riseSeconds: number,
    private readonly fallSeconds: number,
    private readonly typical = 0,
    private readonly anchor = 0
  ) {}

  update(value: number, dt: number) {
    const loudness = audible(value);
    const target = loudness > 0 ? value - (value - this.typical) * this.anchor : value;
    if (this.mean < AUDIBLE && value > AUDIBLE) this.catchingUp = true;
    if (target <= this.mean || this.mean >= target * .95) this.catchingUp = false;
    // While catching up the average still lags far behind; measured against
    // it every band read as fully lit for the first fraction of a second.
    const reference = this.catchingUp ? target : this.mean;
    const relative = clamp01(.5 + (value - reference) * this.gain) * loudness;
    const seconds = target <= this.mean ? this.fallSeconds : this.catchingUp ? .25 : this.riseSeconds;
    this.mean = ease(this.mean, target, dt, seconds);
    return relative;
  }
}

export class MusicDynamics {
  /** Beat envelope: jumps on a kick, back to near zero before the next one. */
  beat = 0;
  /** True only on the frame a beat is detected. */
  beatHit = false;
  /** True while the latest beat is still climbing (beatStrength may grow). */
  beatRising = false;
  /** Strength of the latest beat, relative to the song's usual kick. */
  beatStrength = 0;
  /** Bands and overall loudness against the song's recent level (0–1). */
  low = 0;
  mid = 0;
  high = 0;
  level = 0;
  private readonly bins = new Float32Array(TRACKED_BINS);
  // Per-bin levels are fully relative (spectral tilt differs per song); the
  // bands keep 30% of their distance from a typical mastered level, read off
  // the analyser's -90…-10 dB byte scale. Bin trackers are made on first use:
  // every scene owns a MusicDynamics, but only the particle scenes update it.
  private readonly binLevels: RelativeLevel[] = [];
  private readonly lowLevel = new RelativeLevel(3.6, 2, 4, .7, .3);
  private readonly midLevel = new RelativeLevel(4, 3, 6, .55, .3);
  private readonly highLevel = new RelativeLevel(4, 3, 6, .38, .3);
  private readonly loudness = new RelativeLevel(3.4, 4, 10, .45, .3);
  private readonly kickBaselines: number[] = [];
  private previousOnset = 0;
  private beatTarget = 0;
  private typicalOnset = .06;
  private lastBeatAt = -10;
  private attackUntil = -10;
  private attackPeak = 0;

  constructor(private readonly settings: MusicDynamicsSettings) {}

  update(data: Uint8Array, sampleRate: number, now: number, dt: number) {
    const sensitivity = this.settings.sensitivity / 255;
    const hzPerBin = (sampleRate || 48000) / Math.max(2, data.length * 2);
    const average = (fromHz: number, toHz: number) => {
      const start = Math.max(0, Math.min(data.length - 1, Math.floor(fromHz / hzPerBin)));
      const end = Math.max(start + 1, Math.min(data.length, Math.ceil(toHz / hzPerBin)));
      let sum = 0;
      for (let index = start; index < end; index++) sum += data[index];
      return Math.min(1, sum / (end - start) * sensitivity);
    };
    const kick = average(0, 150);
    this.low = this.lowLevel.update(kick, dt);
    this.mid = this.midLevel.update(average(180, 2000), dt);
    this.high = this.highLevel.update(average(2000, 8000), dt);
    this.level = this.loudness.update(average(40, 8000), dt);
    const tracked = Math.min(TRACKED_BINS, data.length);
    while (this.binLevels.length < tracked) this.binLevels.push(new RelativeLevel(3.2, 2.5, 5));
    for (let index = 0; index < tracked; index++) {
      // A star brightens quickly with its band and fades out gently, rather
      // than flickering with every frame-to-frame wobble of the spectrum.
      const relative = this.binLevels[index].update(Math.min(1, data[index] * sensitivity), dt);
      this.bins[index] = ease(this.bins[index], relative, dt, relative > this.bins[index] ? .06 : .28);
    }
    // The kick lives below ~150 Hz: at the analyser's ~94 Hz bins that is
    // the first two. Its fundamental fills the first; a bass note's attack
    // mostly lifts the second, so the first one counts most.
    const kickBins = Math.max(1, Math.min(data.length, Math.ceil(150 / hzPerBin)));
    let onset = 0;
    let before = 0;
    for (let index = 0; index < kickBins; index++) {
      const value = Math.min(1, data[index] * sensitivity);
      const baseline = this.kickBaselines[index] ?? 0;
      const weight = kickBins === 1 ? 1 : index === 0 ? .7 : .3 / (kickBins - 1);
      onset += Math.max(0, value - baseline) * weight;
      before += baseline * weight;
      // Rise above a short running baseline: a held note lifts the baseline
      // with it, so only a fresh attack counts.
      this.kickBaselines[index] = ease(baseline, value, dt, .2);
    }
    // Sound rising out of silence is the song starting, not a kick; counting
    // it opened every song with a full-strength flash.
    this.detectBeat(before > SILENCE ? onset : 0, kick, now, dt);
  }

  /** A star's own frequency band against its recent level (0–1). */
  bin(index: number) {
    return this.bins[Math.max(0, Math.min(TRACKED_BINS - 1, index))];
  }

  private detectBeat(onset: number, kick: number, now: number, dt: number) {
    this.beatHit = false;
    this.beatRising = false;
    const threshold = Math.max(.022, this.typicalOnset * .42);
    if (onset > threshold && onset > this.previousOnset && kick > AUDIBLE * .6
      && now - this.lastBeatAt > MIN_BEAT_GAP_SECONDS) {
      this.beatHit = true;
      this.lastBeatAt = now;
      this.attackUntil = now + ATTACK_WINDOW_SECONDS;
      this.attackPeak = 0;
    }
    if (now <= this.attackUntil) {
      // Keep raising this beat while its attack is still climbing, so a
      // hard kick lands brighter than a soft one.
      this.beatRising = true;
      this.attackPeak = Math.max(this.attackPeak, onset);
      this.beatStrength = Math.max(.3, Math.min(1, Math.pow(this.attackPeak / (this.typicalOnset * 1.15), .8)));
      this.beatTarget = Math.max(this.beatTarget, this.beatStrength);
      if (onset < this.previousOnset || now + dt > this.attackUntil) {
        this.typicalOnset += (this.attackPeak - this.typicalOnset) * .2;
        this.attackUntil = -10;
      }
    } else {
      // Long enough to read as a glow fading out, short enough to be mostly
      // dark again before the next kick at dance tempos.
      const decaySeconds = BEAT_RELEASE_SECONDS / Math.max(.5, Math.min(2, this.settings.decaySpeed));
      this.beatTarget *= Math.exp(-dt / decaySeconds);
    }
    // The expected kick size only learns from detected beats. After a loud
    // song a quieter one's kicks could stay under the threshold for good, so
    // during a stretch without beats it relaxes towards a floor.
    if (now - this.lastBeatAt > BEAT_DROUGHT_SECONDS)
      this.typicalOnset = ease(this.typicalOnset, Math.min(this.typicalOnset, TYPICAL_ONSET_FLOOR), dt, 2.5);
    this.previousOnset = onset;
    // The visible flash eases towards the target: it swells over ~100 ms
    // instead of jumping in one frame, and rounds off the start of the fade.
    this.beat = ease(this.beat, this.beatTarget, dt, this.beatTarget > this.beat ? BEAT_SWELL_SECONDS : .07);
  }
}
