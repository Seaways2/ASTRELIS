import { useEffect, useRef, useState } from "react";
import { Disc3 } from "lucide-react";
import { audioEngine } from "../audio/AudioEngine";

type PlaybackState = "playing" | "paused" | "stopped";
const idleBars = Array.from({ length: 22 }, () => .04);

export function CdDeck({ coverUrl, name, playbackState, lowPerformance = false, visible = true }: { coverUrl?: string; name: string; playbackState: PlaybackState; lowPerformance?: boolean; visible?: boolean }) {
  const [energy, setEnergy] = useState(0);
  const [bars, setBars] = useState(idleBars);
  const displayed = useRef({ energy: 0, bars: idleBars });
  useEffect(() => {
    if (!visible) return;
    let timer = 0;
    const follow = (value: number, target: number, attack: number, release: number) => {
      const next = value + (target - value) * (target > value ? attack : release);
      return Math.abs(next - target) < .0005 ? target : next;
    };
    const tick = () => {
      const active = playbackState === "playing";
      const meter = active ? audioEngine.meters() : null;
      const frequency = active ? audioEngine.getFrequencyData() : null;
      const targetEnergy = meter ? Math.min(1, meter.low * .65 + meter.rms * 2.2 + meter.peak * .15) : 0;
      const previous = displayed.current;
      const nextEnergy = follow(previous.energy, targetEnergy, .62, .2);
      const nextBars = previous.bars.map((value, index) => {
        if (!frequency?.length) return follow(value, .04, .25, .25);
        const normalized = index / Math.max(1, previous.bars.length - 1);
        const sourceIndex = Math.min(frequency.length - 1, Math.floor(Math.pow(normalized, 1.55) * frequency.length * .72));
        const target = Math.max(.04, (frequency[sourceIndex] || 0) / 255);
        return follow(value, target, .64, .2);
      });
      if (nextEnergy !== previous.energy) setEnergy(nextEnergy);
      if (nextBars.some((value, index) => value !== previous.bars[index])) setBars(nextBars);
      displayed.current = { energy: nextEnergy, bars: nextBars };
      if (active || nextEnergy > 0 || nextBars.some(value => value !== .04))
        timer = window.setTimeout(tick, lowPerformance ? 280 : 70);
    };
    tick();
    return () => clearTimeout(timer);
  }, [playbackState, lowPerformance, visible]);

  return <section className={`cd-deck panel ${playbackState}`} style={{
    "--pulse": energy,
    "--pulse-size": `${energy * 24}px`,
    "--pulse-scale": 1 + energy * .06
  } as React.CSSProperties}>
    <div className="cd-deck-head"><span className="eyebrow">OPTICAL DECK</span><b>{playbackState === "playing" ? "SPINNING" : playbackState === "paused" ? "PAUSED" : "STOPPED"}</b></div>
    <div className="cd-stage">
      <div className="cd-scene">
      <div className="cd-radar"><i /><i /><i /></div>
      <div className="cd-disc">
        <div className="cd-surface">
          {coverUrl ? <img src={coverUrl} alt="" /> : <div className="cover-fallback"><Disc3 /></div>}
          <span className="disc-ring ring-one" /><span className="disc-ring ring-two" /><span className="disc-hole" />
        </div>
      </div>
      <div className="laser-arm"><i /></div>
      </div>
    </div>
    <div className="cd-track-name" title={name || "NO MEDIA"}>{name || "NO MEDIA"}</div>
    <div className="cd-spectrum" aria-hidden="true">{bars.map((bar, index) => <i key={index} style={{ "--bar": bar } as React.CSSProperties} />)}</div>
  </section>;
}
