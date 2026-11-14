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
  assert.match(outline, /outline\.apply\(window\.getNativeWindowHandle\(\), fillsScreen \|\| coversDisplay\)/);
  const main = read("electron/main.ts");
  for (const event of ["enter-full-screen", "leave-full-screen", "restore"])
    assert.match(main, new RegExp(`mainWindow\\.on\\("${event}", syncWindowOutline\\)`));
  // Maximize and restore share one handler that also redraws the contour.
  assert.match(main, /const maximizedChanged = \(maximized: boolean\) => \{[\s\S]*?syncWindowOutline\(\);/);
  assert.match(main, /mainWindow\.on\("maximize", \(\) => maximizedChanged\(true\)\);/);
  assert.match(main, /mainWindow\.on\("unmaximize", \(\) => maximizedChanged\(false\)\);/);
});

test("native glass keeps the renderer square so only one arc exists", () => {
  const styles = read("src/styles/global.css");
  assert.match(styles, /\.app-shell\.native-glass\s*\{[^}]*border-radius:\s*0;/s);
});

test("a window covering the display stays square during HTML fullscreen", () => {
  const main = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../electron/main.ts"), "utf8");
  assert.match(main, /applyNativeWindowOutline\(mainWindow, fillsDisplay\(bounds, screen\.getDisplayMatching\(bounds\)\)\)/);
  assert.match(main, /const \{ filling, changed \} = windowState\.observe\(windowSnapshot\(mainWindow\)\);\s*if \(!changed\) return;\s*syncWindowOutline\(\);\s*refreshMaximizedAppearance\(filling\);/);
  const machine = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../electron/windowStateMachine.ts"), "utf8");
  assert.match(machine, /return window\.maximized \|\| window\.fullScreen \|\| fillsDisplay\(window\.bounds, window\.display\);/);
});
