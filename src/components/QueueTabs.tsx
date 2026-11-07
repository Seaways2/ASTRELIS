import { Film, Music2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { usePlayerStore } from "../stores/playerStore";
import { useI18n } from "../i18n";
export function QueueTabs() {
  const { kind, playingKind, active, inactive, viewQueue } = usePlayerStore(useShallow(s => ({ kind: s.viewedQueueKind, playingKind: s.queueKind, active: s.tracks.length, inactive: s.inactiveTracks.length, viewQueue: s.viewQueue })));
  const { t } = useI18n();
  return <div className="queue-type-tabs">{(["music", "video"] as const).map(value => <button key={value} type="button" aria-pressed={kind === value} onClick={() => viewQueue(value)}>{value === "music" ? <Music2 /> : <Film />}<span>{t(value === "music" ? "library.media.audio" : "library.media.video")}</span><small>{playingKind === value ? active : inactive}</small></button>)}</div>;
}
