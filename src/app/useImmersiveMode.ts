import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayerStore } from "../stores/playerStore";

/**
 * Immersive (full-window visualizer) mode. With click-through enabled the
 * overlay controls hide after 3 s unless the pointer is over their sensor.
 */
export function useImmersiveMode({ clickThrough, onEnter }: { clickThrough: boolean; onEnter(): void }) {
  const [immersiveMode, setImmersiveMode] = useState(false);
  const [immersiveControlsVisible, setImmersiveControlsVisible] = useState(true);
  const immersiveHideTimer = useRef(0);
  const immersiveSensorHovered = useRef(false);
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;

  useEffect(() => {
    window.desktop?.setImmersive(immersiveMode);
    if (immersiveMode) onEnterRef.current();
    return () => window.desktop?.setImmersive(false);
  }, [immersiveMode]);
  const exitImmersiveMode = useCallback(() => {
    const current = usePlayerStore.getState();
    if (current.obsMode) current.setObsMode(false);
    setImmersiveMode(false);
  }, []);
  const cancelImmersiveHide = useCallback(() => {
    window.clearTimeout(immersiveHideTimer.current);
    immersiveHideTimer.current = 0;
  }, []);
  const scheduleImmersiveHide = useCallback(() => {
    cancelImmersiveHide();
    if (!immersiveMode || !clickThrough || immersiveSensorHovered.current) return;
    immersiveHideTimer.current = window.setTimeout(() => {
      if (!immersiveSensorHovered.current) setImmersiveControlsVisible(false);
    }, 3000);
  }, [cancelImmersiveHide, immersiveMode, clickThrough]);
  useEffect(() => {
    cancelImmersiveHide();
    setImmersiveControlsVisible(true);
    if (immersiveMode && clickThrough) scheduleImmersiveHide();
    return cancelImmersiveHide;
  }, [immersiveMode, clickThrough, cancelImmersiveHide, scheduleImmersiveHide]);

  return {
    immersiveMode, setImmersiveMode, immersiveControlsVisible, setImmersiveControlsVisible,
    immersiveSensorHovered, exitImmersiveMode, cancelImmersiveHide, scheduleImmersiveHide
  };
}
