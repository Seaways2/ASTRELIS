export type GpuVisualQuality = "eco" | "standard" | "cosmic";

export interface GpuVisualCapabilities {
  webgl2: boolean;
  renderer: string;
  maxTextureSize: number;
  maxRenderbufferSize: number;
  maxSamples: number;
  highpFragment: boolean;
  reason: string;
}

let cachedCapabilities: GpuVisualCapabilities | undefined;

export function probeGpuVisualCapabilities(): GpuVisualCapabilities {
  if (cachedCapabilities) return cachedCapabilities;
  const unavailable = (reason: string): GpuVisualCapabilities => ({
    webgl2: false,
    renderer: "Canvas 2D",
    maxTextureSize: 0,
    maxRenderbufferSize: 0,
    maxSamples: 0,
    highpFragment: false,
    reason
  });
  if (typeof document === "undefined") return unavailable("DOM unavailable");

  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      failIfMajorPerformanceCaveat: true,
      powerPreference: "default",
      premultipliedAlpha: true,
      preserveDrawingBuffer: false
    });
    if (!gl) return unavailable("WebGL2 unavailable or blocked by Chromium");
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info") as {
      UNMASKED_RENDERER_WEBGL: number;
    } | null;
    const renderer = debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || "WebGL2")
      : String(gl.getParameter(gl.RENDERER) || "WebGL2");
    const highp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    cachedCapabilities = {
      webgl2: true,
      renderer,
      maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0,
      maxRenderbufferSize: Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || 0,
      maxSamples: Number(gl.getParameter(gl.MAX_SAMPLES)) || 0,
      highpFragment: Boolean(highp && highp.precision > 0),
      reason: ""
    };
    return cachedCapabilities;
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : "WebGL2 probe failed");
  } finally {
    if (gl) gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
