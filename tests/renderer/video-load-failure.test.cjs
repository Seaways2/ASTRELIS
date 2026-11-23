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
  assert.match(read("src/components/VideoView.css"), /\.video-failure \{/);
});

test("Play on a failed video reopens it on every page, not only where VideoView is mounted", () => {
  const app = read("src/App.tsx");
  const view = read("src/components/VideoView.tsx");
  // VideoView exists only on the now-playing page; the footer transport and
  // media keys work everywhere, so the decision cannot live in VideoView.
  assert.match(app, /renderedPage === "nowPlaying" \?/);
  assert.doesNotMatch(view, /setPlaying\(/, "VideoView does not decide the transport");
  assert.doesNotMatch(view, /useEffect\([^]*?retryCurrentVideo\(\)/, "VideoView does not reopen from an effect");
  assert.match(view, /onClick=\{retryCurrentVideo\}/, "the explicit retry button stays");

  const start = app.indexOf("if (videoActive) {\n      previousLocalPlaying.current = false;");
  assert.ok(start > 0, "video branch of the transport effect");
  const branch = app.slice(start, app.indexOf("return;", start));
  // The effect re-runs on every playing change and tracks its own false -> true edge.
  assert.match(branch, /const startedVideo = state\.playing && !previousVideoPlaying\.current;\s*previousVideoPlaying\.current = state\.playing;/);
  // Both an open that threw and a failure mpv reported for this request count.
  assert.match(branch, /const openFailed = videoOpenFailedToken\.current === token;/);
  assert.match(branch, /const playerFailed = Boolean\(videoState\?\.error\) && !videoState\?\.ready && videoState\?\.playbackToken === token;/);
  assert.match(branch, /if \(state\.playing && !videoPreparing && \(openFailed \|\| playerFailed\) && !state\.hasPendingPlay\(\)\) \{/);
  // Play reopens it (keeping the position); anything else never stays "running".
  assert.match(branch, /if \(startedVideo\) \{[^}]*state\.reloadCurrentTrack\(\);\s*\} else state\.setPlaying\(false\);/);
  assert.doesNotMatch(branch, /viewShowsFailure/, "a reported failure is no longer left to VideoView");
  // The effect depends on playing, so a footer/media-key Play reaches it.
  const effectEnd = app.indexOf("}, [state.playing, nativePlayback, state.onlineMedia?.playing, videoActive, videoState?.ready, videoPreparing]);", start);
  assert.ok(effectEnd > start, "transport effect dependencies include playing");
});
