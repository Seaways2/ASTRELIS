/**
 * Environment switches meant only for the source build and its tests: the
 * Vite dev-server URL (the main window would load it with the full preload)
 * and the library and plugin-scanner failpoints. An installed build must never
 * honour them, whatever set them: a .env next to a double-clicked media file
 * once reached process.env through the NetEase package's dotenv call.
 */
const DEVELOPMENT_SWITCH = /^(VITE_DEV_SERVER_URL|AURALIS_LIBRARY_FAILPOINT|AURALIS_ENABLE_TEST_FAULTS|AURALIS_SCANNER_TEST_\w+)$/i;

/** Removes the development switches from `env` in place and returns their names. */
export function removeDevelopmentSwitches(env: Record<string, string | undefined>) {
  const removed = Object.keys(env).filter(key => DEVELOPMENT_SWITCH.test(key));
  for (const key of removed) delete env[key];
  return removed;
}
