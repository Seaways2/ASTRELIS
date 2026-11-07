import { useEffect, useRef, useState, type CSSProperties } from "react";
import { audioEngine } from "../audio/AudioEngine";
import type { MeterSnapshot } from "../types/audio";
import { useI18n } from "../i18n";
import { amplitudeToMeterPosition, formatMeterTick, METER_DB_TICKS } from "../utils/meterScale";
import { CdDeck } from "./CdDeck";

const empty: MeterSnapshot = { left: 0, right: 0, peak: 0, rms: 0, low: 0, mid: 0, high: 0, sampleRate: 0 };
const db = (value: number) => value > 0 ? `${(20 * Math.log10(value)).toFixed(1)} dB` : "−∞ dB";

export function MeterPanel({ format, device, coverUrl, name, playbackState, lowPerformance = false, visible = true }: { format: string; device: string; coverUrl?: string; name: string; playbackState: "playing" | "paused" | "stopped"; lowPerformance?: boolean; visible?: boolean }) {
  const { t } = useI18n();
  const [meter, setMeter] = useState(empty);
  const displayed = useRef(empty);
  useEffect(() => {
    const detach = audioEngine.on("analysisratechange", () => {
      const sampleRate = audioEngine.analysisSampleRate;
      if (displayed.current.sampleRate === sampleRate) return;
      displayed.current = { ...displayed.current, sampleRate };
      setMeter(displayed.current);
    });
    return () => { detach(); };
  }, []);
  useEffect(() => {
    if (!visible) return;
    let timer = 0;
    const tick = () => {
      const previous = displayed.current;
      const snapshot = audioEngine.meters();
      const target = playbackState === "playing" ? snapshot : { ...empty, sampleRate: snapshot.sampleRate };
      const follow = (key: keyof Pick<MeterSnapshot, "left" | "right" | "peak" | "rms" | "low" | "mid" | "high">) => {
        const speed = target[key] >= previous[key] ? .82 : .22;
        const value = previous[key] + (target[key] - previous[key]) * speed;
        return value < .0005 ? 0 : value;
      };
      const next = {
        left: follow("left"), right: follow("right"), peak: follow("peak"), rms: follow("rms"),
        low: follow("low"), mid: follow("mid"), high: follow("high"), sampleRate: target.sampleRate
      };
      if (Object.keys(next).some(key => next[key as keyof MeterSnapshot] !== previous[key as keyof MeterSnapshot])) {
        displayed.current = next;
        setMeter(next);
      }
      if (playbackState === "playing" || next.peak > 0 || next.rms > 0 || next.left > 0 || next.right > 0 || next.low > 0 || next.mid > 0 || next.high > 0)
        timer = window.setTimeout(tick, lowPerformance ? 240 : 50);
    };
    tick();
    return () => clearTimeout(timer);
  }, [lowPerformance, playbackState, visible]);

  return <aside className="meters">
    <CdDeck coverUrl={coverUrl} name={name} playbackState={playbackState} lowPerformance={lowPerformance} visible={visible} />
    <section className="panel meter-card">
      <div className="eyebrow">{t("meter.channelMonitor")}</div>
      {(["left", "right"] as const).map((side) => <div className="channel" key={side}>
        <span>{side === "left" ? "L" : "R"}</span>
        <div className="meter-track" style={{ "--meter-level": `${amplitudeToMeterPosition(meter[side])}%` } as CSSProperties}><i /></div>
        <b>{db(meter[side])}</b>
      </div>)}
      <div className="scale">{[...METER_DB_TICKS].reverse().map(tick => <span key={tick}>{formatMeterTick(tick)}</span>)}</div>
    </section>
    <section className="panel energy-panel">
      <div className="panel-head"><span className="eyebrow">{t("meter.signalEnergy")}</span><span>{t("meter.live")}</span></div>
      <div className="energy-grid">
        {[[t("meter.low"), meter.low], [t("meter.mid"), meter.mid], [t("meter.high"), meter.high]].map(([label, value]) =>
          <div className="energy" key={label as string}><div className="energy-ring" style={{ "--level": `${(value as number) * 360}deg` } as React.CSSProperties}><span>{Math.round((value as number) * 100)}</span></div><small>{label as string}</small></div>
        )}
      </div>
    </section>
    <section className="panel readouts">
      <div><span>{t("meter.peak")}</span><b>{db(meter.peak)}</b></div>
      <div><span>{t("meter.rms")}</span><b>{db(meter.rms)}</b></div>
    </section>
    <section className="panel data-panel">
      <div className="eyebrow">{t("meter.streamData")}</div>
      <dl>
        <div><dt>{t("meter.format")}</dt><dd>{format || "—"}</dd></div>
        <div><dt>{t("meter.sampleRate")}</dt><dd>{meter.sampleRate ? `${meter.sampleRate / 1000} kHz` : "—"}</dd></div>
        <div><dt>{t("meter.bitDepth")}</dt><dd>{t("meter.unavailable")}</dd></div>
        <div><dt>{t("meter.output")}</dt><dd title={device}>{device}</dd></div>
      </dl>
    </section>
  </aside>;
}
