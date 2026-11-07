const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("LibraryService and LibraryMigrator depend only on the repository interface", () => {
  const service = read("electron/library/LibraryService.ts");
  const migrator = read("electron/library/migration/LibraryMigrator.ts");
  assert.match(service, /private readonly repository: LibraryRepository/);
  assert.match(migrator, /private readonly repository: LibraryRepository/);
  assert.doesNotMatch(service, /JsonLibraryRepository|sqlite/i);
  assert.doesNotMatch(migrator, /JsonLibraryRepository|sqlite/i);
});

test("the JSON implementation is selected only at the Electron composition root", () => {
  const main = read("electron/main.ts");
  const repository = read("electron/library/repository/JsonLibraryRepository.ts");
  assert.match(main, /new JsonLibraryRepository\(/);
  assert.match(repository, /implements LibraryRepository/);
  assert.match(repository, /validateLibraryPayloadV2\(payload\)/);
  assert.match(repository, /validatePersistedRevision/);
});

test("Level 7 records measured 15k, 50k and 100k storage evidence and a reversible decision", { skip: !fs.existsSync(path.join(root,"LEVEL-7-STORAGE-DECISION.md")) && "Historical benchmark report not present; no performance evidence claimed for 2.17.0" }, () => {
  const decision = read("LEVEL-7-STORAGE-DECISION.md");
  for (const scale of ["15,000", "50,000", "100,000"]) assert.match(decision, new RegExp(scale));
  assert.match(decision, /继续使用 JsonLibraryRepository/);
  assert.match(decision, /SqliteLibraryRepository/);
  assert.match(decision, /LibraryRepository/);
});
