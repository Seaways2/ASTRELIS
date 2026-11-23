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
  const blurred = rules.filter(rule => /media-flow/.test(rule.selector) && /backdrop-filter\s*:(?!\s*none)/.test(rule.body));
  assert.deepEqual(blurred.map(rule => rule.selector), []);
});

test("cover flow cards switch off the panel glass they inherit from surfaces.css", () => {
  // 2.18.5 still blurred: .library-entry is in the shared glass list. The
  // override must name the card and its blurred buttons, both prefixes, and
  // outrank the shared rule (4 classes: .app-shell + 2 :not() + :is()).
  const surfaces = fs.readFileSync(path.join(__dirname, "../../src/styles/surfaces.css"), "utf8");
  const glass = /\.app-shell:not\(\.obs-mode\):not\(\.immersive-mode\) :is\(([^)]*)\) \{[^}]*backdrop-filter: var\(--surface-glass-filter\)/.exec(surfaces);
  assert.ok(glass, "shared glass rule kept its selector shape");
  assert.match(glass[1], /\.library-entry\b/);
  const override = rules.findLast(rule => rule.selector.split(",").map(part => part.trim()).includes(".app-shell .music-library .media-flow .media-flow-item .library-entry"));
  assert.ok(override, "cover flow card override exists");
  assert.match(override.body, /(^|[;\s])backdrop-filter\s*:\s*none/);
  assert.match(override.body, /-webkit-backdrop-filter\s*:\s*none/);
  for (const button of ["favorite-track-action", "favorite-select-action", "library-hidden-indicator", "library-artwork-trigger"])
    assert.ok(override.selector.includes(button), button);
  assert.ok(css.indexOf(override.selector) > css.lastIndexOf("backdrop-filter: blur"), "nothing later in MediaFlow.css blurs again");
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
