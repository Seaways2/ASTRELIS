import { CoverFlowWheel } from "../utils/coverFlowWheel";
import { useEffect, useLayoutEffect, useRef, type ReactNode, type MouseEvent } from "react";
import "./MediaFlow.css";
export function MediaFlow({ count, selected, offset, navigationKey, zoom = 1, visibleRadius = 3, onSelect, onActivate, onItemContextMenu, children }: { navigationKey: string; count: number; selected: number; offset: number; zoom?: number; visibleRadius?: number; onSelect(index: number): void; onActivate(): void; onItemContextMenu?(index: number, event: MouseEvent): void; children: ReactNode[] }) {
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = root.current;
    const scroller = element?.closest<HTMLElement>(".page-content");
    if (!element || !scroller) return;
    const resize = () => {
      const height = element.clientHeight;
      const baseCardHeight = Math.max(180, Math.min(660, height - 68));
      const cardHeight = Math.max(150, Math.round(baseCardHeight * zoom));
      const compact = cardHeight < 340;
      element.classList.toggle("flow-compact", compact);
      const cardWidth = (cardHeight - (compact ? 88 : 126)) * 2 / 3 + 18;
      element.style.setProperty("--flow-card-height", `${cardHeight}px`);
      element.style.setProperty("--flow-card-width", `${cardWidth}px`);
      element.style.setProperty("--flow-cover-height", `${cardHeight - 100}px`);
      // Keep the default seven-card spread while scaling spacing with the card size.
      const spacing = Math.max(cardWidth * .58, (element.clientWidth * .46 - cardWidth * .38) / 3 * 1.14 * zoom);
      element.style.setProperty("--flow-spacing", `${spacing}px`);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(scroller);
    observer.observe(element);
    scroller.scrollTop = 0;
    const header = element.parentElement?.querySelector(".library-header");
    if (header) observer.observe(header);
    return () => observer.disconnect();
  }, [navigationKey, zoom]);
  const gesture = useRef<{ x: number; index: number; time: number }>();
  const wheelMotion = useRef(new CoverFlowWheel());
  const wheelIndex = useRef(selected);
  useLayoutEffect(() => { wheelIndex.current = selected; }, [selected]);
  useEffect(() => { wheelMotion.current = new CoverFlowWheel(); }, [navigationKey]);
  const suppressClick = useRef(false);
  const select = (n: number) => onSelect(Math.max(0, Math.min(count - 1, n)));
  useEffect(() => {
    const element = root.current;
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || count < 2) return;
      e.preventDefault();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const steps = wheelMotion.current.step(delta, e.deltaMode, performance.now());
      if (!steps) return;
      wheelIndex.current = Math.max(0, Math.min(count - 1, wheelIndex.current + steps));
      onSelect(wheelIndex.current);
    };
    element?.addEventListener("wheel", wheel, { passive: false });
    return () => element?.removeEventListener("wheel", wheel);
  }, [count, onSelect]);
  return <section ref={root} className="media-flow" tabIndex={0} aria-label="MediaFlow" onKeyDown={e => {
    if ((e.target as HTMLElement).closest("input,select")) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); select(selected + (e.key === "ArrowRight" ? 1 : -1)); }
    if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); onActivate(); }
    if (e.key === "Home") { e.preventDefault(); select(0); }
    if (e.key === "End") { e.preventDefault(); select(count - 1); }
  }}
  onPointerDown={e => { if (!(e.target as HTMLElement).closest("button,input")) gesture.current = { x: e.clientX, index: selected, time: Date.now() }; }}
  onPointerUp={e => { const start = gesture.current; gesture.current = undefined; if (start && Math.abs(e.clientX - start.x) > 35) { suppressClick.current = true; const delta = start.x - e.clientX; const momentum = Math.max(-180, Math.min(180, delta / Math.max(80, Date.now() - start.time) * 100)); select(start.index + Math.round((delta + momentum) / 90)); } }}
  onClickCapture={e => { if (suppressClick.current) { e.stopPropagation(); e.preventDefault(); suppressClick.current = false; } }}
  onPointerCancel={() => { gesture.current = undefined; }}>
    <div className="media-flow-stage">{children.map((child, i) => {
      const index = offset + i, distance = index - selected;
      return <div className={`media-flow-item ${distance === 0 ? "selected" : ""}`} key={index} aria-hidden={Math.abs(distance) > visibleRadius}
        style={{ transform: `translateX(calc(-50% + ${distance} * var(--flow-spacing, 180px))) translateZ(${-Math.abs(distance) * 45}px) rotateY(${distance === 0 ? 0 : distance > 0 ? -30 : 30}deg)`, zIndex: 10 - Math.abs(distance), opacity: Math.abs(distance) > visibleRadius ? 0 : 1 }}
        onContextMenu={e => onItemContextMenu?.(index, e)}
        onClickCapture={e => { if (distance) { e.preventDefault(); e.stopPropagation(); select(index); } }}
><div {...(distance ? { inert: "" } : {})} style={distance ? { pointerEvents: "none" } : undefined}>{child}</div></div>;
    })}</div>
    <div className="media-flow-navigation"><input className="media-flow-slider" type="range" min={0} max={Math.max(0, count - 1)} step={1} value={selected} disabled={count < 2} aria-label="MediaFlow" aria-valuetext={`${count ? selected + 1 : 0} / ${count}`} onChange={e => select(Number(e.target.value))} /><span>{count ? selected + 1 : 0} / {count}</span></div>
  </section>;
}
