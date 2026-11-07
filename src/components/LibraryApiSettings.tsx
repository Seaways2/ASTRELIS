import { useI18n } from "../i18n";
import { useState } from "react";
import { createPortal } from "react-dom";
import { KeyRound, X } from "lucide-react";

type Props = {
  initialService?: "tmdb" | "musicbrainz";
  configured: boolean;
  onClose(): void;
  onSaved(): void;
  onChanged(value: boolean): void;
};

/** Credentials belong to the application, never to an individual library entry. */
export function LibraryApiSettings({ configured, onClose, onSaved, onChanged, initialService = "tmdb" }: Props) {
  const { t, tm } = useI18n();
  const [service, setService] = useState(initialService);
  const [token, setToken] = useState("");
  const [editing, setEditing] = useState(!configured);
  // This fixed display mask is never assigned to token or returned by the credential store.
  const showingSaved = configured && !editing && !token;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function call(request: Record<string, unknown>) {
    const result = await window.desktop?.library.tmdb(request);
    if (!result?.ok) throw new Error(result?.error || t("media.serviceUnavailable"));
  }

  async function run(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await task(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  return createPortal(<div className="library-artwork-backdrop library-api-backdrop" onKeyDown={event => {
    // Portals still bubble through the film dialog; keep its focus trap and Escape isolated.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (!busy) onClose();
    }
    if (event.key === "Tab") {
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),select:not(:disabled)")];
      const first = items[0], last = items.at(-1);
      if (!first) event.preventDefault();
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }}>
    <section className="library-artwork-dialog library-api-settings" role="dialog" aria-modal="true" aria-label={t("media.apiTitle")}>
      <header><b><KeyRound aria-hidden="true" /><span>{t("media.apiTitle")}</span></b><button autoFocus={configured} disabled={busy} aria-label={t("media.backToMatch")} onClick={onClose}><X /></button></header>
      <label>{t("music.service")} <select className="api-service-select" aria-label={t("music.service")} disabled={busy} value={service} onChange={e=>{setService(e.target.value as "tmdb"|"musicbrainz");setToken("");setEditing(false);setError("");}}><option value="tmdb">{t("music.tmdb")}</option><option value="musicbrainz">{t("music.musicbrainz")}</option></select></label>
      {service === "musicbrainz" ? <><p>{t("music.publicApi")}</p><p role="status">{t("music.ready")}</p><button onClick={onClose}>{t("media.backToMatch")}</button></> : <>
      <p>{t("media.apiHint")}</p>
      <form onSubmit={event => {
        event.preventDefault();
        if (!token.trim()) return;
        void run(async () => {
          await call({ action: "credentials", token: token.trim() });
          setToken("");
          onChanged(true);
          onSaved();
        });
      }}>
        <label>TMDB API Key / Read Access Token
          <input autoFocus={!configured} aria-label={t("media.apiCredential")} type="password" autoComplete="off" disabled={busy} value={showingSaved ? "••••••••••••••••" : token}
            onClick={() => setEditing(true)} onFocus={() => setEditing(true)} onBlur={() => { if (!token) setEditing(false); }}
            onChange={event => setToken(event.target.value)} placeholder={configured ? t("media.apiReplace") : t("media.apiInput")} />
        </label>
        <div className="library-artwork-actions">
          <button type="submit" disabled={busy || !token.trim()}>{t("media.apiSave")}</button>
          <button type="button" disabled={busy} onClick={() => void run(() => call({ action: "account" }))}>{t("media.apiGet")}</button>
          {configured && <button type="button" disabled={busy} onClick={() => void run(async () => {
            await call({ action: "credentials", token: "" });
            setToken("");
            onChanged(false);
          })}>{t("media.apiClear")}</button>}
          <button type="button" disabled={busy} onClick={onClose}>{t("media.backToMatch")}</button>
        </div>
      </form>
      <p role="status">{busy ? t("media.working") : tm(error) || (configured ? t("media.apiShared") : t("media.apiUnset"))}</p>
      </>}
    </section>
  </div>, document.querySelector(".app-shell") || document.body);
}
