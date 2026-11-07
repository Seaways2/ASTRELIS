import { useEffect, useRef, useState } from "react";
import { audioEngine } from "../audio/AudioEngine";
import { useI18n } from "../i18n";
import { cachedWaveform, cacheWaveform, keyboardSeek, readPreviewBytes, scheduleWaveform } from "../utils/waveformPreview";

interface Props {
  url?: string;
  sourcePath?: string;
  currentTime: number;
  duration: number;
  accent: string;
  liveKey?: string;
  lowPerformance?: boolean;
  readOnly?: boolean;
  livePlaying?: boolean;
  videoHandle?: boolean;
  onSeek(time: number): void;
}

const timeLabel = (value: number) => {
  const seconds = Math.max(0, Math.floor(value || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export function WaveformTimeline({ url, sourcePath, currentTime, duration, accent, liveKey, lowPerformance = false, readOnly = false, livePlaying = true, videoHandle = false, onSeek }: Props) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const [peaks, setPeaks] = useState<Float32Array>(() => new Float32Array(0));
  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const [sizeRevision, setSizeRevision] = useState(0);
  const hasDuration = Number.isFinite(duration) && duration > 0;
  const seekable = !readOnly && hasDuration;
  const shownTime = Math.max(0, Math.min(hasDuration ? duration : 0, previewTime ?? currentTime));
  const timingRef = useRef({ currentTime, duration, livePlaying });
  timingRef.current = { currentTime, duration, livePlaying };

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const requestId = crypto.randomUUID();
    setPeaks(new Float32Array(0));
    if (lowPerformance) {
      setPeaks(new Float32Array(0));
      return;
    }
    if (!url) {
      // Online samples belong to this mounted song session, not a title cache.
      setPeaks(new Float32Array(720));
      return;
    }
    const prepare = async () => {
      // The desktop service reads bounded PCM chunks and versions its cache by
      // the source file. A stable media URL must not conceal changed audio.
      if (sourcePath && window.desktop?.library.waveform) {
        const result = await window.desktop.library.waveform(sourcePath, requestId).catch(() => null);
        signal.throwIfAborted();
        if (result?.ok && Array.isArray(result.peaks) && result.peaks.length === 720
          && result.peaks.every(value => Number.isFinite(value) && value >= 0)) {
          setPeaks(Float32Array.from(result.peaks, value => Math.min(1, value)));
          return;
        }
      }
      // Preserve browser/blob playback and the existing decoder as a fallback.
      const cached = cachedWaveform(url);
      if (cached) { setPeaks(cached); return; }
      await scheduleWaveform(signal, async () => {
        let context: AudioContext | undefined;
        try {
          const response = await fetch(url, { signal });
          const bytes = await readPreviewBytes(response, signal);
          signal.throwIfAborted();
          context = new AudioContext();
          const buffer = await context.decodeAudioData(bytes);
          signal.throwIfAborted();
          const bins = 720;
          const result = new Float32Array(bins);
          const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
          const stride = Math.max(1, Math.floor(buffer.length / bins));
          for (let bin = 0; bin < bins; bin++) {
            const from = bin * stride;
            const to = Math.min(buffer.length, from + stride);
            let peak = 0;
            for (let sample = from; sample < to; sample += Math.max(1, Math.floor(stride / 96)))
              for (const channel of channels) peak = Math.max(peak, Math.abs(channel[sample] || 0));
            result[bin] = peak;
          }
          cacheWaveform(url, result);
          setPeaks(result);
        } catch {
          if (!signal.aborted) setPeaks(new Float32Array(0));
        } finally {
          if (context && context.state !== "closed") await context.close().catch(() => undefined);
        }
      });
    };
    void prepare().catch(() => { if (!signal.aborted) setPeaks(new Float32Array(0)); });
    return () => {
      controller.abort();
      if (sourcePath) window.desktop?.library.cancelWaveform?.(sourcePath, requestId);
    };
  }, [url, sourcePath, liveKey, lowPerformance]);

  useEffect(() => {
    draggingRef.current = false;
    pendingSeekRef.current = null;
    setPreviewTime(null);
  }, [url, liveKey]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const observer = new ResizeObserver(() => setSizeRevision(value => value + 1));
    observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (lowPerformance || url || !liveKey) return;
    const livePeaks = new Float32Array(720);
    const timer = window.setInterval(() => {
      const timing = timingRef.current;
      if (!timing.duration || !timing.livePlaying) return;
      const index = Math.max(0, Math.min(livePeaks.length - 1, Math.floor(timing.currentTime / timing.duration * livePeaks.length)));
      const meter = audioEngine.meters();
      livePeaks[index] = Math.max(livePeaks[index], meter.peak, meter.rms * 2.2);
      // Fill tiny gaps caused by media-position updates arriving slower than
      // analysis packets, while retaining only measured values.
      if (index > 0 && livePeaks[index - 1] === 0) livePeaks[index - 1] = livePeaks[index];
      setPeaks(new Float32Array(livePeaks));
    }, 80);
    return () => window.clearInterval(timer);
  }, [url, liveKey, lowPerformance]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio, 1.6);
    canvas.width = Math.max(1, Math.round(box.width * ratio));
    canvas.height = Math.max(1, Math.round(box.height * ratio));
    const context = canvas.getContext("2d")!;
    const width = canvas.width, height = canvas.height, middle = height / 2;
    const played = duration > 0 ? Math.max(0, Math.min(1, shownTime / duration)) : 0;
    context.clearRect(0, 0, width, height);
    if (lowPerformance || !peaks.some(value => value > 0)) {
      context.fillStyle = "rgba(218, 228, 230, .18)";
      context.fillRect(0, Math.max(0, middle - ratio), width, Math.max(1, ratio * 2));
      context.fillStyle = accent;
      context.fillRect(0, Math.max(0, middle - ratio), width * played, Math.max(1, ratio * 2));
      return;
    }
    context.lineWidth = Math.max(1, ratio);
    for (let x = 0; x < width; x++) {
      const index = peaks.length ? Math.min(peaks.length - 1, Math.floor(x / width * peaks.length)) : 0;
      const measured = peaks.length ? peaks[index] : 0;
      const level = measured > 0 ? Math.max(.035, measured) : .018;
      const amplitude = level * middle * .88;
      context.strokeStyle = x / width <= played && measured > 0 ? accent : "rgba(218, 228, 230, .50)";
      context.beginPath();
      context.moveTo(x + .5, middle - amplitude);
      context.lineTo(x + .5, middle + amplitude);
      context.stroke();
    }
  }, [peaks, shownTime, duration, accent, lowPerformance, sizeRevision]);

  const positionAt = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!seekable) return null;
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width) return null;
    return Math.max(0, Math.min(duration, (event.clientX - box.left) / box.width * duration));
  };

  const cancelSeek = () => {
    draggingRef.current = false;
    pendingSeekRef.current = null;
    setPreviewTime(null);
  };

  return <div className="waveform-control">
  {previewTime !== null && <output className="waveform-preview" aria-hidden="true"
    style={{ left: `clamp(28px, ${seekable ? shownTime / duration * 100 : 0}%, calc(100% - 28px))` }}>{timeLabel(shownTime)}</output>}
  {videoHandle && hasDuration && <span className="video-seek-handle" aria-hidden="true"
    style={{ left: `clamp(7px, ${shownTime / duration * 100}%, calc(100% - 7px))`, backgroundColor: accent }} />}
  <canvas
    ref={canvasRef}
    className="waveform-timeline"
    role={readOnly ? "progressbar" : "slider"}
    tabIndex={seekable ? 0 : -1}
    aria-label={t("timeline.seek")}
    aria-disabled={!seekable}
    aria-valuemin={0}
    aria-valuemax={hasDuration ? duration : 0}
    aria-valuenow={shownTime}
    aria-valuetext={`${timeLabel(shownTime)} / ${timeLabel(duration)}`}
    title={readOnly ? "请在 YouTube 网页调整播放进度" : t("timeline.help")}
    onBlur={event => { delete event.currentTarget.dataset.pointerFocus; }}
    onKeyDown={event => {
      delete event.currentTarget.dataset.pointerFocus;
      if (readOnly) return;
      if (event.key === "Escape") { cancelSeek(); return; }
      const target = keyboardSeek(event.key, currentTime, duration, event.shiftKey);
      if (target === null) return;
      event.preventDefault();
      event.stopPropagation();
      onSeek(target);
    }}
    onPointerDown={(event) => {
      if (event.button !== 0 || !seekable) return;
      event.preventDefault();
      event.currentTarget.dataset.pointerFocus = "true";
      event.currentTarget.focus({ preventScroll: true });
      draggingRef.current = true;
      pendingSeekRef.current = positionAt(event);
      setPreviewTime(pendingSeekRef.current);
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      if (draggingRef.current) {
        pendingSeekRef.current = positionAt(event);
        setPreviewTime(pendingSeekRef.current);
      }
    }}
    onPointerUp={(event) => {
      if (!draggingRef.current) return;
      const target = positionAt(event);
      cancelSeek();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (target !== null) onSeek(target);
    }}
    onPointerCancel={cancelSeek}
    onLostPointerCapture={cancelSeek}
  />
  </div>;
}
