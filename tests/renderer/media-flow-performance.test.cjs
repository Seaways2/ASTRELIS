// 2.18.3 field report: Cover Flow was the only library view that stuttered.
// Each of the up to seven overlapping 3D cards blurred its backdrop (and the
// box-reflect copied that blur) over the animated background, and side covers
// dimmed through an animated filter. Keep those costs out of the flow.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "../../src/components/MediaFlow.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));

test("cover flow cards do not blur their backdrop", () => {
  const blurred = rules.filter(rule => /media-flow/.test(rule.selector) && /backdrop-filter\s*:\s*(?!none)/.test(rule.body));
  assert.deepEqual(blurred.map(rule => rule.selector), []);
});

test("side covers dim through a shade layer, not an animated filter", () => {
  const filtered = rules.filter(rule => /media-flow-item/.test(rule.selector) && /(^|;|\s)filter\s*:/.test(rule.body));
  assert.deepEqual(filtered.map(rule => rule.selector), []);
  assert.ok(rules.some(rule => /media-flow-item:not\(\.selected\) \.library-entry-media::after/.test(rule.selector) && /opacity\s*:\s*\.18/.test(rule.body)));
  assert.ok(rules.some(rule => rule.selector === ".media-flow-item .library-entry-media::after" && /transition\s*:\s*opacity/.test(rule.body)));
});

test("reduced motion, animations off and low performance stop the shade transition too", () => {
  for (const scope of ["prefers-reduced-motion", ".animations-off .media-flow-item .library-entry-media::after", ".low-performance-mode .media-flow-item .library-entry-media::after"])
    assert.ok(css.includes(scope), scope);
});
