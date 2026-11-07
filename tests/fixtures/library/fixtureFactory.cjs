const path = require("node:path");

const SCALE_PROFILES = Object.freeze({
  normal: 128,
  realistic: 15388,
  stress: 100000
});

function makeLegacyTrack(index, options = {}) {
  const root = options.root || "K:\\Music";
  const artistIndex = index % 997;
  const albumIndex = index % 4093;
  const number = String(index + 1).padStart(6, "0");
  const sourcePath = path.win32.join(root, "Artist " + artistIndex, "Album " + albumIndex, "Track " + number + ".flac");
  return {
    id: (index + 1).toString(16).padStart(40, "0"),
    name: "Track " + number,
    artist: "Artist " + artistIndex,
    album: "Album " + albumIndex,
    url: "auralis-media://local/" + encodeURIComponent(sourcePath),
    format: "FLAC",
    size: 10000000 + index,
    sourcePath,
    nativePath: sourcePath,
    duration: 120 + (index % 240),
    year: 1980 + (index % 47),
    genre: ["Rock", "Classical", "Electronic", "Soundtrack"][index % 4],
    folder: path.win32.dirname(sourcePath)
  };
}

function makeLegacyLibrary(trackCount = SCALE_PROFILES.normal, options = {}) {
  const root = options.root || "K:\\Music";
  return {
    tracks: Array.from({ length: trackCount }, (_, index) => makeLegacyTrack(index, { root })),
    folders: [root]
  };
}

module.exports = {
  SCALE_PROFILES,
  makeLegacyTrack,
  makeLegacyLibrary
};
