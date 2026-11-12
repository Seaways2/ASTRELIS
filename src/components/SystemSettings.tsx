import { SectionHeading } from "./SectionHeading";
import { Hint } from "./Hint";
import { CacheSettings } from "./CacheSettings";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppWindow, ArrowUpRight, Gauge, Languages, Music2 } from "lucide-react";
import { usePlayerStore, type StartupPage } from "../stores/playerStore";
import { useI18n, type Language } from "../i18n";

function SettingRow({ id, title, hint, children, wide = false }: {
  id: string; title: string; hint: string; children: ReactNode; wide?: boolean;
}) {
  return <div className={`system-setting-row ${wide ? "system-setting-wide" : ""}`}>
    <label htmlFor={id}><span className="setting-title"><b>{title}</b><Hint id={`${id}-hint`}>{hint}</Hint></span></label>
    <div className="system-setting-control">{children}</div>
  </div>;
}

export function SystemSettings() {
  const state = usePlayerStore();
  const { t, language, setLanguage } = useI18n();
  const [preferences, setPreferences] = useState<DesktopPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ kind: "load" | "save"; detail?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const busyRef = useRef(false);
  const mounted = useRef(false);
  const api = window.desktop?.preferences;

  useEffect(() => {
    mounted.current = true;
    if (!api) return () => { mounted.current = false; };
    let cancelled = false;
    let receivedChange = false;
    setError(null);
    const unsubscribe = api.onChanged(value => {
      receivedChange = true;
      if (!cancelled) setPreferences(value);
    });
    void api.get().then(result => {
      if (cancelled) return;
      if (!receivedChange) setPreferences(result.preferences);
      setError(result.ok ? null : { kind: "load", detail: result.error });
    }).catch(() => { if (!cancelled) setError({ kind: "load" }); });
    return () => { cancelled = true; mounted.current = false; unsubscribe(); };
  }, [api, attempt]);

  const update = async (patch: Partial<DesktopPreferences>) => {
    if (!api || !preferences || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.update(patch);
      if (mounted.current) {
        setPreferences(result.preferences);
        setError(result.ok ? null : { kind: "save", detail: result.error });
      }
    } catch { if (mounted.current) setError({ kind: "save" }); }
    finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const unavailable = !api || !preferences || busy;
  const control = (id: string) => ({ id, "aria-describedby": `${id}-hint` });

  return <div className="system-settings">
    <p className="system-settings-intro">{t("settings.savedAutomatically")}</p>
    {(!api || error || !preferences) && <div className="system-settings-notice" role={error ? "alert" : "status"}>
      <span>{t(!api ? window.desktop ? "settings.restartRequired" : "settings.desktopOnly" : error ? error.kind === "load" ? "settings.loadFailed" : "settings.saveFailed" : "settings.loading")}
        {error?.detail && <small>{error.detail}</small>}
      </span>
      {api && error && <button type="button" onClick={() => setAttempt(value => value + 1)}>{t("settings.retry")}</button>}
    </div>}
    <div className="settings-layout">
      <section className="settings-section panel">
        <SectionHeading icon={Languages}>{t("settings.group.general")}</SectionHeading>
        <SettingRow id="system-language" title={t("settings.language")} hint={t("settings.languageHint")}>
          <select {...control("system-language")} value={language} onChange={event => setLanguage(event.target.value as Language)}>
            <option value="system">{t("language.system")}</option><option value="zh-CN">{t("language.zh")}</option><option value="en-US">{t("language.en")}</option><option value="ja-JP">{t("language.ja")}</option>
          </select>
        </SettingRow>
        <SettingRow id="system-startup" title={t("settings.startupPage")} hint={t("settings.startupPageHint")}>
          <select {...control("system-startup")} value={state.uiSettings.startupPage} onChange={event => state.setUiSetting("startupPage", event.target.value as StartupPage)}>
            {(["nowPlaying", "playlist", "library", "online"] as const).map(page => <option value={page} key={page}>{t(`nav.${page}`)}</option>)}
          </select>
        </SettingRow>
      </section>
      <section className="settings-section panel" aria-busy={busy}>
        <SectionHeading icon={AppWindow}>{t("settings.group.window")}</SectionHeading>
        <SettingRow id="system-top" title={t("settings.alwaysOnTop")} hint={t("settings.alwaysOnTopHint")}>
          <input {...control("system-top")} type="checkbox" disabled={unavailable} checked={preferences?.alwaysOnTop ?? false} onChange={event => void update({ alwaysOnTop: event.target.checked })} />
        </SettingRow>
        <SettingRow id="system-memory" title={t("settings.windowMemory")} hint={t("settings.memoryHint")}>
          <input {...control("system-memory")} type="checkbox" disabled={unavailable} checked={preferences?.rememberWindowState ?? true} onChange={event => void update({ rememberWindowState: event.target.checked })} />
        </SettingRow>
        <SettingRow id="system-close" title={t("settings.closeBehavior")} hint={t("settings.closeBehaviorHint")}>
          <select {...control("system-close")} disabled={unavailable} value={preferences?.closeBehavior ?? "tray"} onChange={event => void update({ closeBehavior: event.target.value as DesktopPreferences["closeBehavior"] })}>
            <option value="tray">{t("settings.close.tray")}</option><option value="quit">{t("settings.close.quit")}</option>
          </select>
        </SettingRow>
      </section>
      <section className="settings-section panel">
        <SectionHeading icon={Music2}>{t("settings.group.playback")}</SectionHeading>
        <SettingRow id="system-fade" title={t("settings.fade")} hint={t(state.uiSettings.lowPerformanceMode ? "settings.fadeSuspended" : "settings.fadeHint")} wide>
          <input {...control("system-fade")} disabled={state.uiSettings.lowPerformanceMode} type="range" min="0" max="3000" step="50" value={state.fadeMs} onDoubleClick={() => state.setFadeMs(350)} onChange={event => state.setFadeMs(Number(event.target.value))} />
          <output htmlFor="system-fade">{state.fadeMs === 0 ? t("settings.fadeOff") : `${state.fadeMs} ms`}</output>
        </SettingRow>
        <SettingRow id="system-media-keys" title={t("settings.mediaKeys")} hint={t("settings.mediaKeysHelp")}>
          <input {...control("system-media-keys")} type="checkbox" disabled={unavailable} checked={preferences?.mediaKeysEnabled ?? true} onChange={event => void update({ mediaKeysEnabled: event.target.checked })} />
        </SettingRow>
        <button type="button" className="system-settings-link" onClick={() => state.setActivePage("devices")}>{t("settings.outputOptions")}<ArrowUpRight /></button>
      </section>
      <section className="settings-section panel">
        <SectionHeading icon={Gauge}>{t("settings.group.performance")}</SectionHeading>
        <SettingRow id="system-performance" title={t("settings.performanceMode")} hint={t("settings.performanceModeHint")} wide>
          <select {...control("system-performance")} value={state.uiSettings.lowPerformanceMode ? "eco" : "full"} onChange={event => state.setUiSetting("lowPerformanceMode", event.target.value === "eco")}>
            <option value="full">{t("settings.performance.full")}</option><option value="eco">{t("settings.performance.eco")}</option>
          </select>
        </SettingRow>
        <button type="button" className="system-settings-link" onClick={() => state.setActivePage("appearance")}>{t("settings.visualOptions")}<ArrowUpRight /></button>
      </section>
      <CacheSettings />
    </div>
    <details className="system-runtime-info"><summary>{t("settings.runtimeInfo")}</summary><p>{t("settings.onlineInfo")}</p></details>
  </div>;
}
