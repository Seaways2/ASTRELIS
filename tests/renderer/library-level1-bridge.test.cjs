const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const { readMainProcessSource } = require("../helpers/mainProcessSource.cjs");
const read = relative => relative === "electron/main.ts" ? readMainProcessSource() : fs.readFileSync(path.join(root, relative), "utf8");

test("Main is the only library writer and all writes enter LibraryService", () => {
  const main = read("electron/main.ts");
  const service = read("electron/library/LibraryService.ts");
  assert.match(main, /new LibraryService\(/);
  assert.match(main, /new JsonLibraryRepository\(/);
  assert.match(main, /libraryService\.commitLegacySnapshot/);
  assert.match(service, /private writeTail: Promise<void> = Promise\.resolve\(\)/);
  assert.match(service, /this\.writeTail\.then\(operation, operation\)/);
  assert.doesNotMatch(main, /music-library\.json\.tmp/);
  assert.doesNotMatch(main, /fs\.promises\.rm\(libraryIndexPath\(\)/);
});

test("Level 1 await guarantees remain while Level 2 uses Main-side scan commands", () => {
  const store = read("src/stores/playerStore.ts");
  const preload = read("electron/preload.ts");
  assert.match(store, /libraryRevision: number/);
  assert.match(store, /await window\.desktop\.library\.rescan\(folders, meta/);
  assert.match(store, /const meta = libraryCommandMeta\(get\(\)\.libraryRevision\)/);
  assert.match(store, /await window\.desktop\.library\.chooseFolder\(libraryCommandMeta/);
  assert.match(store, /result\.mutation\.status === "conflict"/);
  assert.doesNotMatch(store, /window\.desktop\.library\.save/);
  assert.doesNotMatch(store, /void window\.desktop\?\.library\.save/);
  assert.match(store, /libraryRevision: result\.revision/);
  assert.match(preload, /requestId: string; expectedRevision\?: number/);
  assert.match(preload, /ipcRenderer\.invoke\("library:rescan"/);
});

test("Repository uses immutable checksummed revisions and unique temporary files", () => {
  const repository = read("electron/library/repository/JsonLibraryRepository.ts");
  const validator = read("electron/library/validation/LibraryValidator.ts");
  assert.match(repository, /revisionsDirectory/);
  assert.match(repository, /String\(revision\)\.padStart\(10, "0"\) \+ "\.json"/);
  assert.match(repository, /finalPath \+ "\.tmp\." \+ crypto\.randomUUID\(\)/);
  assert.match(repository, /handle\.sync\(\)/);
  assert.match(repository, /readRevision\(nextRevision\)/);
  assert.match(repository, /retentionCount = Math\.max\(3/);
  assert.match(validator, /createHash\("sha256"\)/);
  assert.match(validator, /revision checksum does not match/);
});
