import { CoverFlowWheel } from "../utils/coverFlowWheel";
import { useEffect, useLayoutEffect, useRef, type ReactNode, type MouseEvent } from "react";
import "./MediaFlow.css";
/** Below this card height the selected card keeps one title line (the text rows are sized in CSS px). */
export const FLOW_COMPACT_CARD_HEIGHT = 340;
/** Card height in CSS px for a flow element `height` CSS px tall. `height - 68` leaves the
 *  navigation (42), the top offset (8) and the reflection (18). Up to 200% scaling the 660 px
 *  cap is unchanged; beyond that 660 CSS px is a minority of the device pixels (225% on 4K
 *  leaves 912 CSS px), so cards may grow with the stage, but never past 2160 device px. */
export function flowCardHeight(height: number, zoom: number, devicePixelRatio: number) {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const cap = Math.max(660, Math.min(660 * (ratio - 1), 2160 / ratio));
  return Math.max(150, Math.round(Math.max(180, Math.min(cap, height - 68)) * zoom));
}
export function MediaFlow({ count, selected, offset, navigationKey, zoom = 1, visibleRadius = 3, onSelect, onActivate, onItemContextMenu, children }: { navigationKey: string; count: number; selected: number; offset: number; zoom?: number; visibleRadius?: number; onSelect(index: number): void; onActivate(): void; onItemContextMenu?(index: number, event: MouseEvent): void; children: ReactNode[] }) {
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = root.current;
    const scroller = element?.closest<HTMLElement>(".page-content");
    if (!element || !scroller) return;
    const resize = () => {
      const cardHeight = flowCardHeight(element.clientHeight, zoom, devicePixelRatio);
      const compact = cardHeight < FLOW_COMPACT_CARD_HEIGHT;
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
    // Moving to a monitor with another scale can change the ratio without a CSS resize.
    let scale: MediaQueryList | undefined;
    const watchScale = () => {
      scale?.removeEventListener("change", rescale);
      scale = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
      scale.addEventListener("change", rescale);
    };
    const rescale = () => { watchScale(); resize(); };
    watchScale();
    return () => { observer.disconnect(); scale?.removeEventListener("change", rescale); };
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
