const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readAppSource } = require("./helpers/appSource.cjs");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("the sidebar no longer has a fold-meters button; a triangle on the meters' edge folds them", () => {
  const app = readAppSource();
  assert.doesNotMatch(app, /className="meter-toggle"/);
  assert.match(app, /className=\{`meter-edge-toggle \$\{showMeters \? "expanded" : "collapsed"\}`\}/);
  assert.match(app, /onClick=\{\(\) => metersCrowded \? setMetersForced\(value => !value\) : setMetersExpanded\(value => !value\)\}><i aria-hidden="true" \/><\/button>\}/);
  assert.match(app, /aria-label=\{t\(showMeters \? "layout\.hideMeters" : "layout\.showMeters"\)\}/);
  // Now Playing keeps its meters unless a narrow window folds them (meter-crowding.test.cjs).
  assert.match(app, /\{\(renderedPage !== "nowPlaying" \|\| metersCrowded\) && <button type="button"\s*className=\{`meter-edge-toggle/);
});

test("the triangle appears only near the edge and points the way the meters move", () => {
  const css = read("src/styles/global.css");
  assert.match(css, /\.workspace \{ position: relative;/);
  // A 28 x 220 px strip: wide enough to find by moving toward the edge.
  assert.match(css, /\.meter-edge-toggle \{[^}]*position: absolute;[^}]*grid-row: 1;[^}]*width: 28px;\s*height: 220px;[^}]*opacity: 0;/);
  assert.match(css, /\.meter-edge-toggle\.expanded \{ grid-column: 3; left: -14px; \}/);
  assert.match(css, /\.meter-edge-toggle\.collapsed \{ grid-column: 2; right: 0; place-items: center end; padding-right: 7px; \}/);
  assert.match(css, /\.workspace:has\(> \.meters:hover\) > \.meter-edge-toggle,\s*\.meter-edge-toggle:hover,\s*\.meter-edge-toggle:focus-visible \{ opacity: 1; \}/);
  assert.match(css, /clip-path: polygon\(0 0, 100% 50%, 0 100%\)/, "points right to fold away");
  assert.match(css, /\.meter-edge-toggle\.collapsed i \{ clip-path: polygon\(100% 0, 0 50%, 100% 100%\); \}/, "points left to bring back");
  assert.doesNotMatch(css + read("src/styles/rounded.css"), /\.meter-toggle\b/);
});
