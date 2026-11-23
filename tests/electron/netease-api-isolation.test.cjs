// N01 / N09: the NetEase API package must neither read a .env from the
// current directory (the folder of a double-clicked media file) nor expose a
// local HTTP server; the app calls its module functions directly.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");

test("loading the NetEase modules ignores a .env in the current directory", t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "astrelis-dotenv-"));
  const previous = process.cwd();
  const probes = ["AURALIS_DOTENV_PROBE", "ENABLE_PROXY", "PROXY_URL", "VITE_DEV_SERVER_URL", "AURALIS_LIBRARY_FAILPOINT"];
  const saved = Object.fromEntries(probes.map(key => [key, process.env[key]]));
  for (const key of probes) delete process.env[key];
  t.after(() => {
    process.chdir(previous);
    for (const key of probes) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    fs.rmSync(folder, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(folder, ".env"), [
    "AURALIS_DOTENV_PROBE=leaked", "ENABLE_PROXY=true", "PROXY_URL=http://attacker.invalid/",
    "VITE_DEV_SERVER_URL=https://evil.invalid/", "AURALIS_LIBRARY_FAILPOINT=AFTER_TMP_WRITE"
  ].join("\n"));
  process.chdir(folder);
  const api = require("../../dist-electron/neteaseApi");
  const { main } = api.neteaseModules();
  assert.equal(typeof main.cloudsearch, "function");
  assert.equal(typeof main.song_url_v1, "function", "song_url_v1 calls dotenv at load time as well");
  for (const key of probes) assert.equal(process.env[key], undefined, `${key} came from .env`);
  // The package's own dotenv is the inert replacement for every later call too.
  const dotenvPath = require.resolve("dotenv", { paths: [path.dirname(require.resolve("@neteasecloudmusicapienhanced/api/main", { paths: [root] }))] });
  require(dotenvPath).config();
  assert.equal(process.env.AURALIS_DOTENV_PROBE, undefined);
});

test("the session cookie reaches the modules parsed like the HTTP server did, values with '=' intact", () => {
  const { neteaseCookieObject } = require("../../dist-electron/neteaseApi");
  assert.deepEqual(neteaseCookieObject("MUSIC_U=abc==;__csrf=x1; NMTID=00O%2Bz;bad;=novalue;empty="),
    { MUSIC_U: "abc==", __csrf: "x1", NMTID: "00O+z" });
  assert.deepEqual(neteaseCookieObject(""), {});
});

test("no module starts the package's Express server", () => {
  const source = fs.readFileSync(path.join(root, "electron/neteaseApi.ts"), "utf8");
  assert.doesNotMatch(source, /serveNcmApi|api\/server"|\.listen\(|createServer|fetch\(/);
  // The modules load on first use, not while the main process starts.
  assert.doesNotMatch(source, /^const .*= require\(/m);
});

test("an installed build drops the development switches before anything reads them (N01)", () => {
  const { removeDevelopmentSwitches } = require("../../dist-electron/security/DevelopmentSwitches");
  const env = {
    PATH: "C:\\Windows", VITE_DEV_SERVER_URL: "https://evil.invalid/", AURALIS_LIBRARY_FAILPOINT: "AFTER_TMP_WRITE",
    AURALIS_SCANNER_TEST_HANG_STAGE: "MODULE_LOAD", aUrAlIs_ScAnNeR_tEsT_crash_stage: "x", AURALIS_ENABLE_TEST_FAULTS: "1",
    AURALIS_PLUGIN_SCAN_TIMEOUT_MS: "30000"
  };
  assert.deepEqual(removeDevelopmentSwitches(env).sort(), ["AURALIS_ENABLE_TEST_FAULTS", "AURALIS_LIBRARY_FAILPOINT",
    "AURALIS_SCANNER_TEST_HANG_STAGE", "VITE_DEV_SERVER_URL", "aUrAlIs_ScAnNeR_tEsT_crash_stage"].sort());
  assert.deepEqual(env, { PATH: "C:\\Windows", AURALIS_PLUGIN_SCAN_TIMEOUT_MS: "30000" });
  const main = fs.readFileSync(path.join(root, "electron/main.ts"), "utf8");
  assert.match(main, /if \(app\.isPackaged\) removeDevelopmentSwitches\(process\.env\);/);
  assert.ok(main.indexOf("removeDevelopmentSwitches(process.env)") < main.indexOf("app.requestSingleInstanceLock()"));
  assert.match(main, /const devUrl = app\.isPackaged \? undefined : process\.env\.VITE_DEV_SERVER_URL;/);
  assert.doesNotMatch(main, /const devUrl = process\.env/);
});
