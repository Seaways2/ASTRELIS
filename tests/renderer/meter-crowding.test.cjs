const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const compiled = ts.transpileModule(read("src/utils/meterCrowding.ts"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const loaded = { exports: {} };
Function("exports", compiled)(loaded.exports);
const { headFits, tabsCrowdedByMeters, metersShownFor, METERS_FOLD_WIDTH, METERS_FOLD_QUERY, DEFAULT_METERS_WIDTH, METERS_RETURN_MARGIN } = loaded.exports;

// Six mode names plus two buttons, a 160px title, actions capped at 76% of the header.
const head = (headInner, actionsNatural = 600) => ({ headInner, titleWidth: 160, actionsNatural, actionsCapRatio: 0.76 });

test("the names fit only when both the title gap and the actions cap allow it", () => {
  assert.equal(headFits(head(800)), true); // 600 <= 608 and 160+16+600 <= 800
  assert.equal(headFits(head(780)), false); // cap 592.8 < 600
  assert.equal(headFits({ headInner: 700, titleWidth: 160, actionsNatural: 600 }), false); // no cap, but no gap
  assert.equal(headFits({ headInner: 776, titleWidth: 160, actionsNatural: 600 }), true);
  assert.equal(headFits({ headInner: 2000, titleWidth: 160, actionsNatural: 600, actionsCapPx: 500 }), false);
});

// With these numbers the names fit from a 600 / 0.76 = 789.5px header on.
test("shown meters fold as soon as a name would be cut", () => {
  assert.equal(tabsCrowdedByMeters(true, head(790), DEFAULT_METERS_WIDTH), false);
  assert.equal(tabsCrowdedByMeters(true, head(785), DEFAULT_METERS_WIDTH), true);
});

test("folded meters come back only with room to spare, so the layout does not flap", () => {
  const meters = DEFAULT_METERS_WIDTH;
  // Folded at a 785px header, the header grows by the meters' column; they would not fit back.
  assert.equal(tabsCrowdedByMeters(false, head(785 + meters), meters), true);
  // Even where the names would just fit beside the meters, they stay folded (return margin) ...
  assert.equal(tabsCrowdedByMeters(false, head(790 + meters), meters), true);
  // ... and come back once the header has the margin as well.
  assert.equal(tabsCrowdedByMeters(false, head(790 + meters + METERS_RETURN_MARGIN), meters), false);
  // Whatever comes back is a state the shown rule keeps: no fold/unfold loop.
  assert.equal(tabsCrowdedByMeters(true, head(790), meters), false);
});

test("crowding folds the meters on every page unless the user brings them back", () => {
  assert.equal(metersShownFor({ nowPlaying: true, crowded: false, forced: false, expanded: false }), true);
  assert.equal(metersShownFor({ nowPlaying: false, crowded: false, forced: false, expanded: true }), true);
  assert.equal(metersShownFor({ nowPlaying: false, crowded: false, forced: true, expanded: false }), false);
  assert.equal(metersShownFor({ nowPlaying: true, crowded: true, forced: false, expanded: true }), false);
  assert.equal(metersShownFor({ nowPlaying: false, crowded: true, forced: false, expanded: true }), false);
  assert.equal(metersShownFor({ nowPlaying: true, crowded: true, forced: true, expanded: false }), true);
});

test("the meters fold at the width where the sidebar used to drop its names, which now keeps them to 1000px", () => {
  assert.equal(METERS_FOLD_WIDTH, 1250);
  assert.equal(METERS_FOLD_QUERY, "(max-width: 1250px)");
  const css = read("src/styles/global.css");
  const block = css.match(/@media \(max-width: 1250px\) \{([\s\S]*?)\n\}/);
  assert.ok(block, "1250px block");
  assert.match(block[1], /\.workspace\.workspace-focus \{ grid-template-columns: 184px minmax\(0, 1fr\); \}/);
  assert.match(block[1], /\.workspace:not\(\.workspace-focus\) > \.sidebar nav span \{ font-size: 0; \}/);
  assert.doesNotMatch(block[1], /^\s*\.sidebar nav span/m);
  const narrow = css.slice(block.index + block[0].length).match(/@media \(max-width: 1000px\) \{([\s\S]*?)\n\}/);
  assert.ok(narrow, "1000px block right after");
  assert.match(narrow[1], /\.workspace\.workspace-focus \{ grid-template-columns: 66px minmax\(0, 1fr\); \}/);
  assert.match(narrow[1], /^\s*\.sidebar nav span \{ font-size: 0; \}/m);
});

test("App folds the meters through the crowding hook and keeps the toggle while they are folded", () => {
  const app = read("src/App.tsx");
  assert.match(app, /useMeterCrowding\(visualHeadRef, renderedPage === "nowPlaying" && !videoActive, resolvedLanguage\)/);
  assert.match(app, /const showMeters = metersShownFor\(\{ nowPlaying: renderedPage === "nowPlaying", crowded: metersCrowded, forced: metersForced, expanded: metersExpanded \}\);/);
  assert.match(app, /if \(!metersCrowded\) setMetersForced\(false\)/);
  assert.match(app, /<div className="visual-head" ref=\{visualHeadRef\}>/);
  assert.match(app, /\(renderedPage !== "nowPlaying" \|\| metersCrowded\) && <button type="button"\s*className=\{`meter-edge-toggle \$\{showMeters \? "expanded" : "collapsed"\}`\}/);
  assert.match(app, /onClick=\{\(\) => metersCrowded \? setMetersForced\(value => !value\) : setMetersExpanded\(value => !value\)\}/);
  const hook = read("src/app/useMeterCrowding.ts");
  assert.match(hook, /useLayoutEffect/);
  assert.match(hook, /new ResizeObserver\(measure\)/);
  assert.match(hook, /tabs\.scrollWidth - tabs\.clientWidth/);
});
