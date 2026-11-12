import { useEffect, useId, useRef, type ReactNode } from "react";

const GAP = 8;
const EDGE = 12;

/**
 * Explanatory text kept out of the layout. Nothing is drawn next to the title:
 * hovering the title itself (the element that contains the Hint) shows the
 * text in a top-layer popover, so panels with overflow never clip it. The title
 * links the text with aria-describedby for screen readers.
 */
export function Hint({ children, id }: { children: ReactNode; id?: string }) {
  const generated = useId();
  const tipId = id ?? `hint-${generated.replace(/:/g, "")}`;
  const holder = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const tip = bubble.current, anchor = holder.current?.parentElement;
    if (!tip || !anchor) return;
    tip.setAttribute("popover", "manual");
    const show = () => {
      try { if (!tip.matches(":popover-open")) tip.showPopover(); } catch { return; }
      const box = anchor.getBoundingClientRect(), size = tip.getBoundingClientRect();
      const left = Math.min(Math.max(EDGE, box.left), window.innerWidth - size.width - EDGE);
      const below = box.bottom + GAP;
      const top = below + size.height <= window.innerHeight - EDGE ? below : Math.max(EDGE, box.top - GAP - size.height);
      tip.style.left = `${Math.round(left)}px`;
      tip.style.top = `${Math.round(top)}px`;
    };
    const hide = () => {
      try { if (tip.matches(":popover-open")) tip.hidePopover(); } catch { /* Already closed. */ }
    };
    const described = anchor.getAttribute("aria-describedby");
    anchor.classList.add("has-hint");
    anchor.setAttribute("aria-describedby", described ? `${described} ${tipId}` : tipId);
    anchor.addEventListener("mouseenter", show);
    anchor.addEventListener("mouseleave", hide);
    return () => {
      hide();
      anchor.removeEventListener("mouseenter", show);
      anchor.removeEventListener("mouseleave", hide);
      anchor.classList.remove("has-hint");
      if (described) anchor.setAttribute("aria-describedby", described);
      else anchor.removeAttribute("aria-describedby");
    };
  }, [tipId]);

  return <span className="hint" ref={holder}>
    <span className="hint-bubble" id={tipId} role="tooltip" ref={bubble}>{children}</span>
  </span>;
}
