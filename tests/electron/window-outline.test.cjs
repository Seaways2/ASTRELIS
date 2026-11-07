const { test } = require('node:test');
const assert = require('node:assert/strict');
const { roundedWindowShape } = require('../../dist-electron/windowOutline.js');

test('window clipping removes corners but preserves titlebar, content and resize edges', () => {
  for (const [width, height] of [[1120,720], [1600,900], [480,180], [1,1]]) {
    const shape = roundedWindowShape(width,height,false);
    const contains = (x,y) => shape.some(r => x>=r.x && x<r.x+r.width && y>=r.y && y<r.y+r.height);
    assert.ok(contains(Math.floor(width/2),0));
    assert.ok(contains(0,Math.floor(height/2)));
    assert.ok(contains(width-1,Math.floor(height/2)));
    assert.ok(contains(Math.floor(width/2),height-1));
    if (width>24) assert.equal(contains(0,0),false);
    for (const r of shape) {
      assert.ok(r.width>0 && r.height>0 && r.x>=0 && r.y>=0);
      assert.ok(r.x+r.width<=width && r.y+r.height<=height);
    }
  }
});

test('maximized and fullscreen windows cover all corners', () => {
  assert.deepEqual(roundedWindowShape(1920,1080,true),[{x:0,y:0,width:1920,height:1080}]);
});
