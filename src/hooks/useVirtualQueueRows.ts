import { useLayoutEffect, useRef, useState } from "react";
import { virtualQueueRange } from "../utils/virtualQueueRange";

/** Fixed-height queue rows, using the same scroll/resize + RAF approach as the library. */
export function useVirtualQueueRows(total: number, rowHeight: number, scrollerSelector: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  useLayoutEffect(() => {
    const container = containerRef.current;
    const scroller = container?.closest<HTMLElement>(scrollerSelector);
    if (!container || !scroller) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = Math.max(0, scroller.getBoundingClientRect().top - container.getBoundingClientRect().top);
        const height = scroller.clientHeight;
        setViewport(current => current.top === top && current.height === height ? current : { top, height });
      });
    };
    measure();
    scroller.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [scrollerSelector]);
  return { containerRef, ...virtualQueueRange(total, rowHeight, viewport.top, viewport.height) };
}
