const {test}=require('node:test'),assert=require('node:assert/strict');
const {fitWindowBounds,fittedUiZoom}=require('../../dist-electron/windowFit');
test('oversized saved window fits high-DPI work area including negative monitor origin',()=>{
 const area={x:-960,y:0,width:960,height:500};
 assert.deepEqual(fitWindowBounds({x:80,y:60,width:1500,height:940},area),area);
 assert.deepEqual(fitWindowBounds({x:-900,y:20,width:700,height:450},area),{x:-900,y:20,width:700,height:450});
});
test('UI zoom fits both axes, never double-applies DPI, and leaves special modes alone',()=>{
 assert.equal(fittedUiZoom(1500,940),1);
 assert.equal(fittedUiZoom(960,540),.8);
 assert.equal(fittedUiZoom(640,900),.8);
 assert.equal(fittedUiZoom(420,124,true),1);
 assert.equal(fittedUiZoom(0,0),1);
});

test('readability floor survives tiny windows and restores system-relative 100% when space returns',()=>{
 for(const size of [[640,400],[800,500],[960,540]])assert.equal(fittedUiZoom(...size),.8);
 assert.equal(fittedUiZoom(1064,684),.95);
 assert.equal(fittedUiZoom(1500,940),1);
 const preferred={x:80,y:60,width:1500,height:940};
 const small=fitWindowBounds(preferred,{x:0,y:0,width:960,height:500});
 const restored=fitWindowBounds({...small,width:preferred.width,height:preferred.height},{x:0,y:0,width:1920,height:1040});
 assert.equal(restored.width,1500);assert.equal(restored.height,940);
});

test("restorable normal bounds never return a screen-filling rectangle", () => {
  const { restorableNormalBounds, fillsDisplay } = require("../../dist-electron/windowFit");
  const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1032 } };
  const floating = { x: 200, y: 150, width: 900, height: 600 };
  assert.equal(fillsDisplay(display.workArea, display), true);
  assert.equal(fillsDisplay(display.bounds, display), true);
  assert.deepEqual(restorableNormalBounds(floating, display), floating);
  assert.deepEqual(restorableNormalBounds(display.workArea, display, floating), floating);
  assert.deepEqual(restorableNormalBounds(display.bounds, display, floating), floating);
  const fallback = restorableNormalBounds(display.workArea, display, display.workArea);
  assert.equal(fillsDisplay(fallback, display), false);
  assert.deepEqual(fallback, { x: 240, y: 129, width: 1440, height: 774 });
});

test("a window a few DIPs off the work area after a scale change still fills it", () => {
  const { fillsDisplay, restorableNormalBounds } = require("../../dist-electron/windowFit");
  const display = { bounds: { x: 0, y: 0, width: 1823, height: 960 }, workArea: { x: 0, y: 0, width: 1822, height: 912 } };
  for (const bounds of [
    { x: 0, y: 0, width: 1821, height: 912 },
    { x: 0, y: 0, width: 1823, height: 913 },
    { x: 1, y: 0, width: 1820, height: 911 },
    { x: 0, y: 0, width: 2342, height: 1188 }, // larger than the display while the scale settles
    { x: -8, y: -8, width: 1838, height: 928 }
  ]) assert.equal(fillsDisplay(bounds, display), true, JSON.stringify(bounds));
  for (const bounds of [
    { x: 0, y: 0, width: 1812, height: 912 },
    { x: 0, y: 20, width: 1822, height: 892 },
    { x: 300, y: 120, width: 1238, height: 673 }
  ]) assert.equal(fillsDisplay(bounds, display), false, JSON.stringify(bounds));
  // A nearly-full rectangle is never handed back as the restore size.
  const floating = { x: 300, y: 120, width: 1238, height: 673 };
  assert.deepEqual(restorableNormalBounds({ x: 0, y: 0, width: 1821, height: 912 }, display, floating), floating);
});
