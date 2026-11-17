// Pointer interaction on the galaxy, starfield and black hole: hovering steers
// or bends, a press sends one impulse, and with no pointer over the canvas a
// scene draws exactly as it did before. The scenes run on a synthetic song
// with a seeded Math.random, and a recording canvas measures where light lands.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createVisualizerScene, installCanvasGlobals, layoutOf, song, smoothFrequencyFrame, defaultSettings } = require("../../scripts/lib/sceneHarness.cjs");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const WIDTH = 1600, HEIGHT = 900, SCALE = Math.min(WIDTH, HEIGHT);

/** Like the harness light meter, but reports where each additive draw lands (translations followed). */
function recordingCanvas(record) {
  const gradient = { addColorStop() {} };
  let radius = 0, arcX = 0, arcY = 0, pathLength = 0, lastX = 0, lastY = 0, midX = 0, midY = 0;
  let offsetX = 0, offsetY = 0;
  const stack = [];
  const state = { globalAlpha: 1, globalCompositeOperation: "source-over", lineWidth: 1 };
  const add = (kind, amount, x, y) => {
    if (state.globalCompositeOperation === "lighter") record(kind, state.globalAlpha * amount, x + offsetX, y + offsetY, amount);
  };
  const methods = {
    save() { stack.push([offsetX, offsetY]); },
    restore() { [offsetX, offsetY] = stack.pop() || [0, 0]; },
    translate(x, y) { offsetX += x; offsetY += y; },
    beginPath() { radius = 0; pathLength = 0; },
    arc(x, y, r) { radius = Math.max(radius, r); arcX = x; arcY = y; },
    ellipse(x, y, rx) { radius = Math.max(radius, rx); arcX = x; arcY = y; },
    fill() { add("fill", Math.PI * radius * radius, arcX, arcY); },
    fillRect(x, y, w, h) { add("fill", Math.abs(w * h), x + w / 2, y + h / 2); },
    drawImage(image, x, y, w, h) { add("image", (w ?? image.width) * (h ?? image.height), NaN, NaN); },
    moveTo(x, y) { lastX = x; lastY = y; },
    lineTo(x, y) { pathLength += Math.hypot(x - lastX, y - lastY); midX = (x + lastX) / 2; midY = (y + lastY) / 2; lastX = x; lastY = y; },
    stroke() { add("stroke", pathLength * state.lineWidth, midX, midY); },
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient
  };
  const context = new Proxy(state, {
    get: (target, key) => key in target ? target[key] : methods[key] || (() => undefined),
    set: (target, key, value) => { target[key] = value; return true; }
  });
  return { width: 300, height: 150, getContext: () => context };
}

/**
 * Runs a scene for `seconds` at 60 FPS. `pointerAt(t)` returns the pointer
 * state to send before that frame (or undefined to send nothing); `observe(t,
 * kind, amount, x, y)` sees every additive draw. Returns the light per frame.
 */
function simulate(mode, { seconds, interactive = true, pointerAt = () => undefined, observe = () => {}, seed = 7 }) {
  const original = Math.random;
  let state = seed;
  Math.random = () => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;
  try {
    installCanvasGlobals();
    let t = 0, light = 0;
    const canvas = recordingCanvas((kind, amount, x, y, area) => { light += amount; observe(t, kind, amount, x, y, area); });
    const scene = createVisualizerScene(canvas, {
      mode, accent: "#38d3e1", settings: defaultSettings, glowStrength: 1, playbackActive: true,
      backgroundBrightness: 1, backgroundOpacity: 1, interactive
    });
    scene.resize(layoutOf(WIDTH, HEIGHT));
    const frames = song();
    const lights = [];
    let smoothed;
    for (let index = 0; index < Math.round(seconds * 60); index++) {
      t = index / 60;
      smoothed = smoothFrequencyFrame(frames(t), smoothed, defaultSettings.smoothing, smoothed ? 1000 / 60 : 0);
      const data = smoothed;
      const pointer = pointerAt(t);
      if (pointer) scene.pointer(pointer);
      light = 0;
      scene.draw(10000 + index * 1000 / 60, { getFrequencyData: () => data, meters: () => ({ sampleRate: 48000 }) });
      lights.push(light);
    }
    return lights;
  } finally {
    Math.random = original;
  }
}

const within = (from, to) => t => t >= from && t < to;
/** Light inside a circle (or annulus) around (x, y) during a time window. */
const lightNear = (x, y, inner, outer, during) => {
  const total = { value: 0 };
  return {
    total,
    observe: (t, kind, amount, px, py) => {
      if (!during(t) || !Number.isFinite(px)) return;
      const distance = Math.hypot(px - x, py - y);
      if (distance >= inner && distance < outer) total.value += amount;
    }
  };
};
const sum = (values, from, to) => values.slice(Math.round(from * 60), Math.round(to * 60)).reduce((a, b) => a + b, 0);
const hover = (x, y, from, to = Infinity, pressFrom = Infinity, pressTo = -Infinity) => t => {
  const inside = t >= from && t < to;
  return { x, y, inside, pressed: inside && t >= pressFrom && t < pressTo, press: inside && Math.abs(t - pressFrom) < 1 / 120 };
};

test("with no pointer over it, or interaction off, every scene draws exactly as before", () => {
  for (const mode of ["waveform", "particles", "pulse"]) {
    const plain = simulate(mode, { seconds: 4, interactive: false });
    const idle = simulate(mode, { seconds: 4, pointerAt: t => ({ x: .7, y: .4, inside: false, pressed: false }) });
    const ignored = simulate(mode, { seconds: 4, interactive: false, pointerAt: hover(.7, .4, 1, 3, 1.5, 2) });
    assert.deepEqual(idle, plain, `${mode}: a pointer outside the canvas must change nothing`);
    assert.deepEqual(ignored, plain, `${mode}: a scene without interaction must ignore the pointer`);
  }
});

test("starfield: a held press warps the flight, and it coasts back after release", () => {
  const trails = run => { const light = new Float64Array(12 * 60); simulate("particles", { ...run, observe: (t, kind, amount) => { if (kind === "stroke") light[Math.round(t * 60)] += amount; } }); return [...light]; };
  const base = trails({ seconds: 9 });
  const warped = trails({ seconds: 9, pointerAt: hover(.5, .5, 1, Infinity, 2, 3.5) });
  assert.ok(sum(warped, 2.8, 3.5) > sum(base, 2.8, 3.5) * 2, "holding should stretch the trails well past the music's own");
  assert.ok(sum(warped, 8, 9) < sum(base, 8, 9) * 1.3, "the warp should have coasted down within a few seconds of release");
});

test("starfield: the flight turns towards the pointer and back when it leaves", () => {
  const centroid = (run, from, to) => {
    let weight = 0, x = 0;
    simulate("particles", { ...run, observe: (t, kind, amount, px) => { if (kind === "fill" && t >= from && t < to && Number.isFinite(px)) { weight += amount; x += amount * px; } } });
    return x / weight;
  };
  // Measured against the same flight without a pointer: the field's own light
  // is not centred to begin with.
  const steered = centroid({ seconds: 5.5, pointerAt: hover(.95, .5, 1, 6) }, 4, 5.5) - centroid({ seconds: 5.5 }, 4, 5.5);
  assert.ok(steered > WIDTH * .05, `stars should stream from a vanishing point towards the pointer (moved ${steered.toFixed(0)} px)`);
  const settled = centroid({ seconds: 11, pointerAt: hover(.95, .5, 1, 6) }, 10, 11) - centroid({ seconds: 11 }, 10, 11);
  assert.ok(Math.abs(settled) < WIDTH * .03, `the view should settle back after the pointer leaves (off by ${settled.toFixed(0)} px)`);
});

test("galaxy: hovering gathers and lights the stars near the pointer, and lets go after", () => {
  const [px, py] = [WIDTH * .62, HEIGHT * .5];
  const near = (run, from, to) => { const probe = lightNear(px, py, 0, SCALE * .1, within(from, to)); simulate("waveform", { ...run, observe: probe.observe }); return probe.total.value; };
  const base = near({ seconds: 4 }, 3, 4);
  assert.ok(near({ seconds: 4, pointerAt: hover(.62, .5, 1) }, 3, 4) > base * 1.25, "the gravity well should gather light around the pointer");
  const after = near({ seconds: 7, pointerAt: hover(.62, .5, 1, 4) }, 6, 7);
  const baseAfter = near({ seconds: 7 }, 6, 7);
  assert.ok(Math.abs(after - baseAfter) < baseAfter * .1, "the stars should spring back once the pointer leaves");
});

test("galaxy: a press sends a density wave outwards at its own speed", () => {
  const [px, py] = [WIDTH * .3, HEIGHT * .5];
  // 0.5 s after the press the front is half a scale-unit per second away.
  const front = SCALE * .5 * .5;
  const ring = run => { const probe = lightNear(px, py, front - SCALE * .05, front + SCALE * .05, within(1.47, 1.53)); simulate("waveform", { ...run, observe: probe.observe }); return probe.total.value; };
  const base = ring({ seconds: 1.6, pointerAt: hover(.3, .5, .9) });
  const pressed = ring({ seconds: 1.6, pointerAt: hover(.3, .5, .9, Infinity, 1, 1.05) });
  assert.ok(pressed > base * 1.2, "the stars on the wave front should light up");
});

test("galaxy: the press wave ripples the stars outwards without drawing an edge", () => {
  const [px, py] = [WIDTH * .3, HEIGHT * .5];
  const front = SCALE * .5 * .5;
  const band = (inner, outer, run) => { const probe = lightNear(px, py, front + SCALE * inner, front + SCALE * outer, within(1.47, 1.53)); simulate("waveform", { ...run, observe: probe.observe }); return probe.total.value; };
  const base = { seconds: 1.6, pointerAt: hover(.3, .5, .9) };
  const pressed = { seconds: 1.6, pointerAt: hover(.3, .5, .9, Infinity, 1, 1.05) };
  // Only a soft lift on the front: no bright ring.
  const lift = band(-.05, .05, pressed) / band(-.05, .05, base);
  assert.ok(lift < 1.6, `the wave front should stay soft (light ×${lift.toFixed(2)})`);
  // The stars it passes are pushed outwards: light moves from behind the front to ahead of it.
  const shift = (band(.0, .06, pressed) / band(.0, .06, base)) / (band(-.06, 0, pressed) / band(-.06, 0, base));
  assert.ok(shift > 1.03, `the wave should push the stars outwards (ahead/behind ×${shift.toFixed(3)})`);
  const scene = read("src/visualizers/visualizerScene.ts");
  assert.doesNotMatch(scene, /context\.arc\(wave\.x, wave\.y/, "the wave front is not drawn as a ring");
  assert.match(scene, /const waveWidth = scale \* \.06;/);
});

test("black hole: the pointer lens reaches wider and trails the pointer with damping", () => {
  const lensLight = (x, inner, outer, from, to, pointerAt) => {
    const probe = lightNear(WIDTH * x, HEIGHT * .5, SCALE * inner, SCALE * outer, within(from, to));
    simulate("pulse", { seconds: to + .05, pointerAt, observe: probe.observe });
    return probe.total.value;
  };
  // Wider: the stars it pushes out pile up 0.12–0.2 scale-units from the pointer
  // (the earlier lens reached 0.16 and barely moved them that far out).
  const ring = lensLight(.72, .12, .2, 1.8, 2.2, hover(.72, .5, .5));
  const ringBase = lensLight(.72, .12, .2, 1.8, 2.2, () => undefined);
  assert.ok(ring > ringBase * 1.25, `the lens should reach stars 0.12–0.2 scale-units away (×${(ring / ringBase).toFixed(2)})`);
  // Damped: after the pointer jumps from 0.28 to 0.72, the lens is still on its way.
  const jump = t => ({ x: t < 2 ? .28 : .72, y: .5, inside: t >= .5, pressed: false, press: false });
  const justAfter = lensLight(.72, 0, .08, 2.0, 2.06, jump);
  const settled = lensLight(.72, 0, .08, 3.2, 3.26, jump);
  const untouched = lensLight(.72, 0, .08, 2.0, 2.06, () => undefined);
  assert.ok(justAfter > untouched * .7, `the lens should not arrive at once (×${(justAfter / untouched).toFixed(2)})`);
  assert.ok(settled < untouched * .7 && settled < justAfter * .8, `the lens should settle under the pointer (×${(settled / untouched).toFixed(2)})`);
});

test("black hole: a press drops matter that spirals in, flares the disk and then is gone", () => {
  const center = [WIDTH / 2, HEIGHT / 2];
  const probeRun = run => {
    const nearPress = lightNear(WIDTH * .7, HEIGHT * .5, 0, SCALE * .07, within(1.05, 1.4));
    const disk = new Float64Array(12 * 60);
    // Stars, motes and the dropped matter: every small dot (the waves and disk are large).
    const dots = new Float64Array(12 * 60);
    simulate("pulse", { ...run, observe: (t, kind, amount, x, y, area) => {
      nearPress.observe(t, kind, amount, x, y);
      if (Number.isFinite(x) && Math.hypot(x - center[0], y - center[1]) < SCALE * .2) disk[Math.round(t * 60)] += amount;
      if (kind === "fill" && area < 700) dots[Math.round(t * 60)] += amount;
    } });
    return { nearPress: nearPress.total.value, disk: [...disk], dots: [...dots] };
  };
  const base = probeRun({ seconds: 11, pointerAt: hover(.7, .5, .9, 1.2) });
  const fed = probeRun({ seconds: 11, pointerAt: hover(.7, .5, .9, 1.2, 1, 1.1) });
  assert.ok(fed.nearPress > base.nearPress * 1.3, "the dropped matter should first show where it was dropped");
  let flare = 0;
  for (let second = 1.5; second < 7; second += .25) flare = Math.max(flare, sum(fed.disk, second, second + .25) / sum(base.disk, second, second + .25));
  assert.ok(flare > 1.12, `swallowed matter should brighten the disk and halo (peak ×${flare.toFixed(2)})`);
  // The feed's own wave shifts when later beat waves start, so compare only the
  // dots: with all the matter swallowed they are exactly the same as without it.
  const settled = sum(fed.dots, 10, 11) / sum(base.dots, 10, 11);
  assert.ok(Math.abs(settled - 1) < .001, `everything should have been swallowed (dots ×${settled.toFixed(4)})`);
});

test("the page sends the pointer to the scene only when interaction is on", () => {
  const protocol = read("src/visualizers/visualizerProtocol.ts");
  assert.match(protocol, /\{ type: "pointer"; id: number; pointer: VisualizerPointer \}/);
  assert.match(read("src/workers/visualizer.worker.ts"), /case "pointer":\s*surface\.scene\?\.pointer\(data\.pointer\);/);
  const canvas = read("src/visualizers/VisualizerCanvas.tsx");
  assert.match(canvas, /if \(!canvas \|\| !current \|\| !interactive \|\| !visible\) return;/);
  // Only the primary button presses: right-click keeps the background menu.
  assert.match(canvas, /if \(event\.button !== 0\) return;/);
  // Moves are coalesced to one message a frame; presses go at once.
  assert.match(canvas, /if \(!frame\) frame = requestAnimationFrame\(\(\) => \{ frame = 0; send\(\); \}\);/);
  const app = read("src/App.tsx");
  assert.match(app, /const visualizerInteractive = state\.visualSettings\.pointerInteraction && !lowPerformanceMode && !reducedMotion && !state\.obsMode;/);
  assert.match(app, /interactive=\{visualizerInteractive\}/);
  assert.match(app, /state\.setVisualSetting\("pointerInteraction", e\.target\.checked\)/);
});

test("pointer interaction is on by default, survives upgrades as a boolean and has copy in every language", () => {
  const store = read("src/stores/playerStore.ts");
  assert.match(store, /pointerInteraction: true\n\};/);
  assert.match(store, /if \(typeof stored\.pointerInteraction !== "boolean"\) stored\.pointerInteraction = defaultVisualizerSettings\.pointerInteraction;/);
  const copy = read("src/i18n/index.ts");
  for (const key of ["visual.pointer", "visual.pointerHint"]) assert.equal(copy.split(`"${key}"`).length - 1, 3, key);
});
