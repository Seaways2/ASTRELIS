import { useEffect, useState } from "react";

/** Window and system state pushed from the browser and the main process. */
export function useWindowPresence() {
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const [windowBackgrounded, setWindowBackgrounded] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [clickThrough, setClickThrough] = useState(false);
  const [systemLight, setSystemLight] = useState(() => window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false);

  useEffect(() => {
    const updateVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);
  useEffect(() => window.desktop?.onPresentationState(state => {
    setWindowBackgrounded(state.minimized || state.trayConcealed);
  }), []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const update = () => setSystemLight(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => window.desktop?.onClickThrough(setClickThrough), []);
  useEffect(() => window.desktop?.onMaximized(setMaximized), []);

  return { pageVisible, windowBackgrounded, maximized, clickThrough, setClickThrough, systemLight };
}
