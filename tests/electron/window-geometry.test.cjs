const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DipWindowResize } = require('../../dist-electron/windowGeometry.js');

function fixture(bounds = { x: -1400, y: 80, width: 1200, height: 800 }) {
  let point = { x: -200, y: 880 }, enabled = true;
  const writes = [];
  const win = { getBounds: () => ({ ...bounds }), getMinimumSize: () => [640, 360],
    setBounds: value => { bounds = value; writes.push(value); } };
  const resize = new DipWindowResize(() => win, () => point, () => enabled);
  return { resize, win, writes, cursor: value => { point = value; }, disable: () => { enabled = false; } };
}

test('all eight edges use DIP deltas and preserve the opposite edge', () => {
  for (const edge of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    const f = fixture(); f.resize.begin(edge); f.cursor({ x: -160, y: 910 }); f.resize.update();
    const expected = { x: -1400 + (edge.includes('w') ? 40 : 0), y: 80 + (edge.includes('n') ? 30 : 0),
      width: 1200 + (edge.includes('e') ? 40 : edge.includes('w') ? -40 : 0),
      height: 800 + (edge.includes('s') ? 30 : edge.includes('n') ? -30 : 0) };
    assert.deepEqual(f.win.getBounds(), expected, edge);
  }
});

test('100%, 125%, 150%, 200% monitor cursor samples produce identical logical resize', () => {
  // Simulate the main-process screen API contract, including a negative-origin
  // secondary monitor. Renderer screen coordinates are deliberately never used.
  for (const scale of [1, 1.25, 1.5, 2]) {
    const f = fixture();
    const screenApiPoint = (px, py) => ({ x: -1600 + px / scale, y: py / scale });
    f.cursor(screenApiPoint(1400 * scale, 880 * scale)); f.resize.begin('se');
    f.cursor(screenApiPoint(1480 * scale, 920 * scale));
    for (let i = 0; i < 200; i++) f.resize.update();
    assert.deepEqual(f.win.getBounds(), { x: -1400, y: 80, width: 1280, height: 840 });
    assert.equal(f.writes.length, 1, 'holding the mouse still must not accumulate size changes');
  }
});

test('crossing a monitor boundary and returning restores original logical bounds', () => {
  const f = fixture(); f.cursor({ x: -10, y: 400 }); f.resize.begin('e');
  for (const x of [-5, 0, 20, 100, 20, 0, -10]) { f.cursor({ x, y: 400 }); f.resize.update(); }
  assert.deepEqual(f.win.getBounds(), { x: -1400, y: 80, width: 1200, height: 800 });
});

test('release/cancellation and mode changes discard queued resize moves', () => {
  for (const cancel of [f => f.resize.end(), f => f.disable()]) {
    const f = fixture(); f.resize.begin('se'); cancel(f);
    f.cursor({ x: 4000, y: 2000 }); f.resize.update(); f.resize.update();
    assert.equal(f.writes.length, 0);
  }
});

test('minimum size clamps all edges without moving the anchored opposite side', () => {
  for (const edge of ['nw', 'se']) {
    const f = fixture(); f.resize.begin(edge);
    f.cursor(edge === 'nw' ? { x: 9999, y: 9999 } : { x: -9999, y: -9999 }); f.resize.update();
    const b = f.win.getBounds(); assert.equal(b.width, 640); assert.equal(b.height, 360);
    if (edge === 'nw') { assert.equal(b.x + b.width, -200); assert.equal(b.y + b.height, 880); }
    else { assert.equal(b.x, -1400); assert.equal(b.y, 80); }
  }
});

test('invalid edge cannot start or inherit a resize session', () => {
  const f = fixture(); f.resize.begin('se'); f.resize.begin('north-west');
  f.cursor({ x: 100, y: 100 }); f.resize.update(); assert.equal(f.writes.length, 0);
});
