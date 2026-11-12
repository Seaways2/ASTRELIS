/** One tile of a mosaic board, in 1-based CSS grid lines. */
export type MosaicSlot = { column: number; row: number; columnSpan: number; rowSpan: number };

// The featured 6 x 3 board: one 2x2 cover, two wide covers, four squares and
// three wide covers below. Repeating it keeps the collage at every zoom level.
const MOTIF: ReadonlyArray<readonly [columns: number, rows: number]> = [
  [2, 2], [2, 1], [2, 1], [1, 1], [1, 1], [1, 1], [1, 1], [2, 1], [2, 1], [2, 1]
];

/** Grid cells per board: zoom scales the tiles, so 50% shows twice as many columns. */
export function mosaicGridSize(zoom: number) {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const columns = Math.min(12, Math.max(6, Math.round(6 / safeZoom)));
  return { columns, rows: Math.max(3, Math.round(columns / 2)) };
}

/**
 * Fills a columns x rows board with the motif, taking the first free cell in
 * reading order. A tile that does not fit shrinks to one row, then one cell,
 * so the board is always filled exactly and never grows extra rows.
 */
export function mosaicSlots(columns: number, rows: number): MosaicSlot[] {
  const used = Array.from({ length: rows }, () => new Array<boolean>(columns).fill(false));
  const fits = (column: number, row: number, width: number, height: number) => {
    if (column + width > columns || row + height > rows) return false;
    for (let y = row; y < row + height; y++)
      for (let x = column; x < column + width; x++) if (used[y][x]) return false;
    return true;
  };
  const slots: MosaicSlot[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (used[row][column]) continue;
      let [width, height] = MOTIF[slots.length % MOTIF.length];
      if (!fits(column, row, width, height)) [width, height] = fits(column, row, width, 1) ? [width, 1] : [1, 1];
      for (let y = row; y < row + height; y++)
        for (let x = column; x < column + width; x++) used[y][x] = true;
      slots.push({ column: column + 1, row: row + 1, columnSpan: width, rowSpan: height });
    }
  }
  return slots;
}
