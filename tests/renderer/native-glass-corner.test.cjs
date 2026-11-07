const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const styles = fs.readFileSync(path.resolve(__dirname, "../../src/styles/global.css"), "utf8");

test("native glass has one rounded-corner owner", () => {
  assert.match(styles, /\.app-shell\.native-glass\s*\{[^}]*border-radius:\s*0;[^}]*clip-path:\s*none;/s);
  assert.match(styles, /\.app-shell:not\(\.native-glass\):not\(\.maximized\):not\(\.immersive-mode\):not\(\.obs-mode\)/);
});
