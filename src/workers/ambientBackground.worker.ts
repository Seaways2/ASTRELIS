import { createAmbientPixels, type AmbientBackgroundOptions } from "../utils/ambientBackground";

interface AmbientRequest {
  id: number;
  width: number;
  height: number;
  options: AmbientBackgroundOptions;
}

type AmbientResponse = {
  id: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  durationMs: number;
} | { id: number; error: string };

// The app's shared TS configuration includes DOM rather than WebWorker types.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<AmbientRequest>) => void) | null;
  postMessage: (message: AmbientResponse, transfer?: Transferable[]) => void;
};

scope.onmessage = ({ data }) => {
  const { id, width, height, options } = data;
  try {
    const start = performance.now();
    const pixels = createAmbientPixels(width, height, options);
    scope.postMessage({ id, width, height, pixels, durationMs: performance.now() - start }, [pixels.buffer]);
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
