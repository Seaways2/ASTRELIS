const test = require("node:test");
const assert = require("node:assert/strict");
const { canonicalOutputLabel, matchingBrowserOutputDevice } = require("../../dist-electron/outputDeviceMatching.js");

test("Windows default and communications aliases share one physical label", () => {
  assert.equal(canonicalOutputLabel("Default - Main L/R (2- Quantum LT 2)"), "main l/r (2- quantum lt 2)");
  assert.equal(canonicalOutputLabel("Communications - Main L/R (2- Quantum LT 2)"), "main l/r (2- quantum lt 2)");
  assert.equal(canonicalOutputLabel("Main L/R (2- Quantum LT 2)"), "main l/r (2- quantum lt 2)");
});

test("YouTube matching prefers the physical endpoint over Windows aliases", () => {
  const selected = matchingBrowserOutputDevice([
    { deviceId: "default", label: "Default - Main L/R (2- Quantum LT 2)" },
    { deviceId: "communications", label: "Communications - Main L/R (2- Quantum LT 2)" },
    { deviceId: "physical-id", label: "Main L/R (2- Quantum LT 2)" }
  ], "Communications - Main L/R (2- Quantum LT 2)");
  assert.equal(selected?.deviceId, "physical-id");
});

test("matching falls back to an available alias when the physical endpoint is absent", () => {
  const selected = matchingBrowserOutputDevice([
    { deviceId: "communications", label: "Communications - Speakers" },
    { deviceId: "default", label: "Default - Speakers" }
  ], "Speakers");
  assert.equal(selected?.deviceId, "default");
});
