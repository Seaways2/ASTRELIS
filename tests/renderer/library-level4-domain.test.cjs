const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("renderer Track compatibility surface carries stable domain identity", () => {
  const types = read("src/types/audio.ts");
  assert.match(types, /mediaId\?: string/);
  assert.match(types, /location\?: \{ rootId: string; sourcePath: string; canonicalPath: string \}/);
  assert.match(types, /artists: Array<\{ artistId: string; name: string \}>/);
  assert.match(types, /albumArtist\?: string/);
  assert.match(types, /compilation\?: boolean/);
});

test("favorites migrate from path keys to mediaId keys without deleting the legacy backup", () => {
  const store = read("src/stores/playerStore.ts");
  assert.match(store, /FAVORITES_V2_STORAGE_KEY = "auralis\.library\.favorites\.v2"/);
  assert.match(store, /track\.mediaId \? `media:\$\{track\.mediaId\}`/);
  assert.match(store, /migrateFavoriteTrackKeys\(libraryTracks, get\(\)\.favoriteTrackKeys\)/);
  assert.match(store, /\^media:\[a-f0-9\]\{64\}\$/);
  assert.doesNotMatch(store, /localStorage\.removeItem\(FAVORITES_STORAGE_KEY/);
});

test("v2 favorites stay authoritative after an unfavorite and restart", () => {
  const store = read("src/stores/playerStore.ts");
  assert.match(store, /const currentRaw = localStorage\.getItem\(FAVORITES_V2_STORAGE_KEY\)/);
  assert.match(store, /JSON\.parse\(currentRaw !== null \? currentRaw : \(legacyRaw \|\| "\[\]"\)\)/);
  assert.doesNotMatch(store, /\.\.\.\(Array\.isArray\(legacy\)/);
});
