import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type VirtualLibraryView = "large" | "cards" | "details" | "mosaic";

interface VirtualMetrics {
  key: string;
  columns: number;
  rowHeight: number;
  gap: number;
  startRow: number;
  endRow: number;
  totalHeight: number;
}

const metricsFor = (view: VirtualLibraryView, width: number) => {
  if (view === "details") return { columns: 1, rowHeight: 64, gap: 6 };
  if (view === "mosaic") {
    const boardWidth = Math.max(1, width);
    const gap = 12;
    const columns = boardWidth < 560 ? 2 : boardWidth < 900 ? 4 : 6;
    const rows = columns === 6 ? 3 : 5;
    const cell = (boardWidth - gap * (columns - 1)) / columns;
    return { columns: 10, rowHeight: Math.ceil(cell * rows + gap * (rows - 1)), gap: 18 };
  }
  const minWidth = view === "large" ? 245 : 320;
  const gap = view === "large" ? 16 : 12;
  const rowHeight = view === "large" ? 350 : 132;
  return { columns: Math.max(1, Math.floor((Math.max(1, width) + gap) / (minWidth + gap))), rowHeight, gap };
};

export function useVirtualLibraryGrid(total: number, view: VirtualLibraryView, resetKey: string, session?: { scrollTop: number }, fullscreen = false) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeScroller = useRef<HTMLElement | null>(null);
  const previousResetKey = useRef(resetKey);
  const restoreScroll = useRef<number | null>(session?.scrollTop ?? 0);
  const [metrics, setMetrics] = useState<VirtualMetrics>(() => ({
    key: "",
    ...metricsFor(view, 1000),
    startRow: 0,
    endRow: 5,
    totalHeight: 0
  }));

  useLayoutEffect(() => {
    const container = containerRef.current;
    const scroller = fullscreen
      ? container?.closest<HTMLElement>(".library-fullscreen-scroll")
      : container?.closest<HTMLElement>(".page-content");
    if (!container || !scroller) return;
    if (activeScroller.current && activeScroller.current !== scroller) {
      if (session) session.scrollTop = activeScroller.current.scrollTop;
      restoreScroll.current = session?.scrollTop ?? 0;
      scroller.scrollTop = restoreScroll.current;
    }
    activeScroller.current = scroller;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const sizing = metricsFor(view, container.clientWidth);
        const rowCount = Math.ceil(total / sizing.columns);
        const totalHeight = rowCount ? rowCount * (sizing.rowHeight + sizing.gap) - sizing.gap : 0;
        const containerRect = container.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        const visibleTop = Math.max(0, scrollerRect.top - containerRect.top);
        const visibleBottom = Math.min(totalHeight, visibleTop + scroller.clientHeight);
        const stride = sizing.rowHeight + sizing.gap;
        const overscan = 2;
        const startRow = Math.max(0, Math.floor(visibleTop / stride) - overscan);
        const visibleEnd = totalHeight ? Math.floor(Math.max(0, visibleBottom - 1) / stride) : -1;
        const endRow = Math.min(rowCount - 1, Math.max(startRow, visibleEnd + overscan));
        setMetrics(current => current.key === resetKey && current.columns === sizing.columns && current.rowHeight === sizing.rowHeight
          && current.gap === sizing.gap && current.startRow === startRow && current.endRow === endRow
          && current.totalHeight === totalHeight ? current
          : { key: resetKey, ...sizing, startRow, endRow, totalHeight });
      });
    };
    if (previousResetKey.current !== resetKey) {
      restoreScroll.current = session?.scrollTop ?? 0;
      previousResetKey.current = resetKey;
    }
    update();
    const onScroll = () => {
      if (session && restoreScroll.current === null) session.scrollTop = scroller.scrollTop;
      update();
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(container);
    resizeObserver.observe(scroller);
    return () => {
      if (session) session.scrollTop = scroller.scrollTop;
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
    };
  }, [resetKey, total, view, session, fullscreen]);

  // Wait for the virtual body height to commit before restoring its scroll offset.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const scroller = fullscreen
      ? container?.closest<HTMLElement>(".library-fullscreen-scroll")
      : container?.closest<HTMLElement>(".page-content");
    if (!scroller || metrics.key !== resetKey || restoreScroll.current === null) return;
    scroller.scrollTop = restoreScroll.current;
    restoreScroll.current = null;
    if (session) session.scrollTop = scroller.scrollTop;
    scroller.dispatchEvent(new Event("scroll"));
  }, [metrics.key, metrics.totalHeight, resetKey, session, fullscreen]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.dataset.virtualItemCount = String(Math.max(0, (metrics.endRow - metrics.startRow + 1) * metrics.columns));
  }, [metrics]);

  const offset = total && metrics.endRow >= metrics.startRow ? metrics.startRow * metrics.columns : 0;
  const limit = total && metrics.endRow >= metrics.startRow
    ? Math.min(total - offset, (metrics.endRow - metrics.startRow + 1) * metrics.columns)
    : 0;
  return { containerRef, ...metrics, offset, limit };
}
