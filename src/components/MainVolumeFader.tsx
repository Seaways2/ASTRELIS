import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { dbToMeterPosition, METER_DB_TICKS, METER_MINOR_DB_TICKS } from "../utils/meterScale";
import {
  advanceFaderDrag, amplitudeToFaderPosition, faderPositionToAmplitude,
  amplitudeToFaderPercent, formatFaderDb, nudgeFaderAmplitude, FADER_CAP_HEIGHT, type FaderDragState
} from "../utils/volumeFaderScale";
import { useI18n } from "../i18n";

interface Props {
  volume: number;
  muted: boolean;
  restoreVolume: number;
  disabled?: boolean;
  onVolume(value: number): void;
  onMuted(muted: boolean): void;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function MainVolumeFader({ volume, muted, restoreVolume, disabled = false, onVolume, onMuted }: Props) {
  const { t } = useI18n();
  const drag = useRef<FaderDragState | null>(null);
  const effective = muted ? 0 : volume;
  const position = amplitudeToFaderPosition(effective);
  const percent = amplitudeToFaderPercent(effective);

  const commit = (next: number) => {
    if (disabled) return;
    const value = clamp(next);
    onVolume(value);
    if (value <= .001) onMuted(true);
    else if (muted) onMuted(false);
  };
  const setFromPointer = (event: PointerEvent<HTMLDivElement>, phase: "start" | "move" | "end") => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const target = clamp((bounds.bottom - event.clientY) / bounds.height);
    const current = drag.current ?? { position: amplitudeToFaderPosition(effective), detent: null };
    const next = advanceFaderDrag(current, target, phase !== "move");
    drag.current = phase === "end" ? null : next;
    commit(faderPositionToAmplitude(next.position));
  };
  const nudge = (delta: number) => commit(nudgeFaderAmplitude(muted ? restoreVolume : volume, delta));
  const handleKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") { event.preventDefault(); nudge(event.shiftKey ? 3 : 1); }
    else if (event.key === "ArrowDown" || event.key === "ArrowLeft") { event.preventDefault(); nudge(event.shiftKey ? -3 : -1); }
    else if (event.key === "Home") { event.preventDefault(); commit(0); }
    else if (event.key === "End") { event.preventDefault(); commit(1); }
  };

  return <div
    className="channel-fader-track"
    role="slider"
    tabIndex={disabled ? -1 : 0}
    aria-label={t("channel.mainVolume")}
    aria-disabled={disabled}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={percent}
    aria-valuetext={`${percent}%，${formatFaderDb(effective)} dB`}
    onKeyDown={handleKeys}
    onWheel={event => { if (disabled) return; event.preventDefault(); nudge(event.deltaY < 0 ? 1 : -1); }}
    onDoubleClick={() => { if (disabled) return; commit(1); onMuted(false); }}
    onPointerDown={event => {
      if (disabled || event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setFromPointer(event, "start");
    }}
    onPointerMove={event => { if (drag.current) setFromPointer(event, "move"); }}
    onPointerUp={event => {
      if (!drag.current) return;
      setFromPointer(event, "end");
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={() => { drag.current = null; }}
  >
    <div className="channel-fader-fill" style={{ height: `${position * 100}%` }} />
    <div className="channel-fader-ticks" aria-hidden="true">
      {METER_MINOR_DB_TICKS.map(tick => <span className="minor" key={tick} style={{ bottom: `${dbToMeterPosition(tick)}%` }} />)}
      {METER_DB_TICKS.map(tick => <span className="major" key={tick} style={{ bottom: `${dbToMeterPosition(tick)}%` }} />)}
    </div>
    <div className="channel-fader-cap" style={{ bottom: `calc(${position * 100}% - ${FADER_CAP_HEIGHT / 2}px)` }}><i /></div>
  </div>;
}
