#!/usr/bin/env node
// Real-song tuning for the particle visualizers (galaxy, starfield, black hole).
//
//   capture  Decode songs with FFmpeg and store the spectrum frames the app's
//            visualizers would receive (see lib/analyserEmulation.cjs).
//   report   Replay captures through the real beat detector and scenes and
//            write per-song metrics plus an HTML timeline.
//
//   node scripts/visualizer-tuning.cjs capture [--seconds 240] [--out tuning/captures] <file|folder>...
//   node scripts/visualizer-tuning.cjs report  [--out tuning/report.html] [capture|folder]...
//
// Captures hold derived spectra only, never audio; tuning/ is not committed.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const { spectrumFrames, writeCapture, readCapture, FRAME_RATE } = require("./lib/analyserEmulation.cjs");

const root = path.resolve(__dirname, "..");
const AUDIO = /\.(flac|mp3|m4a|aac|wav|ogg|opus|ape|wma|dsf|aiff?)$/i;
const SAMPLE_RATE = 48000;

function parseArgs(argv) {
  const options = {}, positional = [];
  for (let index = 0; index < argv.length; index++) {
    if (argv[index].startsWith("--")) options[argv[index].slice(2)] = argv[++index];
    else positional.push(argv[index]);
  }
  return { options, positional };
}

const expand = (inputs, pattern) => inputs.flatMap(input => fs.statSync(input).isDirectory()
  ? fs.readdirSync(input).filter(name => pattern.test(name)).map(name => path.join(input, name))
  : [input]);

function findFfmpeg() {
  const candidates = [process.env.ASTRELIS_FFMPEG, path.join(root, "ffmpeg", "ffmpeg.exe"),
    path.join(process.env.ProgramFiles || "C:/Program Files", "ffmpeg", "bin", "ffmpeg.exe")].filter(Boolean);
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (found) return found;
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["ffmpeg"], { encoding: "utf8" });
  if (probe.status === 0) return probe.stdout.split(/\r?\n/).find(Boolean).trim();
  throw new Error("FFmpeg not found: put ffmpeg.exe in ffmpeg/, add it to PATH or set ASTRELIS_FFMPEG");
}

const safeName = text => text.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
// Same-titled songs from different albums must not overwrite each other.
const captureName = file => `${safeName(path.basename(file).replace(AUDIO, ""))}-${crypto.createHash("sha1").update(path.resolve(file)).digest("hex").slice(0, 8)}`;

function capture(files, { seconds = "240", out = path.join(root, "tuning", "captures") }) {
  const ffmpeg = findFfmpeg();
  fs.mkdirSync(out, { recursive: true });
  for (const file of expand(files, AUDIO)) {
    // Web Audio analyses the downmixed signal: mono at the output rate.
    const decoded = spawnSync(ffmpeg, ["-v", "error", "-t", String(seconds), "-i", file, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "-"],
      { maxBuffer: 1024 * 1024 * 1024 });
    if (decoded.status !== 0) { console.error(`skip ${file}: ${String(decoded.stderr).trim().split("\n").pop()}`); continue; }
    const samples = new Float32Array(decoded.stdout.buffer, decoded.stdout.byteOffset, Math.floor(decoded.stdout.byteLength / 4));
    const frames = spectrumFrames(samples, SAMPLE_RATE);
    const title = path.basename(file).replace(AUDIO, "");
    const target = path.join(out, `${captureName(file)}.spectrum`);
    writeCapture(target, { title, source: path.basename(file), sampleRate: SAMPLE_RATE, seconds: samples.length / SAMPLE_RATE }, frames);
    console.log(`captured ${title} (${(samples.length / SAMPLE_RATE).toFixed(0)} s) -> ${path.relative(root, target)}`);
  }
}

const mean = values => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; };
const quantile = (values, q) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0; };
/** Trailing average over `width` + 1 values, in one pass. */
function movingAverage(values, width) {
  const averages = new Array(values.length);
  let sum = 0;
  for (let index = 0; index < values.length; index++) {
    sum += values[index];
    if (index > width) sum -= values[index - width - 1];
    averages[index] = sum / Math.min(index + 1, width + 1);
  }
  return averages;
}
function correlation(a, b) {
  const ma = mean(a), mb = mean(b);
  let covariance = 0, va = 0, vb = 0;
  for (let index = 0; index < a.length; index++) { covariance += (a[index] - ma) * (b[index] - mb); va += (a[index] - ma) ** 2; vb += (b[index] - mb) ** 2; }
  return va && vb ? covariance / Math.sqrt(va * vb) : 0;
}

// What the behaviour tests require of the synthetic song, applied to real ones.
const SCENES = {
  waveform: { label: "银河", swing: .05, jump: .06, colour: "#5ad1e6" },
  particles: { label: "星空", swing: .25, jump: .45, colour: "#f2c46d" },
  pulse: { label: "黑洞", swing: .12, jump: .2, colour: "#e6739f" }
};

function analyse(captureFile, harness) {
  const { header, frames: raw } = readCapture(captureFile);
  const settings = harness.defaultSettings;
  // Smooth as the app does, once, and share the frames between all runs.
  const frames = [];
  let smoothed;
  for (const frame of raw) { smoothed = harness.smoothFrequencyFrame(frame, smoothed, settings.smoothing, smoothed ? 1000 / FRAME_RATE : 0); frames.push(smoothed); }
  const seconds = frames.length / FRAME_RATE;

  const music = new harness.MusicDynamics(settings);
  const beats = [], beatEnvelope = [], loudness = [];
  frames.forEach((frame, index) => {
    music.update(frame, 48000, index / FRAME_RATE, 1 / FRAME_RATE);
    if (music.beatHit) beats.push(index / FRAME_RATE);
    beatEnvelope.push(music.beat);
    let sum = 0;
    for (let bin = 0; bin < 86; bin++) sum += frame[bin];
    loudness.push(sum / 86 / 255);
  });
  const intervals = beats.slice(1).map((time, index) => time - beats[index]);
  const typical = median(intervals);
  const regular = typical ? intervals.filter(gap => [.5, 1, 2].some(ratio => Math.abs(gap - typical * ratio) < typical * ratio * .12)).length / intervals.length : 0;

  const scenes = {};
  for (const [mode, expected] of Object.entries(SCENES)) {
    const light = Array.from(harness.runScene(mode, frames, { settings }));
    const middle = median(light);
    const swings = [];
    for (let start = 0; start + 2 * FRAME_RATE <= light.length; start += 2 * FRAME_RATE) {
      const window = light.slice(start, start + 2 * FRAME_RATE);
      swings.push((Math.max(...window) - Math.min(...window)) / Math.max(1e-9, mean(window)));
    }
    const jumps = light.slice(1).map((value, index) => (value - light[index]) / Math.max(1e-9, middle));
    const swing = median(swings), jump = quantile(jumps, .995);
    const opening = mean(light.slice(0, Math.round(1.5 * FRAME_RATE))) / Math.max(1e-9, middle);
    const follow = correlation(movingAverage(loudness, FRAME_RATE * 2).filter((_, i) => i % 15 === 0), movingAverage(light, FRAME_RATE * 2).filter((_, i) => i % 15 === 0));
    const problems = [];
    if (beats.length / seconds > .4 && swing < expected.swing) problems.push(`起伏 ${(swing * 100).toFixed(0)}% 偏小`);
    if (jump > expected.jump) problems.push(`单帧变亮 ${(jump * 100).toFixed(0)}% 偏大`);
    if (opening > 1.25) problems.push(`开头偏亮 ${(opening * 100).toFixed(0)}%`);
    if (follow < .2) problems.push(`亮度不跟响度 (r=${follow.toFixed(2)})`);
    scenes[mode] = { light, swing, jump, opening, follow, problems };
  }
  return {
    title: header.title, seconds, beats, bpmDetected: beats.length / seconds * 60, tempo: typical ? 60 / typical : 0, regular,
    beatEnvelope, loudness, scenes
  };
}

function polyline(values, width, height, top, scale = Math.max(...values, 1e-9)) {
  const step = Math.max(1, Math.floor(values.length / width));
  const points = [];
  for (let index = 0; index < values.length; index += step)
    points.push(`${(index / values.length * width).toFixed(1)},${(top + height - Math.min(1, values[index] / scale) * height).toFixed(1)}`);
  return points.join(" ");
}

const escapeHtml = text => String(text).replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[character]);

function htmlReport(results) {
  const width = 1000;
  const blocks = results.map(result => {
    const lanes = Object.entries(SCENES).map(([mode, scene], lane) =>
      `<polyline fill="none" stroke="${scene.colour}" stroke-width="1" points="${polyline(result.scenes[mode].light, width, 60, 130 + lane * 66)}"/>` +
      `<text x="4" y="${142 + lane * 66}">${scene.label}亮度</text>`).join("");
    const ticks = result.beats.map(time => `<line x1="${(time / result.seconds * width).toFixed(1)}" x2="${(time / result.seconds * width).toFixed(1)}" y1="62" y2="70"/>`).join("");
    const rows = Object.entries(SCENES).map(([mode, scene]) => {
      const metrics = result.scenes[mode];
      return `<tr><td>${scene.label}</td><td>${(metrics.swing * 100).toFixed(0)}%</td><td>${(metrics.jump * 100).toFixed(0)}%</td><td>${(metrics.opening * 100).toFixed(0)}%</td><td>${metrics.follow.toFixed(2)}</td><td class="${metrics.problems.length ? "warn" : "ok"}">${metrics.problems.map(escapeHtml).join("；") || "合格"}</td></tr>`;
    }).join("");
    return `<section><h2>${escapeHtml(result.title)}</h2>
<p>${result.seconds.toFixed(0)} 秒 · 检测到 ${result.beats.length} 拍（每分钟 ${result.bpmDetected.toFixed(0)}）· 估计速度 ${result.tempo.toFixed(0)} BPM · 节拍规律性 ${(result.regular * 100).toFixed(0)}%</p>
<svg viewBox="0 0 ${width} 330" preserveAspectRatio="none">
<polyline fill="none" stroke="var(--muted)" stroke-width="1" points="${polyline(result.loudness, width, 50, 4, 1)}"/><text x="4" y="16">响度</text>
<g class="ticks">${ticks}</g>
<polyline fill="none" stroke="var(--beat)" stroke-width="1" points="${polyline(result.beatEnvelope, width, 46, 74, 1)}"/><text x="4" y="86">节拍闪</text>
${lanes}</svg>
<table><tr><th>场景</th><th>每拍起伏</th><th>单帧最大变亮</th><th>开头亮度</th><th>跟随响度</th><th>结论</th></tr>${rows}</table></section>`;
  }).join("\n");
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>可视化真实歌曲调参报告</title>
<style>:root{--bg:#0b1016;--fg:#dce7ee;--muted:#6f8796;--beat:#ff9d3b;--ok:#6fd39a;--warn:#ff8a7a}
body{margin:0;padding:16px 24px;background:var(--bg);color:var(--fg);font:14px/1.5 "Microsoft YaHei",system-ui,sans-serif}
section{margin:0 0 28px;padding:12px 16px;border:1px solid #1f2b35;border-radius:8px}h2{margin:0 0 4px;font-size:16px}
svg{width:100%;height:330px;background:#070b10;border-radius:4px}svg text{fill:var(--muted);font-size:11px}.ticks line{stroke:var(--beat);stroke-width:1}
table{border-collapse:collapse;margin-top:8px}td,th{padding:3px 12px;border-bottom:1px solid #1f2b35;text-align:left}.ok{color:var(--ok)}.warn{color:var(--warn)}</style>
<h1>可视化真实歌曲调参报告</h1><p>生成于 ${new Date().toLocaleString("zh-CN")}。门槛与合成歌曲的行为测试一致：每拍起伏（有鼓点的歌）、单帧最大变亮（频闪）、开头 1.5 秒亮度相对全曲中位数、2 秒平均亮度与响度的相关系数。</p>
${blocks}</html>`;
}

function report(inputs, { out = path.join(root, "tuning", "report.html"), json }) {
  const harness = require("./lib/sceneHarness.cjs");
  const files = expand(inputs.length ? inputs : [path.join(root, "tuning", "captures")], /\.spectrum$/i);
  const results = files.map(file => { const result = analyse(file, harness); console.log(summaryLine(result)); return result; });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, htmlReport(results));
  const summary = results.map(result => ({
    title: result.title, seconds: Math.round(result.seconds), beatsPerMinute: Math.round(result.bpmDetected), tempo: Math.round(result.tempo), regular: +result.regular.toFixed(2),
    scenes: Object.fromEntries(Object.entries(result.scenes).map(([mode, metrics]) => [mode, {
      swing: +metrics.swing.toFixed(3), jump: +metrics.jump.toFixed(3), opening: +metrics.opening.toFixed(2), follow: +metrics.follow.toFixed(2), problems: metrics.problems
    }]))
  }));
  fs.writeFileSync(json || out.replace(/\.html$/i, ".json"), JSON.stringify(summary, null, 1));
  console.log(`report -> ${path.relative(root, out)}`);
  return summary;
}

function summaryLine(result) {
  const scenes = Object.entries(SCENES).map(([mode, scene]) => {
    const metrics = result.scenes[mode];
    return `${scene.label} 起伏${(metrics.swing * 100).toFixed(0)}% 跳${(metrics.jump * 100).toFixed(0)}% 开头${(metrics.opening * 100).toFixed(0)}% r=${metrics.follow.toFixed(2)}${metrics.problems.length ? " ⚠" : ""}`;
  }).join(" | ");
  return `${result.title.slice(0, 28).padEnd(28)} ${String(Math.round(result.bpmDetected)).padStart(3)}拍/分 规律${(result.regular * 100).toFixed(0)}% | ${scenes}`;
}

if (require.main === module) {
  const [command, ...rest] = process.argv.slice(2);
  const { options, positional } = parseArgs(rest);
  if (command === "capture" && positional.length) capture(positional, options);
  else if (command === "report") report(positional, options);
  else {
    console.log("usage:\n  node scripts/visualizer-tuning.cjs capture [--seconds 240] [--out dir] <file|folder>...\n  node scripts/visualizer-tuning.cjs report [--out file.html] [capture|folder]...");
    process.exitCode = 1;
  }
}

module.exports = { capture, report, analyse };
