import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";
import { Info } from "lucide-react";

const GAP = 8;
const EDGE = 12;

/**
 * Explanatory text kept out of the layout. Settings show only an info mark
 * next to the title; the text appears on hover or keyboard focus in a
 * top-layer popover, so panels with overflow never clip it.
 */
export function Hint({ children, id }: { children: ReactNode; id?: string }) {
  const generated = useId();
  const tipId = id ?? `hint-${generated.replace(/:/g, "")}`;
  const trigger = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    bubble.current?.setAttribute("popover", "manual");
  }, []);

  const show = () => {
    const anchor = trigger.current, tip = bubble.current;
    if (!anchor || !tip) return;
    try { if (!tip.matches(":popover-open")) tip.showPopover(); } catch { return; }
    const box = anchor.getBoundingClientRect(), size = tip.getBoundingClientRect();
    const left = Math.min(Math.max(EDGE, box.left + box.width / 2 - size.width / 2), window.innerWidth - size.width - EDGE);
    const below = box.bottom + GAP;
    const top = below + size.height <= window.innerHeight - EDGE ? below : Math.max(EDGE, box.top - GAP - size.height);
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  };
  const hide = () => {
    try { if (bubble.current?.matches(":popover-open")) bubble.current.hidePopover(); } catch { /* Already closed. */ }
  };
  // Inside a <label>, a click on the mark must not toggle the labelled control.
  const keepControl = (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); };

  return <span className="hint" ref={trigger} tabIndex={0} aria-describedby={tipId}
    onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onClick={keepControl}
    onKeyDown={event => { if (event.key === "Escape") hide(); }}>
    <Info aria-hidden="true" />
    <span className="hint-bubble" id={tipId} role="tooltip" ref={bubble}>{children}</span>
  </span>;
}
