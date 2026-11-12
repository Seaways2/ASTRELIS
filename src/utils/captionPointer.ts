/**
 * Dispatched on `document` when the user presses the titlebar drag region.
 * Such a press is handled by Windows as a caption click and never produces a
 * DOM pointerdown, so "click outside to close" handlers listen for this too.
 */
export const CAPTION_POINTERDOWN_EVENT = "astrelis:caption-pointerdown";
