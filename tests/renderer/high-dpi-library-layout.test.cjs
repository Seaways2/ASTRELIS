// 2.18.5 field archive item 3: at 225-300% Windows scaling a 4K panel leaves
// 1822x912 CSS px or less, so the cover flow dropped into compact cards with a
// one-line title. Short windows now merge the library rows into the title row,
// use a tighter transport and let cards grow past 660 CSS px above 200%.
// Ordinary sizes (>= 950 CSS px tall, <= 200% scaling) must stay exactly as before.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, "");

const flowSource = read("src/components/MediaFlow.tsx");
const compiled = ts.transpileModule(flowSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const flowModule = { exports: {} };
vm.runInNewContext(compiled, { module: flowModule, exports: flowModule.exports, require: () => ({}) });
const { flowCardHeight, FLOW_COMPACT_CARD_HEIGHT } = flowModule.exports;
const previousCardHeight = (height, zoom) => Math.max(150, Math.round(Math.max(180, Math.min(660, height - 68)) * zoom));

/** Top-level @media blocks of a stylesheet, with their prelude and body. */
const mediaBlocks = css => {
  const blocks = [];
  let depth = 0, start = -1, prelude = "";
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{") {
      if (depth === 0) {
        const head = css.slice(css.lastIndexOf("}", i) + 1, i).trim();
        if (head.startsWith("@media")) { start = i + 1; prelude = head; }
      }
      depth++;
    } else if (css[i] === "}") {
      depth--;
      if (depth === 0 && start >= 0) { blocks.push({ prelude, start, end: i, body: css.slice(start, i) }); start = -1; }
    }
  }
  return blocks;
};
const normalise = text => text.replace(/\s+/g, "");

test("cover flow cards keep the old size at 200% scaling or less", () => {
  assert.equal(FLOW_COMPACT_CARD_HEIGHT, 340);
  for (const dpr of [1, 1.25, 1.5, 1.75, 2])
    for (let height = 150; height <= 1600; height += 7)
      for (const zoom of [1, .5])
        assert.equal(flowCardHeight(height, zoom, dpr), previousCardHeight(height, zoom), `${height} px at ${dpr}x, zoom ${zoom}`);
  // A missing or broken ratio falls back to 1.
  for (const dpr of [0, -1, NaN, Infinity]) assert.equal(flowCardHeight(1400, 1, dpr), 660);
});

test("above 200% the field cases leave compact mode and the cap stays inside the panel", () => {
  // 1822x912 at 225%, with the merged title row: a 662 px flow.
  assert.equal(flowCardHeight(662, 1, 2.25), 594);
  // 300% on 4K leaves a 672 DIP tall work area; windowFit's fitted UI zoom
  // (height / 720) keeps the page 720 CSS px tall, so devicePixelRatio is
  // 3 * 672 / 720 = 2.8, not 3. Either way it is a 470 px flow and the cap does not bind.
  assert.equal(flowCardHeight(470, 1, 2.8), 402);
  assert.equal(flowCardHeight(470, 1, 3), 402);
  for (const [height, dpr] of [[662, 2.25], [470, 2.8], [470, 3]]) assert.ok(flowCardHeight(height, 1, dpr) >= FLOW_COMPACT_CARD_HEIGHT);
  assert.equal(flowCardHeight(1400, 1, 2.25), 825);
  // Never past a 4K panel's 2160 device px where the cap grew, never below today's 660.
  for (let dpr = 2; dpr <= 4.001; dpr += .05) {
    const card = flowCardHeight(5000, 1, dpr);
    assert.ok(card >= 660, `${dpr}x`);
    assert.ok(card === 660 || card <= Math.round(2160 / dpr), `${dpr}x: ${card} px`);
  }
  for (let dpr = 2; dpr <= 3.001; dpr += .05) assert.ok(flowCardHeight(5000, 1, dpr) <= Math.round(2160 / dpr), `${dpr}x`);
});

test("cards never overflow the stage or the navigation, and zoom still scales them", () => {
  for (let dpr = 1; dpr <= 4.001; dpr += .25)
    for (let height = 248; height <= 2400; height += 13) {
      const base = flowCardHeight(height, 1, dpr);
      assert.ok(base <= height - 68, `${height} px at ${dpr}x`);
      // Zoom scales the unrounded size, so allow the rounding step.
      assert.ok(Math.abs(flowCardHeight(height, .5, dpr) - Math.max(150, Math.round(base * .5))) <= 1, `zoom at ${height} px, ${dpr}x`);
    }
});

test("the card cap is continuous where its rule changes", () => {
  for (const dpr of [2, 2160 / 660]) {
    const below = flowCardHeight(5000, 1, dpr - 1e-6), above = flowCardHeight(5000, 1, dpr + 1e-6);
    assert.ok(Math.abs(below - above) <= 1, `${dpr}x: ${below} vs ${above}`);
  }
});

test("MediaFlow sizes cards through flowCardHeight and follows display scale changes", () => {
  assert.match(flowSource, /const cardHeight = flowCardHeight\(element\.clientHeight, zoom, devicePixelRatio\);/);
  assert.match(flowSource, /const compact = cardHeight < FLOW_COMPACT_CARD_HEIGHT;/);
  assert.match(flowSource, /matchMedia\(`\(resolution: \$\{devicePixelRatio\}dppx\)`\)/);
  assert.match(flowSource, /scale\?\.removeEventListener\("change", rescale\)/);
  assert.match(flowSource, /\}, \[navigationKey, zoom\]\);/);
});

const flowCss = stripComments(read("src/components/MediaFlow.css"));
const modulesCss = stripComments(read("src/styles/workspace-modules.css"));
const popoverGate = "@media(max-height:949px),(max-width:1180px)";

test("both copies of the filter popover gate fold at 949 px tall", () => {
  for (const [name, css] of [["MediaFlow.css", flowCss], ["workspace-modules.css", modulesCss]]) {
    assert.ok(mediaBlocks(css).some(block => normalise(block.prelude) === popoverGate), name);
    assert.doesNotMatch(css, /max-height:\s*850px/, name);
  }
  const popover = mediaBlocks(flowCss).find(block => normalise(block.prelude) === popoverGate);
  assert.match(popover.body, /\.library-flow-layout > \.library-tools-toggle \{ display:flex;/);
});

test("the title row gate in MusicLibrary matches the CSS height bound", () => {
  const library = read("src/components/MusicLibrary.tsx");
  const query = /export const FLOW_TITLE_ROW_QUERY = "\(max-height: (\d+)px\)";/.exec(library);
  assert.ok(query, "FLOW_TITLE_ROW_QUERY");
  assert.equal(Number(query[1]), Number(/max-height:(\d+)px/.exec(popoverGate)[1]));
  assert.match(library, /matchMedia\(FLOW_TITLE_ROW_QUERY\)/);
  assert.match(library, /const flowTitleRow = shortWindow && libraryView === "flow" && totalListItems > 0 && !previewFullscreen && Boolean\(statsSlot\);/);
  // Ordinary windows render the toggle and breadcrumbs where they always were.
  assert.match(library, /\{protection\.error && [^\n]*\n\s*\{!flowTitleRow && toolsToggle\}\n\s*<div className="library-header library-header-simple panel">/);
  assert.match(library, /<\/section>\n\s*<\/div>\n\s*\{!flowTitleRow && breadcrumbs\}\n\s*\{!favoritesInTitleRow && favoritesBreadcrumb\}\n/);
  // One portal: toggle, breadcrumbs, the favorites bar where it fits, then the stats.
  assert.match(library, /createPortal\(<>\{flowTitleRow && toolsToggle\}\{flowTitleRow && breadcrumbs\}\{favoritesInTitleRow && favoritesBreadcrumb\}\{stats\}<\/>, statsSlot\)/);
  // The favorites bar (bulk actions) needs a wide header; narrower short windows keep it in the body.
  assert.match(library, /export const FLOW_TITLE_ROW_FAVORITES_QUERY = "\(min-width: 1680px\)";/);
  assert.match(library, /matchMedia\(FLOW_TITLE_ROW_FAVORITES_QUERY\)/);
  assert.match(library, /const favoritesInTitleRow = flowTitleRow && wideWindow;/);
  assert.match(library, /const favoritesBreadcrumb = facet === "收藏" && <div className="folder-breadcrumb favorites-breadcrumb">/);
  assert.doesNotMatch(library.slice(library.indexOf("const breadcrumbs = <>"), library.indexOf("const favoritesBreadcrumb")), /favorites-breadcrumb/);
  assert.match(library, /\$\{flowTitleRow \? "library-flow-title-row" : ""\}/);
  assert.equal(library.split('className="folder-breadcrumb').length - 1, 3, "each breadcrumb is defined once");
  assert.equal(library.split('className="library-tools-toggle"').length - 1, 1, "the toggle is defined once");
});

test("every title-row rule is scoped to the short-window class", () => {
  const rules = [...flowCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
  const titleRow = rules.filter(rule => /page-header-aside|\.eyebrow|\.page-icon/.test(rule.selector)
    || (/\.workspace-page/.test(rule.selector) && /padding|grid-template-rows:\s*40px/.test(rule.body)));
  assert.ok(titleRow.length >= 6, "title row rules found");
  for (const rule of titleRow) assert.match(rule.selector, /library-flow-title-row/, rule.selector);
  // The merged toggle shows only where the filters are folded into the popover.
  const toggle = mediaBlocks(flowCss).find(block => normalise(block.prelude) === "@media(max-height:949px)");
  assert.ok(toggle, "title-row toggle gate");
  assert.match(toggle.body, /> \.page-header-aside > \.library-tools-toggle \{ display:flex;/);
  assert.match(toggle.body, /\.app-shell \.library-flow-layout\.library-flow-title-row > \.library-header \{ top:0;/);
  // In the title row the favorites bar keeps its size so "add selected" is never clipped.
  assert.match(flowCss, /> \.page-header-aside > \.favorites-breadcrumb \{ flex:0 0 auto;/);
  // No backdrop blur sneaks in with the new rules.
  for (const rule of titleRow) assert.doesNotMatch(rule.body, /backdrop-filter/);
});

test("the compact transport applies below 950 px tall only", () => {
  const css = stripComments(read("src/styles/global.css"));
  assert.match(css, /\.app-shell \{\n  --meter-peak: #ff6478;[\s\S]*?  grid-template-rows: 72px minmax\(0, 1fr\) clamp\(126px, 13vh, 142px\);\n\}/);
  assert.match(css, /\n\.transport-console \{ grid-template-rows: 64px 42px; \}\n/);
  const blocks = mediaBlocks(css);
  const short = blocks.find(block => normalise(block.prelude) === "@media(max-height:949px)");
  assert.ok(short, "949 px transport block");
  assert.match(short.body, /\.app-shell:not\(\.compact-mode\):not\(\.immersive-mode\) \{ grid-template-rows: 72px minmax\(0, 1fr\) 110px; \}/);
  assert.match(short.body, /\.app-shell:not\(\.compact-mode\):not\(\.immersive-mode\) \.transport-console \{ grid-template-rows: 56px 38px; \}/);
  // The queue drawer follows the 110 px transport with the same 2 px gap as 128 over 126.
  assert.match(css, /\n\.queue-drawer \{ bottom: 128px; \}\n/);
  assert.match(short.body, /\.app-shell:not\(\.compact-mode\):not\(\.immersive-mode\):not\(\.video-layout\) \.queue-drawer \{ bottom: 112px; \}/);
  // The video layout's drawers (queue and volume) keep the same gap.
  const video = read("src/components/VideoView.css");
  assert.match(video, /\.app-shell\.video-layout \.queue-drawer\{top:68px;bottom:128px;/);
  assert.match(video, /@media \(max-height:949px\)\{\.app-shell\.video-layout \.queue-drawer\{bottom:112px\}\}/);
  const tiny = blocks.find(block => normalise(block.prelude) === "@media(max-height:700px)" && block.body.includes("68px minmax(0, 1fr)"));
  assert.match(tiny.body, /\.app-shell:not\(\.compact-mode\):not\(\.immersive-mode\) \{ grid-template-rows: 68px minmax\(0, 1fr\) 110px; \}/);
  assert.ok(short.start < tiny.start, "the 700 px block still overrides the titlebar row");
  for (const pattern of [/minmax\(0, 1fr\) 110px/g, /grid-template-rows: 56px 38px/g])
    for (const match of css.matchAll(pattern)) {
      const block = blocks.find(item => item.start <= match.index && match.index < item.end);
      assert.ok(block === short || block === tiny, `${match[0]} at ${match.index} is outside the short-window blocks`);
    }
});

test("fullscreen cards move up only where they would cover the slider", () => {
  assert.match(flowCss, /\.music-library\.library-mosaic-fullscreen:fullscreen \.media-flow-item \{ top:max\(8px, min\(calc\(\(100% - var\(--flow-card-height, 316px\)\) \/ 2 \+ 48px\), calc\(100% - var\(--flow-card-height, 316px\) - 18px\)\)\); \}/);
});
