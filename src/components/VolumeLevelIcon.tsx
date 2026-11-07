import { VolumeX } from "lucide-react";

export function VolumeLevelIcon({ volume, muted }: { volume: number; muted: boolean }) {
  if (muted || volume <= .001) return <VolumeX />;

  const db = 20 * Math.log10(volume);
  const waves = db > -30 ? 2 : db > -50 ? 1 : 0;
  const waveStyle = (index: number) => ({
    opacity: waves >= index ? 1 : 0,
    transition: "opacity 120ms ease"
  });

  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
    <path d="M15 9a5 5 0 0 1 0 6" style={waveStyle(1)} />
    <path d="M18 6a9 9 0 0 1 0 12" style={waveStyle(2)} />
  </svg>;
}
