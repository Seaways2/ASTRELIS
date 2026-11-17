const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '../..', name), 'utf8');

test('ordinary and compact titlebars use native dragging with no renderer move IPC', () => {
  const app = read('src/App.tsx'), css = read('src/styles/global.css');
  // Native dragging: the titlebar has no press or move handlers of its own,
  // only the double-click that follows closing a popover (titlebar-double-click.test).
  const header = app.slice(app.indexOf('<header className="titlebar"'), app.indexOf('<div className="brand">'));
  assert.ok(header.length > 0 && header.length < 300, 'titlebar header not found');
  assert.doesNotMatch(header, /on(Mouse|Pointer)(Down|Move|Up)/);
  assert.match(css, /\.titlebar\s*\{\s*-webkit-app-region: drag/);
  assert.match(css, /\.window-actions\s*\{[^}]*-webkit-app-region: no-drag/);
  assert.match(css, /\.titlebar :is\(button, input, select, textarea, a,[\s\S]*?-webkit-app-region: no-drag/);
  for (const name of ['src/App.tsx', 'electron/preload.ts', 'electron/main.ts', 'src/types/global.d.ts'])
    assert.doesNotMatch(read(name), /window:move|startWindowDrag|moveTo\(|\.setPosition\(/, name);
});

test('resize bridge transmits intent only and handles lost capture and released buttons', () => {
  const app = read('src/App.tsx'), main = read('electron/main.ts');
  assert.doesNotMatch(app, /event\.screen[XY]/);
  assert.match(read('electron/preload.ts'), /resizeTo: \(\) => ipcRenderer.send\("window:resize-move"\)/);
  assert.match(app, /onLostPointerCapture=\{\(\) => window.desktop\?\.endResize\(\)\}/);
  assert.match(app, /event.buttons & 1/);
  assert.match(main, /screen.getCursorScreenPoint\(\)/);
  for (const event of ["blur", "minimize", "close", "closed"])
    assert.ok(main.includes(`mainWindow.on("${event}", () => windowResize.end())`));
  // Maximize and restore end a gesture inside their shared handler.
  assert.match(main, /const maximizedChanged = \(maximized: boolean\) => \{\s*windowResize\.end\(\);/);
  assert.match(main, /mainWindow\.on\("maximize", \(\) => maximizedChanged\(true\)\);/);
  assert.match(main, /mainWindow\.on\("unmaximize", \(\) => maximizedChanged\(false\)\);/);
  assert.match(main, /render-process-gone/);
});


test('channel strip portal excludes its whole surface from underlying caption dragging', () => {
  assert.match(read('src/styles/global.css'), /\.channel-strip-popover\s*\{\s*-webkit-app-region: no-drag/);
});
