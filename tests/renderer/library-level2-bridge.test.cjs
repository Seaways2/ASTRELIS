const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const { readMainProcessSource } = require("../helpers/mainProcessSource.cjs");
const read = relative => relative === "electron/main.ts" ? readMainProcessSource() : fs.readFileSync(path.join(root, relative), "utf8");

test("normal library scans are command-oriented and reconciled in Main", () => {
  const main = read("electron/main.ts");
  const preload = read("electron/preload.ts");
  const store = read("src/stores/playerStore.ts");
  assert.match(main, /libraryScanner\.scanRoots/);
  assert.match(main, /libraryService\.applyScan/);
  assert.match(main, /ipcMain\.handle\("library:rescan"/);
  assert.match(preload, /rescan: \(folders: string\[\], meta:/);
  assert.match(store, /window\.desktop\.library\.rescan\(folders, meta/);
  assert.match(store, /const meta = libraryCommandMeta\(get\(\)\.libraryRevision\)/);
  assert.doesNotMatch(store, /window\.desktop!?\.library\.scan\(/);
  assert.doesNotMatch(store, /window\.desktop\.library\.save\(/);
});

test("scan diagnostics log root IDs and status without logging root paths", () => {
  const main = read("electron/main.ts");
  const logBlock = main.match(/action: "library\.scan\.complete"[\s\S]*?failures: scan\.failures\.length/);
  assert.ok(logBlock);
  assert.match(logBlock[0], /rootId: root\.rootId/);
  assert.match(logBlock[0], /status: root\.status/);
  assert.doesNotMatch(logBlock[0], /root\.path/);
});

test("Reconciler grants deletion authority only to complete roots", () => {
  const reconciler = read("electron/library/reconcile/LibraryReconciler.ts");
  const scanner = read("electron/library/scanner/LibraryScanner.ts");
  const types = read("electron/library/types.ts");
  assert.match(reconciler, /root\.status === "complete"/);
  assert.match(reconciler, /unavailable\.push\(oldTrack\.id\)/);
  for (const status of ["complete", "partial", "offline", "permissionDenied", "cancelled"]) assert.match(types, new RegExp(`"${status}"`));
  assert.match(scanner, /pending\.splice\(0, this\.directoryConcurrency\)/);
  assert.match(scanner, /failures\.push\(failure\("stat", sourcePath, error\)\)/);
});
