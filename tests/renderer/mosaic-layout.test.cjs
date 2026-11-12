const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const compiled = ts.transpileModule(read("src/components/mosaicLayout.ts"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const loaded = { exports: {} };
Function("exports", compiled)(loaded.exports);
const { mosaicGridSize, mosaicSlots } = loaded.exports;

const coverage = (slots, columns, rows) => {
  const cells = Array.from({ length: rows }, () => new Array(columns).fill(0));
  for (const slot of slots)
    for (let y = slot.row - 1; y < slot.row - 1 + slot.rowSpan; y++)
      for (let x = slot.column - 1; x < slot.column - 1 + slot.columnSpan; x++) cells[y][x]++;
  return cells.flat();
};

test("100% zoom keeps the original featured collage exactly", () => {
  assert.deepEqual(mosaicGridSize(1), { columns: 6, rows: 3 });
  assert.deepEqual(mosaicSlots(6, 3).map(s => [s.column, s.row, s.columnSpan, s.rowSpan]), [
    [1, 1, 2, 2], [3, 1, 2, 1], [5, 1, 2, 1],
    [3, 2, 1, 1], [4, 2, 1, 1], [5, 2, 1, 1], [6, 2, 1, 1],
    [1, 3, 2, 1], [3, 3, 2, 1], [5, 3, 2, 1]
  ]);
});

test("zooming out keeps mixed tile sizes instead of a uniform grid", () => {
  for (let percent = 50; percent <= 100; percent += 5) {
    const { columns, rows } = mosaicGridSize(percent / 100);
    const slots = mosaicSlots(columns, rows);
    // Every cell is covered exactly once: no holes and no overflow rows.
    assert.ok(coverage(slots, columns, rows).every(count => count === 1), `${percent}% leaves a hole or overlap`);
    assert.ok(slots.some(s => s.columnSpan === 2 && s.rowSpan === 2), `${percent}% has no large cover`);
    assert.ok(slots.some(s => s.columnSpan === 1 && s.rowSpan === 1), `${percent}% has no small cover`);
  }
  // Zoom scales the tiles: 50% shows twice the columns of 100%.
  assert.deepEqual(mosaicGridSize(.5), { columns: 12, rows: 6 });
  assert.ok(mosaicSlots(12, 6).length > mosaicSlots(6, 3).length * 3);
});

test("the fullscreen mosaic places tiles from the shared layout at every zoom", () => {
  const library = read("src/components/MusicLibrary.tsx");
  assert.doesNotMatch(library, /mosaicDensity|"zoomed"/);
  assert.match(library, /const mosaicItemsPerBoard = mosaicBoardSlots\.length;/);
  assert.match(library, /gridColumn: `\$\{slot\.column\} \/ span \$\{slot\.columnSpan\}`/);
  assert.doesNotMatch(read("src/styles/global.css"), /data-density="zoomed"/);
});
