// Real application main/preload/renderer, isolated from all user settings.
const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const profile = process.env.ASTRELIS_WINDOW_TEST_PROFILE;
if (!profile) throw new Error('Use run-window-geometry.cjs');
delete process.env.VITE_DEV_SERVER_URL;
app.setAppPath(root);
app.setPath('userData', profile);
app.setPath('sessionData', profile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { console.error('Window integration timeout'); app.exit(1); }, 60000);
require('../../dist-electron/main.js');
(async () => {
  await app.whenReady();
  let win;
  while (!(win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed()))) await pause(50);
  while (win.webContents.isLoading()) await pause(100);
  const js = expression => win.webContents.executeJavaScript(expression, true);
  while (!await js('Boolean(document.querySelector(".titlebar") && window.desktop)')) await pause(100);
  win.webContents.setAudioMuted(true);
  console.log('Displays:', JSON.stringify(screen.getAllDisplays().map(d => ({ scaleFactor: d.scaleFactor, bounds: d.bounds }))));
  if (process.argv.includes('--restore')) {
    const expected = JSON.parse(fs.readFileSync(path.join(profile, 'expected-bounds.json')));
    assert.deepEqual(win.getBounds(), expected, 'restart restores persisted DIP position and size');
    console.log('PASS: actual application restart restored saved bounds');
    clearTimeout(deadline); app.quit(); return;
  }
  assert.equal(await js('getComputedStyle(document.querySelector(".titlebar")).webkitAppRegion'), 'drag');
  assert.equal(await js('getComputedStyle(document.querySelector(".window-maximize")).webkitAppRegion'), 'no-drag');
  assert.equal(await js('typeof window.desktop.moveTo'), 'undefined');
  await js('document.querySelector(".volume-popover-trigger").click()'); await pause(200);
  assert.equal(await js('getComputedStyle(document.querySelector(".channel-strip-popover")).webkitAppRegion'), 'no-drag');
  await js('document.querySelector(".channel-strip-popover > header button").click()');
  await pause(100);
  assert.equal(await js('Boolean(document.querySelector(".channel-strip-popover"))'), false);

  await js('document.querySelector(".window-maximize").click()'); await pause(500);
  assert.equal(win.isMaximized(), true);
  await js('document.querySelector(".window-maximize").click()'); await pause(500);
  assert.equal(win.isMaximized(), false);
  await js('document.querySelector(".window-minimize").click()'); await pause(400);
  assert.equal(win.isMinimized(), true); win.restore(); await pause(400);
  const normal = win.getBounds();
  await js('document.querySelector(".compact-toggle").click()'); await pause(500);
  assert.deepEqual(win.getSize(), [420, 124]);
  assert.equal(win.isResizable(), false);
  await js('document.querySelector(".compact-toggle").click()'); await pause(500);
  assert.deepEqual(win.getBounds(), normal); assert.equal(win.isResizable(), true);
  await js('window.desktop.setImmersive(true)'); await pause(200);
  assert.deepEqual(win.getMinimumSize(), [640, 360]);
  const cursor = screen.getCursorScreenPoint;
  let point = { x: -100, y: 200 };
  screen.getCursorScreenPoint = () => point;
  try {
    // Main process consumes mocked DIP samples; renderer supplies no coordinates.
    await js('window.desktop.beginResize("se")'); await pause(50);
    point = { x: -60, y: 230 };
    await js('window.desktop.resizeTo()'); await pause(200);
    assert.equal(win.getBounds().width, normal.width + 40);
    assert.equal(win.getBounds().height, normal.height + 30);
    const resized = win.getBounds();
    await js('for (let i=0; i<50; i++) window.desktop.resizeTo()'); await pause(150);
    assert.deepEqual(win.getBounds(), resized);
    await js('window.desktop.endResize()'); await pause(50);
    point = { x: 4000, y: 4000 };
    await js('window.desktop.resizeTo()'); await pause(100);
    assert.deepEqual(win.getBounds(), resized);
    await js('window.desktop.beginResize("se")'); await pause(50);
    win.emit('blur'); point = { x: 5000, y: 5000 };
    await js('window.desktop.resizeTo()'); await pause(100);
    assert.deepEqual(win.getBounds(), resized);
  } finally { screen.getCursorScreenPoint = cursor; }
  await js('window.desktop.setImmersive(false)'); await pause(300);
  assert.deepEqual(win.getBounds(), normal);
  const area = (screen.getAllDisplays().find(d => d.workArea.x < 0) || screen.getPrimaryDisplay()).workArea;
  win.setBounds({ x: area.x + 30, y: area.y + 30, width: 1180, height: 760 });
  await pause(500);
  const expected = win.getBounds();
  const saved = JSON.parse(fs.readFileSync(path.join(profile, 'window-state.json')));
  assert.deepEqual(saved, { ...expected, maximized: false });
  fs.writeFileSync(path.join(profile, 'expected-bounds.json'), JSON.stringify(expected));
  console.log('PASS: real titlebar CSS, maximize/restore/minimize buttons, compact/immersive, DIP resize IPC, release/blur cancellation, persistence');
  clearTimeout(deadline); app.quit();
})().catch(error => { console.error(error); clearTimeout(deadline); app.exit(1); });
