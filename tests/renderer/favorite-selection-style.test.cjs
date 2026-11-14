const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("a track ticked in the favourites view is highlighted on the element that carries the class", () => {
  const library = read("src/components/MusicLibrary.tsx");
  const css = read("src/styles/global.css");
  // The class goes on the track entry, so the rule must target .library-entry (not .library-card).
  assert.match(library, /className=\{`library-entry library-track-entry [^`]*\$\{selected \? "selected-favorite" : ""\}`\}/);
  assert.match(css, /\.library-entry\.selected-favorite \{ border-color: color-mix\(in srgb, var\(--accent\) 58%, transparent\);/);
  assert.doesNotMatch(css, /\.library-card\.selected-favorite/);
});
