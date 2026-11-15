// Runs the real galaxy palette: every colour derives from the theme accent.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const palette = {};
Function("exports", ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../../src/visualizers/galaxyPalette.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText)(palette);
const { galaxyPalette, rgbToHsl, hslToRgb, rgba } = palette;

test("hsl conversion round-trips", () => {
  for (const color of [[56, 211, 225], [215, 221, 226], [230, 80, 120], [20, 20, 20]]) {
    const [h, s, l] = rgbToHsl(color);
    assert.deepEqual(hslToRgb(h, s, l), color);
  }
});

test("a cyan accent gets blue-white arms, a warm bulge, a teal-green neighbour and a pink nebula", () => {
  const colours = galaxyPalette([56, 211, 225]);
  const hue = color => rgbToHsl(color)[0];
  assert.ok(Math.round(hue(colours.analog)) >= 140 && Math.round(hue(colours.analog)) <= 160, `analog ${hue(colours.analog)}`);
  assert.ok(hue(colours.nebula) > 320 || hue(colours.nebula) < 10, `nebula ${hue(colours.nebula)}`);
  assert.ok(colours.ice.every((value, index) => value >= colours.accent[index]), "ice is the accent lightened");
  assert.ok(colours.warm[0] > colours.warm[2], "the bulge is warm");
  assert.ok(colours.core.every(value => value > 225), "the centre is nearly white");
});

test("a grey accent gains only a hint of hue, never a loud invented colour", () => {
  const colours = galaxyPalette([128, 128, 128]);
  assert.ok(rgbToHsl(colours.nebula)[1] <= .2 && rgbToHsl(colours.analog)[1] <= .2);
  assert.equal(rgba([1, 2, 3], .5), "rgba(1,2,3,0.5)");
});
