const { readAppSource } = require("./helpers/appSource.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const app = readAppSource();
const canvas = fs.readFileSync(path.join(root, "src/visualizers/VisualizerCanvas.tsx"), "utf8");

test("Decay Speed uses the requested direct 0.05 to 1.0 range", () => {
  assert.match(app, /visual\.decay[\s\S]*?min="\.05" max="1" step="\.05"/);
  assert.match(app, /setVisualSetting\("decaySpeed", 1\)/);
  assert.match(canvas, /visualDecaySpeed = settings\.decaySpeed \* \(playbackActive \? 1 : \.28\)/);
  assert.doesNotMatch(canvas, /effectiveDecaySpeed|normalizedDecaySpeed/);
});

test("Decay Speed defaults and clamps stored values to the new upper bound", () => {
  const store = fs.readFileSync(path.join(root, "src/stores/playerStore.ts"), "utf8");
  assert.match(store, /decaySpeed: 1,/);
  assert.match(store, /Math\.min\(1, Math\.max\(\.05, storedDecaySpeed\)\)/);
  assert.match(store, /key === "decaySpeed"[\s\S]*?Math\.min\(1, Math\.max\(\.05, value\)\)/);
});
