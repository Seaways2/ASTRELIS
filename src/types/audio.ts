import type { FilmMetadata } from "../../electron/library/media/TmdbClient";
export type RepeatMode = "off" | "all" | "one";
export type VisualizerMode =
  | "overview"
  | "spectrum"
  | "mirror"
  | "waveform"
  | "radial"
  | "waterfall"
  | "particles"
  | "pulse"
  | "levels";

export type PageId = "nowPlaying" | "playlist" | "library" | "online" | "devices" | "plugins" | "appearance" | "settings";

export interface VisualizerSettings {
  fftSize: 512 | 1024 | 2048 | 4096 | 8192;
  smoothing: number;
  sensitivity: number;
  barCount: number;
  barOpacity: number;
  lineWidth: number;
  animationSpeed: number;
  decaySpeed: number;
  peakHoldMs: number;
  torusParticleCount: number;
  torusRadius: number;
  torusThickness: number;
  torusFlowSpeed: number;
  torusNoiseStrength: number;
  torusLowResponse: number;
  torusMidResponse: number;
  torusHighResponse: number;
  torusShockSpeed: number;
  torusTrailStrength: number;
  torusColorScheme: "ice" | "cyan" | "violet";
  ringTilt: number;
  holeSize: number;
  ringThicknessVariation: number;
  tangentialFlowSpeed: number;
  curlNoiseStrength: number;
  particleStretch: number;
  densityFalloff: number;
  asymmetry: number;
  impulsePropagationSpeed: number;
  bloomThreshold: number;
}

// Derived for rendering only; resource policy is owned by the system settings.
export interface VisualizerRenderSettings extends VisualizerSettings {
  readonly lowPerformance: boolean;
}

export interface Track {
  mediaKind?: "audio" | "video";
  id: string;
  mediaId?: string;
  albumId?: string;
  name: string;
  artist: string;
  album: string;
  url: string;
  format: string;
  size: number;
  coverUrl?: string;
  videoInfo?: string;
  coverLocked?: boolean;
  onlineMetadata?: FilmMetadata;
  nativePath?: string;
  sourcePath?: string;
  duration?: number;
  year?: number;
  genre?: string;
  folder?: string;
  location?: { rootId: string; sourcePath: string; canonicalPath: string };
  file?: { size: number; mtimeMs: number; fingerprint?: string };
  tags?: {
    title?: string;
    artists: Array<{ artistId: string; name: string }>;
    album?: string;
    albumArtist?: string;
    genres: string[];
    year?: number;
    trackNumber?: number;
    discNumber?: number;
    compilation?: boolean;
  };
}

export interface MeterSnapshot {
  left: number;
  right: number;
  peak: number;
  rms: number;
  low: number;
  mid: number;
  high: number;
  sampleRate: number;
}

export interface OutputDevice {
  id: string;
  label: string;
}
