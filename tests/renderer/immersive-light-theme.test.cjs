const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.resolve(__dirname, "../../src/App.tsx"), "utf8");
const globalStyles = fs.readFileSync(path.resolve(__dirname, "../../src/styles/global.css"), "utf8");
const moduleStyles = fs.readFileSync(path.resolve(__dirname, "../../src/styles/workspace-modules.css"), "utf8");

test("immersive mode preserves the selected workstation theme", () => {
  assert.match(app, /<AmbientBackground[\s\S]*?light=\{lightTheme\}/);
  assert.doesNotMatch(app, /light=\{lightTheme\s*&&\s*!immersiveMode\}/);
  assert.doesNotMatch(moduleStyles, /\.app-shell\.theme-light\.immersive-mode/);
  assert.match(
    globalStyles,
    /\.app-shell:not\(\.obs-mode\) :is\(\s*\.visual-area:not\(\.overview-active\),\s*\.visual-module\s*\)/
  );
});
