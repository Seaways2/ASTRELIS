const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("the main volume fader draws two dense columns of LED cells in whole device pixels", () => {
  const css = read("src/styles/global.css");
  assert.match(css, /--led-cell: calc\(var\(--device-px, 1px\) \* 2\);/);
  assert.match(css, /--led-pitch: calc\(var\(--device-px, 1px\) \* 3\);/);
  // Unlit cells fill the slot; lit cells use the same pattern from the same bottom edge.
  assert.match(css, /\.channel-fader-track::before \{[^}]*repeating-linear-gradient\(to top, var\(--led-off\) 0 var\(--led-cell\), var\(--led-off-gap\) var\(--led-cell\) var\(--led-pitch\)\) content-box/);
  assert.match(css, /\.channel-fader-fill \{[^}]*bottom: 3px; width: 9px;[^}]*repeating-linear-gradient\(to top, var\(--led-on\) 0 var\(--led-cell\)/);
  // The 1 px gap splits the 9 px cell area into two 4 px columns.
  assert.match(css, /linear-gradient\(90deg, transparent 4px, var\(--led-frame\) 4px 5px, transparent 5px\)/);
  // Colours follow the theme accent.
  assert.match(css, /--led-on: var\(--accent\);/);
});

test("the lit column stops on a whole cell", () => {
  const fader = read("src/components/MainVolumeFader.tsx");
  assert.match(fader, /height: `round\(down, calc\(\$\{position\} \* \(100% - 6px\)\), var\(--led-pitch\)\)`/);
});

test("one device pixel is published for the page and follows scale and zoom changes", () => {
  const helper = read("src/utils/devicePixel.ts");
  assert.match(helper, /root\.style\.setProperty\("--device-px", `\$\{1 \/ devicePixelRatio\}px`\)/);
  assert.match(helper, /matchMedia\(`\(resolution: \$\{devicePixelRatio\}dppx\)`\)/);
  assert.match(read("src/main.tsx"), /trackDevicePixel\(\);/);
});
