const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const source = fs.readFileSync("src/utils/atmosphere.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const loaded = { exports: {} };
Function("exports", compiled)(loaded.exports);
const { normalizeAtmosphere, atmosphereDefaults, coverPalette, atmosphereEnergy, reflectionGain } = loaded.exports;

test("new or invalid visual preferences use a quiet independent default", () => {
  assert.deepEqual(normalizeAtmosphere(null), atmosphereDefaults);
  const result = normalizeAtmosphere({ intensity: 99, nebula: false, parallax: "yes", breathing: false });
  assert.equal(result.intensity, 1);
  assert.equal("nebula" in result, false);
  assert.equal("parallax" in result, false);
  assert.equal("breathing" in result, false);
  assert.equal(result.glassEdges, false);
  assert.equal(normalizeAtmosphere({ intensity: NaN }).intensity, .3);
  assert.equal(normalizeAtmosphere({ intensity: -1 }).intensity, 0);
  result.intensity = .99;
  assert.equal(atmosphereDefaults.intensity, .3);
});

test("legacy preset fields are discarded while independent preferences survive", () => {
  for (const style of ["quiet", "stellar", "rhythm"]) {
    const result = normalizeAtmosphere({ style, nebula: true, parallax: true, progressSpark: true, breathing: false, intensity: .65, response: 2.2, orbitParticles: true });
    for (const key of ["style", "nebula", "parallax", "progressSpark"]) assert.equal(key in result, false);
    assert.equal("breathing" in result, false);
  assert.equal(result.glassEdges, false);
    assert.equal(result.intensity, .65);
    assert.equal(result.response, 2.2);
    assert.equal(result.orbitParticles, true);
    assert.deepEqual(normalizeAtmosphere(JSON.parse(JSON.stringify(result))), result);
  }
});

test("artwork sampling selects distinct colors and ignores transparent pixels", () => {
  const data = new Uint8ClampedArray([240,32,48,255, 240,32,48,255, 32,64,240,255, 0,255,0,0]);
  const [a, b] = coverPalette(data, "#abcdef");
  assert.equal(a, "rgb(240, 48, 48)");
  assert.equal(b, "rgb(48, 80, 240)");
  assert.deepEqual(coverPalette(new Uint8ClampedArray([255,255,255,255,0,0,0,255]), "#abcdef"), ["#abcdef","#abcdef"]);
});

test("decorative energy is bounded and tolerates absent or invalid analysis", () => {
  assert.equal(atmosphereEnergy(0, 0), 0);
  assert.equal(atmosphereEnergy(10, 10), 1);
  assert.equal(atmosphereEnergy(NaN, -1), 0);
  assert.ok(atmosphereEnergy(.2, .1) > 0);
});


test("music response can increase independently of brightness and retains silence", () => {
  assert.ok(atmosphereEnergy(.08, .08, 1.6) > .5);
  assert.ok(atmosphereEnergy(.08, .08, 2) > atmosphereEnergy(.08, .08, 1));
  assert.equal(atmosphereEnergy(0, 0, 3), 0);
  assert.equal(atmosphereEnergy(.5, .5, 0), 0);
  assert.equal(normalizeAtmosphere({ response: 99 }).response, 3);
  assert.equal(normalizeAtmosphere({ response: NaN }).response, 1.6);
});

 test("reflection gain stays within the existing light budget", () => {
  assert.equal(reflectionGain(0), .25); assert.equal(reflectionGain(1), 1);
  assert.equal(reflectionGain(99), 1); assert.equal(reflectionGain(NaN), .25);
  assert.ok(reflectionGain(.7) > reflectionGain(.2));
  assert.equal(normalizeAtmosphere({glassEdges:false,breathing:true}).glassEdges,false);
  assert.equal(normalizeAtmosphere({glassEdges:true,breathing:false}).glassEdges,true);
 });
