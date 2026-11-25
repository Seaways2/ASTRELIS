/**
 * When the window gets narrow, the audio meters on the right are folded away
 * first, so the visualizer mode names and the sidebar names keep their room.
 *
 * Two things make the meters "crowded":
 * - the window is at most METERS_FOLD_WIDTH CSS pixels wide, where the sidebar
 *   would otherwise drop its names (it now keeps them down to 1000px instead);
 * - on the now-playing page, the visualizer header cannot show every mode name
 *   while the meters take their column (any language, any zoom).
 */
export const METERS_FOLD_WIDTH = 1250;
export const METERS_FOLD_QUERY = `(max-width: ${METERS_FOLD_WIDTH}px)`;

/** Space kept between the header title and the mode names. */
export const HEAD_MIN_GAP = 16;
/** Extra room the header must have before the meters come back (no flapping). */
export const METERS_RETURN_MARGIN = 8;
/** The meters' column width above METERS_FOLD_WIDTH (global.css .workspace). */
export const DEFAULT_METERS_WIDTH = 286;

export type HeadMetrics = {
  /** Width of the header's content box now. */
  headInner: number;
  /** Width the title block needs. */
  titleWidth: number;
  /** Width the actions (mode names and buttons) need to show every name. */
  actionsNatural: number;
  /** max-width of the actions as a share of the header (e.g. 0.76), if any. */
  actionsCapRatio?: number;
  /** max-width of the actions in pixels, if any. */
  actionsCapPx?: number;
};

/** Whether every mode name fits in a header of the given content width. */
export function headFits(metrics: HeadMetrics, width = metrics.headInner) {
  const cap = Math.min(
    metrics.actionsCapRatio === undefined ? Infinity : metrics.actionsCapRatio * width,
    metrics.actionsCapPx ?? Infinity
  );
  return metrics.actionsNatural <= cap + 0.5
    && metrics.titleWidth + HEAD_MIN_GAP + metrics.actionsNatural <= width + 0.5;
}

/**
 * Whether the meters crowd the mode names. With the meters shown, they do as
 * soon as the names no longer fit. With them hidden, the names must still fit,
 * with a margin, once the meters' column is taken back out of the header.
 */
export function tabsCrowdedByMeters(metersShown: boolean, metrics: HeadMetrics, metersWidth: number) {
  if (metersShown) return !headFits(metrics);
  return !headFits(metrics, metrics.headInner - metersWidth - METERS_RETURN_MARGIN);
}

export type MeterLayoutInput = {
  nowPlaying: boolean;
  crowded: boolean;
  /** The user brought the meters back while they were crowded. */
  forced: boolean;
  /** The user's own expanded/folded choice for the other pages. */
  expanded: boolean;
};

/** Whether the meters column is shown. */
export function metersShownFor({ nowPlaying, crowded, forced, expanded }: MeterLayoutInput) {
  if (crowded) return forced;
  return nowPlaying || expanded;
}
