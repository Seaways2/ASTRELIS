import { useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { DEFAULT_METERS_WIDTH, METERS_FOLD_QUERY, tabsCrowdedByMeters, type HeadMetrics } from "../utils/meterCrowding";

const subscribeNarrow = (notify: () => void) => {
  const media = matchMedia(METERS_FOLD_QUERY);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
const narrowNow = () => matchMedia(METERS_FOLD_QUERY).matches;

function px(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Reads what the visualizer header needs to show every mode name, or nothing while the names are hidden. */
export function readHeadMetrics(head: HTMLElement): HeadMetrics | undefined {
  const title = head.firstElementChild as HTMLElement | null;
  const actions = head.querySelector<HTMLElement>(".visual-head-actions");
  const tabs = head.querySelector<HTMLElement>(".mode-tabs");
  if (!title || !actions || !tabs || title === actions || !tabs.offsetParent || !head.clientWidth) return undefined;
  const style = getComputedStyle(head);
  const capValue = getComputedStyle(actions).maxWidth.trim();
  return {
    headInner: head.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
    titleWidth: title.getBoundingClientRect().width,
    // The names scroll inside .mode-tabs when they do not fit: add back what is scrolled away.
    actionsNatural: actions.getBoundingClientRect().width + Math.max(0, tabs.scrollWidth - tabs.clientWidth),
    actionsCapRatio: capValue.endsWith("%") ? px(capValue) / 100 : undefined,
    actionsCapPx: capValue.endsWith("px") ? px(capValue) : undefined
  };
}

/**
 * Whether the meters should fold away to give the names room (see meterCrowding.ts).
 * `head` is the now-playing visualizer header; `measureHead` is false while it is not shown.
 */
export function useMeterCrowding(head: RefObject<HTMLElement | null>, measureHead: boolean, remeasureKey: unknown) {
  const narrow = useSyncExternalStore(subscribeNarrow, narrowNow, () => false);
  const [tabsCrowded, setTabsCrowded] = useState(false);
  const metersWidth = useRef(DEFAULT_METERS_WIDTH);

  // A layout effect, so a page that opens crowded never paints the meters first.
  // Showing or folding the meters resizes the header, so the observer re-measures.
  useLayoutEffect(() => {
    const element = head.current;
    if (!measureHead || !element) {
      setTabsCrowded(false);
      return;
    }
    const measure = () => {
      const meters = element.ownerDocument.querySelector<HTMLElement>(".workspace > .meters");
      const metersShown = Boolean(meters?.offsetWidth);
      if (metersShown) metersWidth.current = meters!.offsetWidth;
      const metrics = readHeadMetrics(element);
      if (metrics) setTabsCrowded(tabsCrowdedByMeters(metersShown, metrics, metersWidth.current));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const tabs = element.querySelector(".mode-tabs");
    if (tabs) observer.observe(tabs);
    return () => observer.disconnect();
  }, [head, measureHead, remeasureKey]);

  return narrow || tabsCrowded;
}
