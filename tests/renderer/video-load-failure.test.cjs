const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("an unplayable video has its own localized surface state", () => {
  const exports = {};
  Function("exports", ts.transpileModule(read("src/i18n/video.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(exports);
  for (const language of ["zh-CN", "en-US", "ja-JP"]) {
    for (const key of ["video.unplayable", "video.unplayable.hint", "video.retry"])
      assert.ok(exports.videoMessages[language][key], `${language} ${key}`);
  }
});

test("a load failure is shown on the video surface instead of the loading text", () => {
  const view = read("src/components/VideoView.tsx");
  // The failure belongs to the current play request only, so a stale error
  // from an earlier item never replaces the next video's preparation.
  assert.match(view, /const failed = !busy && Boolean\(state\?\.error\) && !state\?\.ready && Boolean\(playbackToken\) && state\?\.playbackToken === playbackToken;/);
  assert.match(view, /: failed \? <div className="video-failure" role="alert">/);
  assert.ok(view.indexOf(': failed ?') < view.indexOf('t("video.loading")'), "failure is checked before the loading fallback");
  // Play on a failed video reopens it; a failed video never stays "running".
  assert.match(view, /if \(started\) retryCurrentVideo\(\);\s*else usePlayerStore\.getState\(\)\.setPlaying\(false\);/);
  assert.match(read("src/components/VideoView.css"), /\.video-failure \{/);
});
