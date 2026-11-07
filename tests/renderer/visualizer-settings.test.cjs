const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { loadPlayerStore } = require("./helpers/player-store-harness.cjs");

const visualKey = "auralis.visual.settings";
const removedKeys = ["showGrid", "showFrequencyScale", "showDbScale", "lowPerformance"];
const source = fs.readFileSync(path.join(__dirname, "../../src/utils/visualizerSettings.ts"), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const resolverModule = { exports: {} };
Function("exports", "module", javascript)(resolverModule.exports, resolverModule);
const { resolveVisualizerSettings } = resolverModule.exports;
const defaults = () => loadPlayerStore().store.getState().visualSettings;
const assertNoRemoved = settings => {
  for (const key of removedKeys) assert.equal(Object.hasOwn(settings, key), false, `${key} must not be saved`);
};

test("legacy visual profiles discard removed and unknown keys while preserving supported tuning", () => {
  const original = {
    ...defaults(), fftSize: 4096, barCount: 144, animationSpeed: 1.8,
    torusParticleCount: 120000, torusTrailStrength: .62, decaySpeed: .45,
    torusColorScheme: "violet", showGrid: true, showFrequencyScale: true,
    showDbScale: true, lowPerformance: true, obsoleteDecoration: "legacy"
  };
  const { store, persisted } = loadPlayerStore({ initialStorage: [[visualKey, JSON.stringify(original)]] });
  const expected = { ...original };
  for (const key of [...removedKeys, "obsoleteDecoration"]) delete expected[key];
  assert.deepEqual(store.getState().visualSettings, expected);
  assert.deepEqual(JSON.parse(persisted.get(visualKey)), expected);
  assertNoRemoved(store.getState().visualSettings);
  assert.deepEqual(loadPlayerStore({ initialStorage: [...persisted] }).store.getState().visualSettings, expected);
});

test("unsupported setters cannot resurrect deleted options or write arbitrary settings", () => {
  const { store, persisted } = loadPlayerStore();
  const before = store.getState();
  for (const key of [...removedKeys, "unknown", "__proto__", "constructor", "toString"]) {
    store.getState().setVisualSetting(key, true);
    assert.equal(store.getState(), before, `invalid setter ${key} must be a no-op`);
  }
  assert.equal(persisted.has(visualKey), false);
  store.getState().setVisualSetting("barCount", 128);
  assert.equal(store.getState().visualSettings.barCount, 128);
  assertNoRemoved(JSON.parse(persisted.get(visualKey)));
});

test("reset restores only current visual defaults", () => {
  const { store, persisted } = loadPlayerStore({ initialStorage: [[visualKey,
    JSON.stringify({ barCount: 180, sensitivity: 1.5, lowPerformance: true, showGrid: true })]] });
  store.getState().resetVisualSettings();
  assert.deepEqual(store.getState().visualSettings, defaults());
  assert.deepEqual(JSON.parse(persisted.get(visualKey)), defaults());
  assertNoRemoved(store.getState().visualSettings);
});

test("retired compact decay migration still runs once before the supported decay clamp", () => {
  const { store, persisted } = loadPlayerStore({ initialStorage: [
    [visualKey, JSON.stringify({ decaySpeed: .1, smoothing: .83, showDbScale: true })],
    ["auralis.visual.decay-range-v2", "1"]
  ] });
  const expectedDecay = .2 + (.1 - .05) / 1.95 * 4.8;
  assert.equal(store.getState().visualSettings.decaySpeed, expectedDecay);
  assert.equal(store.getState().visualSettings.smoothing, .83);
  assert.equal(persisted.has("auralis.visual.decay-range-v2"), false);
  assertNoRemoved(JSON.parse(persisted.get(visualKey)));
  assert.equal(loadPlayerStore({ initialStorage: [...persisted] }).store.getState().visualSettings.decaySpeed, expectedDecay);
});

test("ordinary legacy decay values retain the existing supported range", () => {
  for (const [value, expected] of [[3, 1], [-1, .05], [.4, .4], ["invalid", 1]]) {
    const { store } = loadPlayerStore({ initialStorage: [[visualKey, JSON.stringify({ decaySpeed: value })]] });
    assert.equal(store.getState().visualSettings.decaySpeed, expected);
  }
  const { store } = loadPlayerStore();
  store.getState().setVisualSetting("decaySpeed", 5);
  assert.equal(store.getState().visualSettings.decaySpeed, 1);
  store.getState().setVisualSetting("decaySpeed", -.5);
  assert.equal(store.getState().visualSettings.decaySpeed, .05);
});

test("system resource mode derives limits without overwriting full-quality user tuning", () => {
  const tuning = {
    ...defaults(), fftSize: 8192, barCount: 144, animationSpeed: 1.4,
    torusParticleCount: 120000, torusTrailStrength: .65
  };
  const { store, persisted } = loadPlayerStore({ initialStorage: [[visualKey, JSON.stringify(tuning)]] });
  const saved = persisted.get(visualKey);
  const settings = Object.freeze(store.getState().visualSettings);
  store.getState().setUiSetting("lowPerformanceMode", true);
  const limited = resolveVisualizerSettings(settings, store.getState().uiSettings.lowPerformanceMode);
  assert.deepEqual(limited, {
    ...tuning, fftSize: 512, barCount: 48, animationSpeed: .65,
    torusParticleCount: 20000, torusTrailStrength: 0, lowPerformance: true
  });
  store.getState().setUiSetting("lowPerformanceMode", false);
  assert.deepEqual(resolveVisualizerSettings(settings, store.getState().uiSettings.lowPerformanceMode), {
    ...tuning, lowPerformance: false
  });
  assert.equal(store.getState().visualSettings, settings);
  assert.equal(persisted.get(visualKey), saved);
  assertNoRemoved(JSON.parse(saved));
});

test("resource limits preserve user values already below the caps", () => {
  const tuning = Object.freeze({
    ...defaults(), barCount: 24, animationSpeed: .2, torusParticleCount: 10000
  });
  const limited = resolveVisualizerSettings(tuning, true);
  assert.equal(limited.barCount, 24);
  assert.equal(limited.animationSpeed, .2);
  assert.equal(limited.torusParticleCount, 10000);
});

test("only the global resource choice determines the runtime low-performance flag", () => {
  const tuning = defaults();
  assert.equal(resolveVisualizerSettings({ ...tuning, lowPerformance: true }, false).lowPerformance, false);
  assert.equal(resolveVisualizerSettings({ ...tuning, lowPerformance: false }, true).lowPerformance, true);
  assertNoRemoved(tuning);
});
