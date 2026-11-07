import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
export type MatchPresentation = {background?:boolean;blocked?:boolean;onBackground?():void;onForeground?():void};
export function MatchTaskDock({title,busy,done,total,blocked,onOpen,onStop,onClose}:{title:string;busy:boolean;done:number;total:number;blocked?:boolean;onOpen?():void;onStop?():void;onClose():void}) {
  const {t}=useI18n();
  return createPortal(<aside className="match-task-dock" aria-label={t("match.backgroundTask")}>
    <strong>{title}</strong><span role="status" aria-live="polite">{blocked?t("match.locked"):t(busy?"match.running":"match.ready")}</span>
    {total>0&&!blocked&&<><progress aria-label={t("music.matchProgress")} max={total} value={done}/><small>{t("music.processed",{done,total})}</small></>}
    <div><button disabled={blocked} onClick={onOpen}>{t("match.open")}</button>{busy&&onStop&&<button onClick={onStop}>{t("media.stop")}</button>}{!busy&&<button onClick={onClose}>{t("media.close")}</button>}</div>
  </aside>,document.querySelector(".app-shell")||document.body);
}
