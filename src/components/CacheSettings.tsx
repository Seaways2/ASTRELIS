import { SectionHeading } from "./SectionHeading";
import { useEffect, useState } from "react";
import { HardDrive, RefreshCw, Trash2 } from "lucide-react";
import { useI18n } from "../i18n";

const size = (bytes = 0) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
type Snapshot = { path?: string; bytes?: number; decodedBytes?: number; directBytes?: number; protectedBytes?: number; busy?: boolean };
export function CacheSettings() {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<Snapshot>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const api = window.desktop?.cache;
  const refresh = async () => {
    if (!api) return;
    setBusy(true);
    try {
      const result = await api.inspect();
      if (!result.ok) throw new Error(result.error);
      setSnapshot(result);
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loads the cache usage once on mount
  useEffect(() => { void refresh(); }, []);
  const clear = async () => {
    if (!api || busy) return;
    setBusy(true);
    setConfirm(false);
    try {
      const result = await api.clear();
      if (!result.ok) throw new Error(result.error);
      setMessage(`${t("cache.freed")}: ${size(result.removedBytes)} · ${t("cache.protected")}: ${size(result.skippedBytes)}${result.failedFiles ? ` · ${t("cache.failed")}: ${result.failedFiles}` : ""}`);
      const latest = await api.inspect();
      if (latest.ok) setSnapshot(latest);
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  };
  return <section className="settings-section panel cache-settings" aria-busy={busy}>
    <SectionHeading icon={HardDrive} hint={t("cache.hint")}>{t("cache.title")}</SectionHeading>
    <dl><div><dt>{t("cache.decoded")}</dt><dd>{size(snapshot.decodedBytes)}</dd></div>
      <div><dt>{t("cache.direct")}</dt><dd>{size(snapshot.directBytes)}</dd></div>
      <div><dt>{t("cache.total")}</dt><dd>{size(snapshot.bytes)}</dd></div></dl>
    <small className="cache-path">{snapshot.path}</small>
    <div className="cache-actions">
      <button type="button" disabled={!api || busy} onClick={() => void refresh()}><RefreshCw size={15} />{t("cache.refresh")}</button>
      <button type="button" disabled={!api || busy || snapshot.busy || !snapshot.bytes} onClick={() => setConfirm(true)}><Trash2 size={15} />{t("cache.clear")}</button>
    </div>
    {snapshot.busy && <p role="status">{t("cache.busy")}</p>}
    {confirm && <div className="cache-confirm"><p>{t("cache.confirm")}</p><div className="cache-actions">
      <button type="button" onClick={() => void clear()}>{t("cache.clear")}</button>
      <button type="button" onClick={() => setConfirm(false)}>{t("cache.cancel")}</button>
    </div></div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
