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

test("the floor reflection is a masked copy, not -webkit-box-reflect", () => {
  // 2.18.6 field trace (4K, 300%, fullscreen): box-reflect rasterized its gradient
  // mask at full card size and sent it with every compositor frame, 6-18 MB, 18 fps;
  // a plain mask-image measured 59 fps and 0 MB. Its "none" value is also invalid in
  // Chromium 130, so low-performance mode never switched it off.
  assert.doesNotMatch(css, /box-reflect/);
  const reflection = rules.find(rule => rule.selector === ".media-flow-reflection");
  assert.ok(reflection, "reflection rule");
  for (const pattern of [/position:absolute/, /top:calc\(100% \+ 2px\)/, /height:32%/, /overflow:hidden/, /pointer-events:none/,
    /-webkit-mask-image:linear-gradient\(to bottom,rgba\(0,0,0,\.15\),transparent\)/, /(^|;)\s*mask-image:linear-gradient\(to bottom,rgba\(0,0,0,\.15\),transparent\)/])
    assert.match(reflection.body.replace(/\s+/g, " ").replace(/: /g, ":"), pattern);
  assert.ok(rules.some(rule => rule.selector === ".media-flow-reflection > div" && /transform:\s*scaleY\(-1\)/.test(rule.body)));
  assert.ok(rules.some(rule => rule.selector === ".low-performance-mode .media-flow-reflection" && /display:\s*none/.test(rule.body)), "low-performance mode removes it");
  assert.ok(rules.some(rule => rule.selector === ".media-flow-reflection" && /z-index:\s*-1/.test(rule.body)), "painted under the card's shadow");
  assert.ok(rules.some(rule => rule.selector === ".media-flow-reflection .library-entry-media::after" && /transition:\s*none/.test(rule.body)), "no composited child under the mask");
  const view = fs.readFileSync(path.join(__dirname, "../../src/components/MediaFlow.tsx"), "utf8");
  assert.match(view, /\{reflections\?\.\[i\] \? <div className="media-flow-reflection" aria-hidden="true" \{\.\.\.\{ inert: "" \}\}><div>\{reflections\[i\]\}<\/div><\/div> : null\}<\/div>;/);
  // The real card comes first, so lookups for the card still find it.
  assert.ok(view.indexOf('style={distance ? { pointerEvents: "none" } : undefined}>{child}</div>') < view.indexOf('className="media-flow-reflection"'));
});

test("the reflection mirrors only the artwork, never the card's text or buttons", () => {
  // 2.18.7: the reflection was a second copy of the whole card, so the path, the
  // title and "+ add layer" showed up reversed under the slider and every card
  // (thumbnails, observers, buttons) was mounted twice.
  const view = fs.readFileSync(path.join(__dirname, "../../src/components/MediaFlow.tsx"), "utf8");
  assert.doesNotMatch(view, /media-flow-reflection[^\n]*\{child\}/, "the card itself is not reflected");
  const library = fs.readFileSync(path.join(__dirname, "../../src/components/MusicLibrary.tsx"), "utf8");
  assert.match(library, /reflections=\{visibleEntries\.map\(renderFlowReflection\)\}/);
  const start = library.indexOf("const renderFlowReflection = ");
  assert.ok(start > 0, "renderFlowReflection exists");
  const body = library.slice(start, library.indexOf("\n  };", start));
  assert.match(body, /LibraryThumbnail/);
  for (const forbidden of [/library-entry-title/, /library-entry-primary/, /library-entry-actions/, /library-folder-badge/, /<button/, /renderLibraryEntry/, /\{count\}/])
    assert.doesNotMatch(body, forbidden);
  assert.ok(rules.some(rule => rule.selector === ".media-flow-reflection > div" && /height:\s*var\(--flow-art-height/.test(rule.body)), "sized to the cover, not the card");
});

test("the reflected cover has the card's artwork size, so both crop alike", () => {
  // The reflection used --flow-cover-height (card - 100), 26px taller than the
  // card's artwork row, so object-fit: cover cut a different part of the image.
  const view = fs.readFileSync(path.join(__dirname, "../../src/components/MediaFlow.tsx"), "utf8");
  const constant = name => Number(new RegExp(`export const ${name} = (\\d+);`).exec(view)[1]);
  assert.match(view, /setProperty\("--flow-art-height", `\$\{cardHeight - \(compact \? FLOW_COMPACT_TEXT_ROWS : FLOW_TEXT_ROWS\)\}px`\)/);
  const px = value => value.split(/\s+/).filter(Boolean).reduce((sum, part) => sum + (/^\d+px$/.test(part) ? Number.parseFloat(part) : 0), 0);
  const nonArt = (rows, gap) => {
    const tracks = rows.trim().split(/\s+(?![^(]*\))/);
    assert.match(tracks[0], /^minmax\(0,\s*1fr\)$/, "the artwork is the flexible first row");
    return 2 * 1 + 2 * 8 + px(tracks.slice(1).join(" ")) + (tracks.length - 1) * gap;
  };
  const card = rules.find(rule => rule.selector === ".media-flow .library-entry" && /grid-template-rows/.test(rule.body)).body;
  assert.match(card, /padding:\s*8px/);
  assert.match(css, /\.media-flow \.library-entry \{[^}]*border: 1px solid/);
  const gap = Number(/(^|;)\s*gap:\s*(\d+)px/.exec(card)[2]);
  assert.equal(nonArt(/grid-template-rows:\s*([^;]+);/.exec(card)[1], gap), constant("FLOW_TEXT_ROWS"));
  const compact = rules.find(rule => rule.selector === ".flow-compact .library-entry").body;
  assert.equal(nonArt(/grid-template-rows:\s*([^;]+);/.exec(compact)[1], Number(/gap:\s*(\d+)px/.exec(compact)[1])), constant("FLOW_COMPACT_TEXT_ROWS"));
  const reflection = rules.find(rule => rule.selector === ".media-flow-reflection" && /left:/.test(rule.body)).body;
  assert.match(reflection, /left:9px; right:9px;/, "inset by the card's border and padding");
  const library = fs.readFileSync(path.join(__dirname, "../../src/components/MusicLibrary.tsx"), "utf8");
  const start = library.indexOf("const renderFlowReflection = ");
  const body = library.slice(start, library.indexOf("\n  };", start));
  assert.equal((body.match(/<LibraryThumbnail /g) || []).length, (body.match(/fullscreen=\{previewFullscreen\}/g) || []).length,
    "reflected thumbnails observe the same root as the cards");
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
