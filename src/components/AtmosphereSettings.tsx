import { useAtmosphereStore } from "../stores/atmosphereStore";
import { type AtmosphereSettings as Settings } from "../utils/atmosphere";
import { useI18n } from "../i18n";
import { Hint } from "./Hint";
type Section = "glass" | "music" | "motion";
const keys: Record<Section, Array<keyof Omit<Settings, "intensity" | "response">>> = {
  glass: ["glassEdges"], music: ["coverColors", "orbitParticles"], motion: ["trackTransition"]
};
export function AtmosphereSettings({ lowPerformance, section }: { lowPerformance: boolean; section: Section }) {
  const { settings, update } = useAtmosphereStore();
  const { t } = useI18n();
  return <div className="appearance-effects">
    {section === "music" && lowPerformance && <p role="status">{t("fx.eco")}</p>}
    {keys[section].map(key => <div key={key}>
      <label className="appearance-effect-row"><span className="setting-title"><b>{t(`fx.${key}`)}</b><Hint>{t(`fx.${key}Hint`)}</Hint></span>
        <input type="checkbox" checked={settings[key]} onChange={event => update({ [key]: event.target.checked })} />
      </label>
      {key === "glassEdges" && <label className="atmosphere-strength"><span>{t("fx.response")}</span><input aria-label={t("fx.response")} disabled={!settings.glassEdges || lowPerformance} type="range" min="0" max="3" step=".1" value={settings.response} onChange={event => update({ response: Number(event.target.value) })} /><output>{settings.response.toFixed(1)}×</output></label>}
    </div>)}
    {section === "glass" && <label className="atmosphere-strength"><span>{t("fx.intensity")}</span><input aria-label={t("fx.intensity")} type="range" min="0" max="1" step=".05" value={settings.intensity} onChange={event => update({ intensity: Number(event.target.value) })} /><output>{Math.round(settings.intensity * 100)}%</output></label>}
    {section === "motion" && <p className="atmosphere-note">{t("fx.motionHint")}</p>}
  </div>;
}
