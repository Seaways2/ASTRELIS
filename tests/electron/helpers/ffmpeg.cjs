// FFmpeg for the electron tests, found the way electron/main.ts findFfmpeg()
// finds it in a source checkout: the bundled copy the installer ships
// (ffmpeg/ffmpeg.exe, kept out of git), then the common install location,
// then PATH.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "../../..");

function findFfmpeg() {
  const candidates = [
    process.env.ASTRELIS_FFMPEG,
    path.join(root, "ffmpeg", "ffmpeg.exe"),
    path.join(process.env.ProgramFiles || "C:/Program Files", "ffmpeg", "bin", "ffmpeg.exe")
  ].filter(Boolean);
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (found) return found;
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["ffmpeg"], { encoding: "utf8" });
  const fromPath = probe.status === 0 ? probe.stdout.split(/\r?\n/).find(Boolean) : undefined;
  if (fromPath) return fromPath.trim();
  throw new Error("FFmpeg not found: put ffmpeg.exe in ffmpeg/, install it under C:/Program Files/ffmpeg/bin, add it to PATH or set ASTRELIS_FFMPEG");
}

module.exports = { ffmpeg: findFfmpeg() };
