const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = (path) => fs.readFileSync(path, "utf8");

test("Channel Strip portal receives the same surface inputs as in-page panels", () => {
  const app = read("src/App.tsx");
  const channel = read("src/components/ChannelStripPopover.tsx");

  assert.match(app, /windowOpacity=\{lowPerformanceMode \? 1 : state\.uiSettings\.windowOpacity\}/);
  assert.match(app, /lightSurface=\{lightSurface\}/);
  assert.match(channel, /"--window-opacity": windowOpacity/);
  assert.match(channel, /"--light-surface": lightSurface/);
});

test("Channel Strip inherits the shared material; rendered equivalence is covered by the Electron visual suite", () => {
  const styles = read("src/styles/surfaces.css");
  const layout = read("src/styles/global.css");
  const channel = read("src/components/ChannelStripPopover.tsx");
  assert.match(read("src/main.tsx"), /import "\.\/styles\/surfaces\.css"/);
  assert.match(channel, /closest\("\.app-shell"\)/);
  assert.doesNotMatch(channel, /<\/div>, document\.body/);
  assert.match(styles, /\.channel-strip-popover\) \{\s*background:\s*var\(--surface-dither\) repeat,\s*radial-gradient/);
  assert.match(styles, /backdrop-filter: var\(--surface-glass-filter\)/);
  assert.doesNotMatch(layout, /\.channel-strip-popover(?:\.light)? \{\s*--frost-fill:/);
});
