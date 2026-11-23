import type { Session } from "electron";

/**
 * Policy for the persist:auralis-online session behind the YouTube Music view.
 * Electron grants every permission request and check by default, and the view
 * can be navigated to other sites, so the session denies by default and the
 * view keeps its top-level pages on YouTube and Google sign-in.
 */
const PLAYER_ORIGIN = "https://music.youtube.com";

function httpsHost(value: string | undefined) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.hostname.toLowerCase() : "";
  } catch { return ""; }
}

const within = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Top-level pages the online view may show itself; anything else opens in the system browser. */
export function onlineNavigationAllowed(url: string) {
  const host = httpsHost(url);
  return Boolean(host) && (within(host, "youtube.com") || host === "youtu.be" || within(host, "google.com"));
}

/** What a YouTube page needs to play: fullscreen video, protected media and copying share links. */
const PLAYBACK_PERMISSIONS = new Set(["fullscreen", "mediaKeySystem", "clipboard-sanitized-write"]);

/**
 * Permission requests. Microphone and camera ("media"), notifications,
 * geolocation, clipboard reading, MIDI and external protocols are refused for
 * every site.
 */
export function onlinePermissionGranted(permission: string, requestingUrl: string | undefined) {
  return PLAYBACK_PERMISSIONS.has(permission) && within(httpsHost(requestingUrl), "youtube.com");
}

/**
 * Permission checks. YouTube Music additionally passes the "media" and
 * "speaker-selection" checks: applyOnlineOutputSelection matches the output
 * device by the labels enumerateDevices() only reveals then, and setSinkId
 * switches to it. The checks grant no capture: getUserMedia goes through the
 * request handler, which refuses it.
 */
export function onlinePermissionChecked(permission: string, requestingOrigin: string | undefined) {
  if (onlinePermissionGranted(permission, requestingOrigin)) return true;
  if (permission !== "media" && permission !== "speaker-selection") return false;
  try { return new URL(String(requestingOrigin)).origin === PLAYER_ORIGIN; }
  catch { return false; }
}

const configuredSessions = new WeakSet<Session>();

/** Installs the deny-by-default handlers once per session. */
export function applyOnlineSessionPolicy(session: Session) {
  if (configuredSessions.has(session)) return;
  configuredSessions.add(session);
  session.setPermissionRequestHandler((_contents, permission, callback, details) =>
    callback(onlinePermissionGranted(permission, details.requestingUrl)));
  session.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    onlinePermissionChecked(permission, requestingOrigin));
  session.setDevicePermissionHandler(() => false);
}

/**
 * Pages may hand links to the system browser, but not open tab after tab
 * there: at most one external open per interval.
 */
export class ExternalOpenThrottle {
  private last = Number.NEGATIVE_INFINITY;
  constructor(private readonly intervalMs = 1500, private readonly now: () => number = Date.now) {}

  allow() {
    const time = this.now();
    if (time - this.last < this.intervalMs) return false;
    this.last = time;
    return true;
  }
}
