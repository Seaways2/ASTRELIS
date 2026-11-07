const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
function queryModule() {
  const source = fs.readFileSync(path.resolve(__dirname, "../../src/library/LibraryQueryService.ts"), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  let constructions = 0;
  const instrumentedIntl = { Collator: function (...args) { constructions++; return new Intl.Collator(...args); } };
  Function("exports", "module", "Intl", js)(module.exports, module, instrumentedIntl);
  return { LibraryIndex: module.exports.LibraryIndex, constructions: () => constructions };
}
const names = ["Track 2", "Track 10", "Track 02", "track 2", "écho", "Echo", "周杰伦", "王菲", "市井", "夢灯籠", "あい", "アイ", "愛", "ＡＢＣ", "ABC", "same", "same"];
const makeTrack = (name, index) => ({
  id: String(index), name, artist: names[index % 5], album: names[index % 7], format: index % 2 ? "FLAC" : "MP3",
  size: index % 3, url: "test", folder: "D:\\Music"
});
function legacyCompare(left, right, sort, locale, ascending) {
  const field = sort === "artist" ? "artist" : sort === "album" ? "album" : sort === "format" ? "format" : "name";
  let result = sort === "size" ? left.size - right.size
    : String(left[field]).localeCompare(String(right[field]), locale, { numeric: true, sensitivity: "base" });
  if (!result) result = left.name.localeCompare(right.name, locale, { numeric: true, sensitivity: "base" });
  return result * (ascending ? 1 : -1);
}
test("cached collation preserves Chinese, Japanese, English, numeric and tied ordering", () => {
  const { LibraryIndex, constructions } = queryModule();
  const tracks = names.map(makeTrack);
  const index = new LibraryIndex(tracks);
  for (const locale of ["zh-CN", "ja-JP", "en-US"]) {
    for (const sort of ["title", "artist", "album", "format", "size"]) {
      for (const sortAscending of [true, false]) {
        const expected = [...tracks].sort((a, b) => legacyCompare(a, b, sort, locale, sortAscending)).map(track => track.id);
        assert.deepEqual(index.queryIds({ sort, sortAscending }, locale), expected, `${locale}/${sort}/${sortAscending}`);
      }
    }
  }
  assert.equal(constructions(), 3, "one collator per locale, reused across comparisons and sort keys");
});
test("a 15k full-library cold sort remains bounded and cached lookups reuse its result", context => {
  const { LibraryIndex, constructions } = queryModule();
  const count = 15000;
  const tracks = Array.from({ length: count }, (_, i) => makeTrack("曲目 " + (i * 7919) % count, i));
  const index = new LibraryIndex(tracks);
  const started = performance.now();
  const sorted = index.queryIds({ sort: "title" }, "zh-CN");
  const elapsed = performance.now() - started;
  assert.equal(sorted.length, count);
  assert.equal(index.byMediaId.get(sorted[0]).name, "曲目 0");
  assert.equal(index.byMediaId.get(sorted[count - 1]).name, "曲目 14999");
  assert.equal(constructions(), 1);
  assert.equal(index.queryIds({ sort: "title" }, "zh-CN"), sorted);
  assert.ok(elapsed < 2500, `cold full-library sort took ${elapsed.toFixed(1)} ms`);
  context.diagnostic(`15,000-row cold sort: ${elapsed.toFixed(1)} ms`);
});
