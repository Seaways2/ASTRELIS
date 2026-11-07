/**
 * The embedded NetEase HTTP server splits Cookie headers only when a
 * semicolon is followed by whitespace. QR login returns the same cookie list
 * without that whitespace, so normalize delimiters before forwarding it.
 */
export const normalizeNeteaseCookieHeader = (cookie: string) =>
  cookie.trim().replace(/;\s*/g, "; ");
