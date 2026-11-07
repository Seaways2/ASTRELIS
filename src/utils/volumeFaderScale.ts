export const FADER_STEPS = 60;
export const FADER_CAP_HEIGHT = 63;
export type FaderDragState = { position: number; detent: number | null };

const DRAG_RESPONSE = .26;
const DETENT_INTERVAL = 10;
const DETENT_CAPTURE_STEPS = .8;
const DETENT_RELEASE_STEPS = 3;

const clamp = (value: number) => Math.max(0, Math.min(1, value));

// The bottom stop is mute. Each remaining stop is one decibel, from -59 to 0.
export function faderPositionToAmplitude(position: number): number {
  const step = Math.round(clamp(position) * FADER_STEPS);
  return step === 0 ? 0 : Math.pow(10, (step - FADER_STEPS) / 20);
}

export function amplitudeToFaderPosition(amplitude: number): number {
  if (amplitude <= .001) return 0;
  return clamp((20 * Math.log10(clamp(amplitude)) + FADER_STEPS) / FADER_STEPS);
}

export function amplitudeToFaderPercent(amplitude: number): number {
  return Math.round(amplitudeToFaderPosition(amplitude) * 100);
}

export function formatFaderDb(amplitude: number): string {
  return amplitude <= .001 ? "−∞" : Math.max(-FADER_STEPS, 20 * Math.log10(amplitude)).toFixed(1);
}

export function nudgeFaderAmplitude(amplitude: number, steps: number): number {
  const current = Math.round(amplitudeToFaderPosition(amplitude) * FADER_STEPS);
  return faderPositionToAmplitude((current + steps) / FADER_STEPS);
}

// Interior 10 dB marks hold until the pointer moves 3 dB away. The end stops
// need no detent, so the quietest and loudest adjacent steps stay reachable.
// Keep the unrounded position during drag so slow movements can cross 1 dB steps.
export function advanceFaderDrag(state: FaderDragState, pointerPosition: number, settle = false): FaderDragState {
  const pointerStep = clamp(pointerPosition) * FADER_STEPS;
  if (state.detent !== null && Math.abs(pointerStep - state.detent) <= DETENT_RELEASE_STEPS) {
    return state;
  }
  const currentStep = state.position * FADER_STEPS;
  const nextStep = settle ? pointerStep : currentStep + (pointerStep - currentStep) * DRAG_RESPONSE;
  const nearestDetent = Math.round(nextStep / DETENT_INTERVAL) * DETENT_INTERVAL;
  if (nearestDetent > 0 && nearestDetent < FADER_STEPS
    && Math.abs(nextStep - nearestDetent) <= DETENT_CAPTURE_STEPS
    && Math.abs(pointerStep - nearestDetent) <= DETENT_RELEASE_STEPS) {
    return { position: nearestDetent / FADER_STEPS, detent: nearestDetent };
  }
  return { position: nextStep / FADER_STEPS, detent: null };
}
