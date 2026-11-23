// The application log rotates by size and keeps a fixed number of backups.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { RendererPlaybackLog, RotatingLogFile } = require("../../dist-electron/logFile.js");

const temporaryDirectory = t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "astrelis-log-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, "logs");
};

test("lines are appended in order and the directory is created on first write", t => {
  const directory = temporaryDirectory(t);
  const log = new RotatingLogFile(directory, 1024);
  log.write("first\n");
  log.write("second\n");
  assert.equal(fs.readFileSync(path.join(directory, "auralis.log"), "utf8"), "first\nsecond\n");
});

test("the log rotates past its size limit and keeps only the newest backups", t => {
  const directory = temporaryDirectory(t);
  const log = new RotatingLogFile(directory, 100, 2);
  const line = index => `${String(index).padStart(3, "0")} ${"x".repeat(45)}\n`; // 50 bytes
  for (let index = 0; index < 9; index++) log.write(line(index));
  const read = name => fs.readFileSync(path.join(directory, name), "utf8");
  assert.deepEqual(fs.readdirSync(directory).sort(), ["auralis.1.log", "auralis.2.log", "auralis.log"]);
  assert.equal(read("auralis.log"), line(8));
  assert.equal(read("auralis.1.log"), line(6) + line(7));
  assert.equal(read("auralis.2.log"), line(4) + line(5));
  for (const name of fs.readdirSync(directory)) assert.ok(fs.statSync(path.join(directory, name)).size <= 100);
});

test("an existing large log is rotated on the first write after a restart", t => {
  const directory = temporaryDirectory(t);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "auralis.log"), "y".repeat(500));
  new RotatingLogFile(directory, 100).write("after restart\n");
  assert.equal(fs.readFileSync(path.join(directory, "auralis.log"), "utf8"), "after restart\n");
  assert.equal(fs.statSync(path.join(directory, "auralis.1.log")).size, 500);
});

// LA06: the renderer reports files it cannot play on its console only.
test("only [playback] console lines reach the log, a few per second at most", () => {
  let now = 0;
  const written = [];
  const log = new RendererPlaybackLog(line => written.push(line), 3, 1000, () => now, 60);
  for (const noise of ["Download the React DevTools", "Electron Security Warning", " [playback] indented", undefined, 42, null])
    assert.equal(log.accept(noise), false);
  assert.deepEqual(written, []);
  assert.equal(log.accept("[playback] cannot play D:\\music\\a.aiff: MediaError 4 DEMUXER_ERROR"), true);
  assert.equal(log.accept("[playback] cannot play b\r\nsecond line"), true);
  assert.equal(log.accept("[playback] cannot play c"), true);
  // A queue of broken files skipping one after another is cut off ...
  for (let index = 0; index < 20; index++) assert.equal(log.accept(`[playback] cannot play ${index}`), false);
  assert.equal(written.length, 3);
  assert.equal(written[1], "[playback] cannot play b second line", "one line per entry");
  // ... and the next interval says how many were left out.
  now = 999; assert.equal(log.accept("[playback] still throttled"), false);
  now = 1000; assert.equal(log.accept("[playback] cannot play d"), true);
  assert.equal(written[3], "[playback] cannot play d (21 more playback failure line(s) were not logged)");
  assert.equal(log.accept(`[playback] ${"x".repeat(200)}`), true);
  assert.equal(written[4], `[playback] ${"x".repeat(49)}…`, "long lines are cut");
});

test("a burst followed by nothing still logs how many lines it left out", () => {
  let now = 0;
  const written = [], timers = [];
  const log = new RendererPlaybackLog(line => written.push(line), 3, 1000, () => now, 1000,
    (run, delay) => timers.push({ run, delay }));
  now = 100;
  for (let index = 0; index < 10; index++) log.accept(`[playback] cannot play ${index}`);
  assert.equal(written.length, 3);
  // One timer for the whole burst, due when the interval ends.
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 1000);
  now = 1100; timers.shift().run();
  assert.equal(written[3], "[playback] 7 more playback failure line(s) were not logged");
  // Nothing left out: the timer writes nothing, and nothing is counted twice.
  assert.equal(log.accept("[playback] cannot play next"), true);
  assert.equal(written[4], "[playback] cannot play next");
  log.flush();
  assert.equal(written.length, 5);
  // A later line in the same interval may take the count first; the timer then writes nothing.
  log.accept("[playback] a"); log.accept("[playback] b"); log.accept("[playback] c");
  assert.equal(timers.length, 1);
  now = 2100; log.accept("[playback] d");
  assert.equal(written.at(-1), "[playback] d (1 more playback failure line(s) were not logged)");
  timers.shift().run();
  assert.equal(written.at(-1), "[playback] d (1 more playback failure line(s) were not logged)");
});

test("the default timer does not keep the process alive", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../electron/logFile.ts"), "utf8");
  assert.match(source, /setTimeout\(run, delayMs\)\.unref\?\.\(\)/);
});

test("main forwards the main window's console through the playback filter", () => {
  const main = fs.readFileSync(path.resolve(__dirname, "../../electron/main.ts"), "utf8");
  assert.match(main, /const rendererPlaybackLog = new RendererPlaybackLog\(message => writeLog\("AUDIO", message\)\);/);
  const create = main.slice(main.indexOf("function createWindow()"), main.indexOf("function showMainWindow()"));
  assert.match(create, /mainWindow\.webContents\.on\("console-message", \(_event, _level, message\) => \{ rendererPlaybackLog\.accept\(message\); \}\);/);
  assert.equal(main.match(/"console-message"/g).length, 1, "one listener, on the only main window");
  // The page keeps writing the prefix the filter looks for.
  const app = fs.readFileSync(path.resolve(__dirname, "../../src/App.tsx"), "utf8");
  assert.match(app, /console\.error\(`\[playback\] cannot play /);
});