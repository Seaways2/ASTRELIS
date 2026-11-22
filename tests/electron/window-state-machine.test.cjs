// The window geometry decisions for the transparent thickFrame:false window,
// driven through the same sequences the user reported: maximize, HTML
// fullscreen from the library, restore, snap, compact and immersive mode.
const test = require("node:test");
const assert = require("node:assert/strict");
const { WindowStateMachine, windowPresentation, windowFillsScreen, maximizeToggleRestores } = require("../../dist-electron/windowStateMachine");

const work = { x: 0, y: 0, width: 2200, height: 1400 };
const screenBounds = { x: 0, y: 0, width: 2200, height: 1440 };
const display = { bounds: screenBounds, workArea: work };
const floating = { x: 100, y: 90, width: 1300, height: 850 };

const snapshot = (overrides = {}) => ({
  bounds: floating, normalBounds: floating, display,
  minimized: false, maximized: false, fullScreen: false,
  concealed: false, compact: false, immersive: false,
  ...overrides
});

test("presentation names exactly one state, modes before reported states", () => {
  assert.equal(windowPresentation(snapshot()), "floating");
  assert.equal(windowPresentation(snapshot({ bounds: work, maximized: true })), "maximized");
  assert.equal(windowPresentation(snapshot({ bounds: screenBounds, fullScreen: true })), "fullscreen");
  assert.equal(windowPresentation(snapshot({ bounds: screenBounds })), "covering", "HTML fullscreen reports neither state");
  assert.equal(windowPresentation(snapshot({ bounds: work })), "covering", "a snap to the work area");
  assert.equal(windowPresentation(snapshot({ maximized: true, minimized: true })), "minimized");
  assert.equal(windowPresentation(snapshot({ compact: true })), "compact");
  assert.equal(windowPresentation(snapshot({ immersive: true, bounds: screenBounds })), "immersive");
  assert.equal(windowPresentation(snapshot({ concealed: true, minimized: true })), "concealed");
});

test("maximize, HTML fullscreen and leaving it still restore the floating bounds", () => {
  const machine = new WindowStateMachine();
  machine.reset(snapshot());
  assert.deepEqual(machine.observe(snapshot()), { filling: false, changed: false });
  // Maximize: Electron resizes to the work area and remembers the floating rectangle.
  assert.deepEqual(machine.observe(snapshot({ bounds: work, maximized: true })), { filling: true, changed: true });
  // HTML fullscreen: the display bounds, neither state reported; Electron's restore rectangle is lost.
  assert.deepEqual(machine.observe(snapshot({ bounds: screenBounds, normalBounds: work })), { filling: true, changed: false });
  // Back to "maximized", but the restore rectangle now is the work area.
  const maximizedAgain = snapshot({ bounds: work, normalBounds: work, maximized: true });
  machine.observe(maximizedAgain);
  assert.deepEqual(machine.restoreBounds(maximizedAgain), floating);
  assert.deepEqual(machine.persisted(maximizedAgain), { ...floating, maximized: true });
});

test("a window that fills the screen without a reported state flips the contour once each way", () => {
  const machine = new WindowStateMachine();
  machine.reset(snapshot());
  assert.equal(machine.observe(snapshot({ bounds: work })).changed, true, "snap to full size");
  assert.equal(machine.fillsScreen, true);
  assert.equal(machine.observe(snapshot({ bounds: work })).changed, false, "no repeated notification");
  assert.deepEqual(machine.observe(snapshot({ bounds: { ...floating, x: 300 } })), { filling: false, changed: true });
});

test("the maximize toggle restores a window that fills the screen even when Electron says it is not maximized", () => {
  const offByOne = { x: 0, y: 0, width: work.width - 1, height: work.height + 1 };
  assert.equal(maximizeToggleRestores(snapshot()), false);
  assert.equal(maximizeToggleRestores(snapshot({ bounds: work, maximized: true })), true);
  assert.equal(maximizeToggleRestores(snapshot({ bounds: offByOne })), true, "scale change: maximized=false");
  assert.equal(maximizeToggleRestores(snapshot({ bounds: screenBounds })), true, "HTML fullscreen / snap");
  assert.equal(maximizeToggleRestores(snapshot({ bounds: offByOne, compact: true })), false, "modes keep their own handling");
  // The nearly-full rectangle is not remembered as the floating size.
  const machine = new WindowStateMachine();
  machine.reset(snapshot());
  machine.observe(snapshot());
  assert.deepEqual(machine.observe(snapshot({ bounds: offByOne })), { filling: true, changed: true });
  assert.deepEqual(machine.restoreBounds(snapshot({ bounds: offByOne })), floating);
});

test("only floating bounds are remembered", () => {
  const machine = new WindowStateMachine();
  machine.reset(snapshot());
  machine.observe(snapshot());
  for (const state of [
    { bounds: { x: 0, y: 0, width: 420, height: 124 }, compact: true },
    { bounds: { x: 10, y: 10, width: 900, height: 500 }, immersive: true },
    { bounds: { x: -32000, y: -32000, width: 160, height: 28 }, minimized: true },
    { bounds: { x: 5, y: 5, width: 700, height: 500 }, concealed: true },
    { bounds: work }
  ]) machine.observe(snapshot(state));
  // Electron lost the restore rectangle (fullscreen while maximized): fall back to the remembered one.
  assert.deepEqual(machine.restoreBounds(snapshot({ bounds: work, normalBounds: work, maximized: true })), floating);
});

test("with nothing remembered the restore size is a centred 75% window, never the screen", () => {
  const machine = new WindowStateMachine();
  machine.reset(snapshot({ bounds: work, maximized: true }));
  const restore = machine.restoreBounds(snapshot({ bounds: work, normalBounds: work, maximized: true }));
  assert.deepEqual(restore, { x: 275, y: 175, width: 1650, height: 1050 });
  assert.equal(windowFillsScreen(snapshot({ bounds: restore })), false);
});

test("compact and immersive return to where they started and persist that, not their own size", () => {
  const machine = new WindowStateMachine();
  machine.reset(snapshot());
  machine.observe(snapshot());
  machine.enterMode("compact", snapshot({ bounds: work, normalBounds: floating, maximized: true }));
  const compact = snapshot({ bounds: { x: 1700, y: 1200, width: 420, height: 124 }, compact: true });
  machine.observe(compact);
  assert.deepEqual(machine.persisted(compact), { ...floating, maximized: false });
  assert.deepEqual(machine.leaveMode("compact"), floating);
  assert.equal(machine.leaveMode("compact"), undefined, "leaving twice restores nothing");

  machine.enterMode("immersive", snapshot());
  const immersive = snapshot({ bounds: screenBounds, immersive: true });
  assert.deepEqual(machine.persisted(immersive), { ...floating, maximized: false });
  assert.deepEqual(machine.leaveMode("immersive"), floating);
});

test("a new window forgets the previous window's geometry", () => {
  const machine = new WindowStateMachine();
  machine.reset(snapshot());
  machine.observe(snapshot({ bounds: { x: 40, y: 40, width: 800, height: 600 } }));
  machine.enterMode("compact", snapshot());
  machine.reset(snapshot({ bounds: work, maximized: true }));
  assert.equal(machine.fillsScreen, true);
  assert.equal(machine.leaveMode("compact"), undefined);
  assert.deepEqual(machine.restoreBounds(snapshot({ bounds: work, normalBounds: work, maximized: true })),
    { x: 275, y: 175, width: 1650, height: 1050 });
});
