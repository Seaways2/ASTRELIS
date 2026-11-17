import { X } from "lucide-react";
import { useI18n } from "../i18n";
import { usePlayerStore } from "../stores/playerStore";
import { Hint } from "../components/Hint";

/**
 * The 可视化调校 popover: analyser settings and how strongly the particle
 * scenes react. Double-click a slider to reset it.
 */
export function VisualTuningPanel({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const visualSettings = usePlayerStore(store => store.visualSettings);
  const setVisualSetting = usePlayerStore(store => store.setVisualSetting);
  const resetVisualSettings = usePlayerStore(store => store.resetVisualSettings);
  const state = { visualSettings, setVisualSetting, resetVisualSettings };
  return <div className="visual-settings-panel panel">
    <div className="visual-settings-title"><div><span className="eyebrow">VISUAL ENGINE</span><b>{t("visual.tune")}</b></div><button onClick={onClose}><X /></button></div>
    <label><span>{t("visual.fftSize")} <b>{state.visualSettings.fftSize}</b></span><select value={state.visualSettings.fftSize} onChange={(e) => state.setVisualSetting("fftSize", Number(e.target.value) as 512 | 1024 | 2048 | 4096 | 8192)}>{[512, 1024, 2048, 4096, 8192].map((size) => <option key={size}>{size}</option>)}</select></label>
    <label><span>{t("visual.smoothing")} <b>{state.visualSettings.smoothing.toFixed(2)}</b></span><input type="range" min="0" max=".98" step=".01" value={state.visualSettings.smoothing} onDoubleClick={() => state.setVisualSetting("smoothing", .76)} onChange={(e) => state.setVisualSetting("smoothing", Number(e.target.value))} /></label>
    <label><span>{t("visual.sensitivity")} <b>{state.visualSettings.sensitivity.toFixed(2)}×</b></span><input type="range" min=".5" max="2" step=".05" value={state.visualSettings.sensitivity} onDoubleClick={() => state.setVisualSetting("sensitivity", 1)} onChange={(e) => state.setVisualSetting("sensitivity", Number(e.target.value))} /></label>
    <label><span>{t("visual.bars")} <b>{state.visualSettings.barCount}</b></span><input type="range" min="24" max="160" step="2" value={state.visualSettings.barCount} onDoubleClick={() => state.setVisualSetting("barCount", 90)} onChange={(e) => state.setVisualSetting("barCount", Number(e.target.value))} /></label>
    <label><span>{t("visual.barOpacity")} <b>{Math.round(state.visualSettings.barOpacity * 100)}%</b></span><input type="range" min="0" max="1" step=".05" value={state.visualSettings.barOpacity} onDoubleClick={() => state.setVisualSetting("barOpacity", 1)} onChange={(e) => state.setVisualSetting("barOpacity", Number(e.target.value))} /></label>
    <label><span>{t("visual.lineWidth")} <b>{state.visualSettings.lineWidth.toFixed(1)}</b></span><input type="range" min=".5" max="4" step=".1" value={state.visualSettings.lineWidth} onDoubleClick={() => state.setVisualSetting("lineWidth", 1.5)} onChange={(e) => state.setVisualSetting("lineWidth", Number(e.target.value))} /></label>
    <label><span>{t("visual.speed")} <b>{state.visualSettings.animationSpeed.toFixed(2)}×</b></span><input type="range" min=".25" max="2" step=".05" value={state.visualSettings.animationSpeed} onDoubleClick={() => state.setVisualSetting("animationSpeed", 1)} onChange={(e) => state.setVisualSetting("animationSpeed", Number(e.target.value))} /></label>
    <label><span>{t("visual.decay")} <b>{state.visualSettings.decaySpeed.toFixed(2).replace(/0$/, "")}/s</b></span><input type="range" min=".05" max="1" step=".05" value={state.visualSettings.decaySpeed} onDoubleClick={() => state.setVisualSetting("decaySpeed", 1)} onChange={(e) => state.setVisualSetting("decaySpeed", Number(e.target.value))} /></label>
    <label><span>{t("visual.peakHold")} <b>{state.visualSettings.peakHoldMs} ms</b></span><input type="range" min="0" max="2000" step="50" value={state.visualSettings.peakHoldMs} onDoubleClick={() => state.setVisualSetting("peakHoldMs", 650)} onChange={(e) => state.setVisualSetting("peakHoldMs", Number(e.target.value))} /></label>
    {/* Galaxy, starfield and black hole: how strongly they react. Double-click resets a slider. */}
    <label><span>{t("visual.flash")} <b>{state.visualSettings.flashStrength.toFixed(2)}×</b></span><input type="range" min="0" max="2" step=".05" value={state.visualSettings.flashStrength} onDoubleClick={() => state.setVisualSetting("flashStrength", 1)} onChange={(e) => state.setVisualSetting("flashStrength", Number(e.target.value))} /></label>
    <label><span>{t("visual.glints")} <b>{state.visualSettings.glintAmount.toFixed(2)}×</b></span><input type="range" min="0" max="2" step=".05" value={state.visualSettings.glintAmount} onDoubleClick={() => state.setVisualSetting("glintAmount", 1)} onChange={(e) => state.setVisualSetting("glintAmount", Number(e.target.value))} /></label>
    <label><span>{t("visual.accentShare")} <b>{Math.round(state.visualSettings.accentShare * 100)}%</b></span><input type="range" min=".3" max=".95" step=".05" value={state.visualSettings.accentShare} onDoubleClick={() => state.setVisualSetting("accentShare", .65)} onChange={(e) => state.setVisualSetting("accentShare", Number(e.target.value))} /></label>
    <label className="visual-settings-toggle"><span>{t("visual.pointer")}<Hint>{t("visual.pointerHint")}</Hint></span><input type="checkbox" checked={state.visualSettings.pointerInteraction} onChange={(e) => state.setVisualSetting("pointerInteraction", e.target.checked)} /></label>
    <label><span>{t("visual.pointerStrength")} <b>{state.visualSettings.pointerStrength.toFixed(2)}×</b></span><input type="range" min=".25" max="2" step=".05" disabled={!state.visualSettings.pointerInteraction} value={state.visualSettings.pointerStrength} onDoubleClick={() => state.setVisualSetting("pointerStrength", 1)} onChange={(e) => state.setVisualSetting("pointerStrength", Number(e.target.value))} /></label>
    <button className="visual-reset" onClick={state.resetVisualSettings}>{t("visual.reset")}</button>
  </div>;
}
