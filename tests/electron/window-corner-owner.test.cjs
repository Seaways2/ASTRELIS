const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("DWM owns the rounded window contour; no aliased custom region", () => {
  const native = read("native-window/outline.cpp");
  assert.match(native, /square \? DWMWCP_DONOTROUND : DWMWCP_ROUND/);
  assert.match(native, /SetWindowRgn\(hwnd, nullptr, TRUE\)/);
  assert.doesNotMatch(native, /CreateRoundRectRgn/, "SetWindowRgn corners are aliased and drop the backdrop on maximize");
});

test("emulated maximize and fullscreen switch the contour to square", () => {
  const outline = read("electron/nativeWindowOutline.ts");
  assert.match(outline, /const fillsScreen = window\.isMaximized\(\) \|\| window\.isFullScreen\(\);/);
  assert.match(outline, /outline\.apply\(window\.getNativeWindowHandle\(\), fillsScreen\)/);
  const main = read("electron/main.ts");
  for (const event of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen", "restore"])
    assert.match(main, new RegExp(`mainWindow\\.on\\("${event}", syncWindowOutline\\)`));
});

test("native glass keeps the renderer square so only one arc exists", () => {
  const styles = read("src/styles/global.css");
  assert.match(styles, /\.app-shell\.native-glass\s*\{[^}]*border-radius:\s*0;/s);
});
