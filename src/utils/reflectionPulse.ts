import { MusicDynamics } from "../visualizers/musicDynamics";

/**
 * Drives the music-reactive glass reflection.
 *
 * It used to follow absolute levels (the low band and the RMS). A mastered
 * song keeps both near the top of their range, so the reflection sat at full
 * brightness for as long as anything played and only dimmed on pause. The
 * pulse now follows the song against its own recent level, plus its kicks, as
 * the particle scenes do: calmer in a verse, brighter in a chorus and on a beat.
 */

/** How far below full brightness the reflection may fall at full depth. */
const REST_DIP = .75;
/** Shares of the relative level and of the beat envelope in the pulse. */
const LEVEL_WEIGHT = .6;
const BEAT_WEIGHT = .8;
/** The pulse swells in quickly and settles more slowly: it breathes rather than flickers. */
const SWELL_SECONDS = .06;
const RELEASE_SECONDS = .18;
/** Once playback stops the reflection settles to its resting level over about a second. */
const STOP_RELEASE_SECONDS = .45;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number, target: number, dt: number, seconds: number) =>
  value + (target - value) * (1 - Math.exp(-dt / seconds));

/** Pulse depth (0–1) for the response setting (0–3); 0 keeps a static reflection. */
export function pulseDepth(response: number) {
  return Number.isFinite(response) && response > 0 ? 1 - Math.exp(-response * .8) : 0;
}

/** Reflection brightness for a pulse (0 calm … 1 on a beat) at a depth (0–1). */
export function reflectionGain(pulse: number, depth: number) {
  const settled = Number.isFinite(pulse) ? clamp01(pulse) : 0;
  const reach = Number.isFinite(depth) ? clamp01(depth) : 0;
  return 1 - REST_DIP * reach * (1 - settled);
}

export class ReflectionPulse {
  private readonly dynamics = new MusicDynamics({ sensitivity: 1, decaySpeed: 1 });
  private value = 0;

  get pulse() { return this.value; }

  /**
   * Advances with one spectrum frame (256 bins on the analyser's byte scale),
   * or with null while nothing plays. Times are in seconds.
   */
  update(frame: Uint8Array | null, sampleRate: number, now: number, dt: number) {
    const step = Math.max(0, Math.min(.1, Number.isFinite(dt) ? dt : 0));
    let target = 0;
    if (frame) {
      this.dynamics.update(frame, sampleRate, now, step);
      target = clamp01(this.dynamics.level * LEVEL_WEIGHT + this.dynamics.beat * BEAT_WEIGHT);
    }
    const seconds = target > this.value ? SWELL_SECONDS : frame ? RELEASE_SECONDS : STOP_RELEASE_SECONDS;
    this.value = ease(this.value, target, step, seconds);
    return this.value;
  }
}
