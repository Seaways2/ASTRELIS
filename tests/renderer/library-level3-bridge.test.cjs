const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("Level 3 bridge imports legacy browser state through Main and keeps original keys", () => {
  const main = read("electron/main.ts");
  const preload = read("electron/preload.ts");
  const store = read("src/stores/playerStore.ts");
  assert.match(main, /ipcMain\.handle\("library:import-legacy-state"/);
  assert.match(main, /libraryService\.importLegacyState/);
  assert.match(preload, /importLegacyState:[\s\S]*library:import-legacy-state/);
  assert.match(store, /await window\.desktop\.library\.importLegacyState/);
  assert.match(store, /localStorage\.setItem\(LEGACY_LIBRARY_IMPORTED_KEY/);
  assert.doesNotMatch(store, /localStorage\.removeItem\(LEGACY_LIBRARY_TRACKS_KEY/);
  assert.doesNotMatch(store, /localStorage\.removeItem\(LEGACY_LIBRARY_FOLDERS_KEY/);
});

test("schema v2 migration is wired before renderer load and exposes every failpoint", () => {
  const main = read("electron/main.ts");
  const service = read("electron/library/LibraryService.ts");
  const migrator = read("electron/library/migration/LibraryMigrator.ts");
  assert.match(main, /new LibraryMigrator/);
  assert.match(service, /this\.migrator \? this\.migrator\.ensureMigrated\(\)/);
  for (const point of [
    "AFTER_LEGACY_READ", "AFTER_TRANSFORM", "AFTER_TMP_WRITE", "AFTER_REVISION_COMMIT",
    "BEFORE_MIGRATION_MARKER", "AFTER_MIGRATION_MARKER", "BEFORE_IPC_ACK"
  ]) assert.match(main + migrator, new RegExp(point));
});
