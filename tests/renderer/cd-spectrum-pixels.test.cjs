const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "../../src/styles/global.css"), "utf8");

test("the deck's mini spectrum bars are whole device pixels, so they never alternate thick and thin", () => {
  assert.match(css, /\.cd-spectrum \{[^}]*gap: round\(3px, var\(--device-px, 1px\)\);/);
  assert.match(css, /\.cd-spectrum i \{\s*flex: none;\s*width: round\(3px, var\(--device-px, 1px\)\);/);
});
