const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function transpile(relativePath) {
  return ts.transpileModule(fs.readFileSync(path.resolve(__dirname, relativePath), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
}
const exportsObject = {};
Function("exports", transpile("../../src/utils/ambientBackground.ts"))(exportsObject);
const { createAmbientPixels } = exportsObject;

const defaults = {
  top: [8, 14, 17], bottom: [5, 9, 12], accent: [215, 221, 226],
  opacity: .94, bottomOpacityScale: .97, gpuGain: .25, baseGlow: .07,
  customBackground: false
};

function mean(pixels, channel, premultiply = false) {
  let total = 0;
  for (let offset = channel; offset < pixels.length; offset += 4) {
    total += premultiply ? Math.round(pixels[offset] * pixels[offset - channel + 3] / 255) : pixels[offset];
  }
  return total / (pixels.length / 4);
}

test("ambient input rejects invalid dimensions and nonfinite values before allocating", () => {
  for (const [width, height] of [[0, 1], [-1, 1], [1.5, 1], [NaN, 1], [1, Infinity], [4097, 4096], [16777217, 1]]) {
    assert.throws(() => createAmbientPixels(width, height, defaults), RangeError);
  }
  assert.throws(() => createAmbientPixels(2, 2, { ...defaults, accent: [NaN, 1, 2] }), RangeError);
  assert.throws(() => createAmbientPixels(2, 2, { ...defaults, opacity: Infinity }), RangeError);
  assert.equal(createAmbientPixels(1, 1, defaults).length, 4);
});

test("ambient pixels remain deterministic, finite and premultipliable", () => {
  const first = createAmbientPixels(257, 129, defaults);
  assert.deepEqual(first, createAmbientPixels(257, 129, defaults));
  assert.equal(first.length, 257 * 129 * 4);
  for (let index = 0; index < first.length; index += 4) {
    assert.ok(first[index + 3] > 0 && first[index + 3] < 255, "window backdrop must remain visible");
    for (let channel = 0; channel < 3; channel++) {
      const premultiplied = Math.round(first[index + channel] * first[index + 3] / 255);
      assert.ok(premultiplied >= 0 && premultiplied <= first[index + 3]);
    }
  }
});

test("neutral light keeps equal RGB bytes without coloured grain", () => {
  const pixels = createAmbientPixels(256, 128, {
    ...defaults, top: [11.4, 11.4, 11.4], bottom: [7.2, 7.2, 7.2], accent: [230, 230, 230]
  });
  for (let index = 0; index < pixels.length; index += 4) {
    assert.equal(pixels[index], pixels[index + 1]);
    assert.equal(pixels[index], pixels[index + 2]);
  }
});

test("base glow stays broad, smoothly dims outward, and scales with its gain", () => {
  const options = {
    ...defaults, top: [0, 0, 0], bottom: [0, 0, 0], accent: [255, 255, 255],
    opacity: 1, bottomOpacityScale: 1, gpuGain: 0
  };
  const width = 400;
  const height = 200;
  function patchMean(pixels, left, top) {
    let sum = 0;
    for (let y = top; y < top + 10; y++) {
      for (let x = left; x < left + 10; x++) sum += pixels[(y * width + x) * 4];
    }
    return sum / 100;
  }
  const pixels = createAmbientPixels(width, height, options);
  const centre = patchMean(pixels, 187, 61);
  const middle = patchMean(pixels, 257, 61);
  const outside = patchMean(pixels, 367, 61);
  assert.ok(centre > middle && middle > outside);
  assert.ok(outside > 0, "faint tail remains rather than ending at a hard radial boundary");
  const stronger = createAmbientPixels(width, height, { ...options, baseGlow: defaults.baseGlow * 2 });
  assert.ok(Math.abs(patchMean(stronger, 187, 61) - centre * 2) < .3);
});

test("adjacent-level rounding retains fractional block means and translucent composition", () => {
  const alpha = .473;
  const colour = [21.3, 67.8, 143.2];
  const pixels = createAmbientPixels(512, 512, {
    ...defaults, top: colour, bottom: colour, opacity: alpha, bottomOpacityScale: 1, gpuGain: 0, baseGlow: 0
  });
  assert.ok(Math.abs(mean(pixels, 3) - alpha * 255) < .01);
  for (let channel = 0; channel < 3; channel++) {
    const wanted = colour[channel] * alpha;
    assert.ok(Math.abs(mean(pixels, channel, true) - wanted) < .01);
    const levels = new Set();
    for (let index = channel; index < pixels.length; index += 4) {
      levels.add(Math.round(pixels[index] * pixels[index - channel + 3] / 255));
    }
    assert.deepEqual([...levels].sort((a, b) => a - b), [Math.floor(wanted), Math.ceil(wanted)]);
    const overWhite = mean(pixels, channel, true) + 255 - mean(pixels, 3);
    assert.ok(Math.abs(overWhite - (wanted + 255 * (1 - alpha))) < .02);
  }
});

test("light and dark bottom opacity factors preserve their distinct endpoints", () => {
  for (const scale of [.92, .97]) {
    const pixels = createAmbientPixels(128, 128, {
      ...defaults, opacity: .8, bottomOpacityScale: scale, gpuGain: 0, baseGlow: 0
    });
    assert.ok(Math.abs(pixels[3] - .8 * 255) < 1);
    assert.ok(Math.abs(pixels.at(-1) - .8 * scale * 255) < 1);
    assert.ok(pixels.at(-1) < pixels[3]);
  }
});

test("custom background clears base colour and base glow while retaining transparent GPU light", () => {
  const options = { ...defaults, customBackground: true };
  const clear = createAmbientPixels(64, 32, { ...options, gpuGain: 0 });
  assert.ok(clear.every(value => value === 0));
  const pixels = createAmbientPixels(128, 64, options);
  assert.deepEqual(pixels, createAmbientPixels(128, 64, {
    ...options, top: [255, 0, 0], bottom: [0, 255, 0], opacity: 1, baseGlow: 1
  }));
  assert.ok(mean(pixels, 3) > 0, "GPU ambient light must still be present");
  for (const index of [3, 128 * 4 - 1, (63 * 128) * 4 + 3, pixels.length - 1]) {
    assert.ok(pixels[index] < 32, "the edge must not acquire an opaque backing rectangle");
  }
});

test("ambient worker transfers pixel storage and reports invalid requests", () => {
  const replies = [];
  const scope = { postMessage: (...args) => replies.push(args) };
  Function("exports", "require", "globalThis", "performance", transpile("../../src/workers/ambientBackground.worker.ts"))(
    {}, () => exportsObject, scope, { now: () => 10 }
  );
  scope.onmessage({ data: { id: 17, width: 8, height: 4, options: defaults } });
  const [response, transfer] = replies[0];
  assert.equal(response.id, 17);
  assert.equal(response.width, 8);
  assert.equal(response.height, 4);
  assert.equal(response.pixels.length, 128);
  assert.deepEqual(response.pixels, createAmbientPixels(8, 4, defaults));
  assert.strictEqual(transfer[0], response.pixels.buffer);
  assert.equal(response.durationMs, 0);
  scope.onmessage({ data: { id: 18, width: 0, height: 4, options: defaults } });
  assert.equal(replies[1][0].id, 18);
  assert.match(replies[1][0].error, /dimensions/);
  assert.equal(replies[1][1], undefined);
});
