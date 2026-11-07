const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("online visualization has no system or desktop loopback path", () => {
  const engine = read("src/audio/AudioEngine.ts");
  const app = read("src/App.tsx");
  const main = read("electron/main.ts");
  assert.doesNotMatch(engine, /getDisplayMedia|loopbackStream|startLoopback|useLoopbackAnalysis/);
  assert.doesNotMatch(app, /startLoopback|useLoopbackAnalysis|analysisMode === "loopback"/);
  assert.doesNotMatch(main, /setDisplayMediaRequestHandler|desktopCapturer|TabCaptureRackExperimental|ProcessLoopbackExperimental/);
});

test("local and YouTube analysis share FFT scale, smoothing and meter bands", () => {
  const engine = read("src/audio/AudioEngine.ts");
  const online = read("electron/online-preload.ts");
  assert.match(engine, /minDecibels = -90/);
  assert.match(engine, /maxDecibels = -10/);
  assert.match(online, /analyser\.minDecibels = -90/);
  assert.match(online, /analyser\.maxDecibels = -10/);
  assert.match(online, /analyser\.smoothingTimeConstant = 0/);
  assert.match(engine, /20, 250/);
  assert.match(engine, /250, 4000/);
  assert.match(engine, /4000, 16000/);
});

test("online analysis is a silent side-chain and direct output remains untouched", () => {
  const online = read("electron/online-preload.ts");
  assert.match(online, /const stream = captureStream\.call\(media\)/);
  assert.match(online, /silent\.gain\.value = 0/);
  assert.doesNotMatch(online, /media\.(?:muted|volume)\s*=/);
  assert.doesNotMatch(online, /createMediaElementSource/);
});
