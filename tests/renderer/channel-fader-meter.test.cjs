const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const css = read("src/styles/global.css");

test("the level meter draws two dense columns of LED cells in whole device pixels", () => {
  assert.match(css, /\.channel-meter \{\s*--led-cell: calc\(var\(--device-px, 1px\) \* 2\);\s*--led-pitch: calc\(var\(--device-px, 1px\) \* 3\);/);
  // Unlit cells fill each column; lit cells keep the level colours with darker gaps.
  assert.match(css, /\.channel-meter i \{[^}]*repeating-linear-gradient\(to top, var\(--led-off\) 0 var\(--led-cell\), var\(--led-off-gap\) var\(--led-cell\) var\(--led-pitch\)\)/);
  assert.match(css, /repeating-linear-gradient\(to top, transparent 0 var\(--led-cell\), var\(--led-lit-gap\) var\(--led-cell\) var\(--led-pitch\)\),\s*linear-gradient\(to top,\s*var\(--accent\) 0 78%,\s*var\(--meter-warning\) 87%/);
  // The lit column ends on a whole cell.
  assert.match(css, /clip-path: inset\(calc\(100% - round\(down, var\(--meter-level, 0%\), var\(--led-pitch\)\)\) 0 0 0\);/);
  // One frame holds both columns, in the light popover too.
  assert.match(css, /\.channel-fader-section \.channel-meter \{ width: 23px; justify-self: end; grid-template-columns: repeat\(2, 8px\); \}/);
  assert.match(css, /\.channel-strip-popover\.light \.channel-meter \{\s*--led-off:/);
});

test("the fader keeps its thin slot; only the meter is segmented", () => {
  assert.match(css, /\.channel-fader-track::before \{ top: 0; bottom: 0; left: 14px; width: 5px;/);
  assert.match(read("src/components/MainVolumeFader.tsx"), /<div className="channel-fader-fill" style=\{\{ height: `\$\{position \* 100\}%` \}\} \/>/);
});

test("the fader cap is brushed silver with a glowing accent index line", () => {
  assert.match(css, /\.channel-fader-cap \{\s*left: 2px;\s*width: 30px;\s*height: 63px;/);
  assert.match(css, /#fafafa 47\.06% 52\.94%/, "bright bands around the index line");
  assert.match(css, /#221919 85\.29% 88\.24%/, "dark lower lip");
  // The index line follows the theme accent and the theme glow strength.
  assert.match(css, /\.channel-fader-cap i \{[^}]*var\(--accent\);[^}]*0 0 calc\(3px \* var\(--glow-strength, 1\)\) color-mix\(in srgb, var\(--accent\) 95%, transparent\)/);
  // The same cap in light and dark themes.
  assert.doesNotMatch(css, /\.light \.channel-fader-cap::before|\.theme-light \.video-sidebar-strip \.channel-fader-cap/);
  assert.equal(read("src/utils/volumeFaderScale.ts").includes("export const FADER_CAP_HEIGHT = 63;"), true);
});

test("one device pixel is published for the page and follows scale and zoom changes", () => {
  const helper = read("src/utils/devicePixel.ts");
  assert.match(helper, /root\.style\.setProperty\("--device-px", `\$\{1 \/ devicePixelRatio\}px`\)/);
  assert.match(helper, /matchMedia\(`\(resolution: \$\{devicePixelRatio\}dppx\)`\)/);
  assert.match(read("src/main.tsx"), /trackDevicePixel\(\);/);
});
