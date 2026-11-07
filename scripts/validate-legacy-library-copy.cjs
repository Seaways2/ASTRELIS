const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { LibraryMigrator } = require("../dist-electron/library/migration/LibraryMigrator.js");
const { JsonLibraryRepository } = require("../dist-electron/library/repository/JsonLibraryRepository.js");
const { upgradeLibraryDomain } = require("../dist-electron/library/domain/LibraryDomain.js");

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function main() {
  const sourcePath = path.resolve(process.argv[2] || "");
  if (!sourcePath || !fs.statSync(sourcePath).isFile()) throw new Error("Pass a legacy music-library.json file path");
  const sourceHash = sha256(sourcePath);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "auralis-legacy-validation-"));
  try {
    const legacyPath = path.join(temporaryDirectory, "music-library.json");
    const storageDirectory = path.join(temporaryDirectory, "library-v2");
    fs.copyFileSync(sourcePath, legacyPath);
    const legacy = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
    const preview = upgradeLibraryDomain(legacy);
    const identities = new Map();
    for (const track of preview.tracks) {
      const group = identities.get(track.mediaId) || [];
      group.push(String(track.sourcePath || track.nativePath || "").replace(/\//g, "\\").toLocaleLowerCase());
      identities.set(track.mediaId, group);
    }
    const collisions = [...identities.values()].filter(group => group.length > 1);
    process.stdout.write(JSON.stringify({
      previewTracks: preview.tracks.length,
      collisionGroups: collisions.length,
      collisionRecords: collisions.reduce((total, group) => total + group.length, 0),
      samePathCollisionGroups: collisions.filter(group => new Set(group).size === 1).length,
      distinctPathCollisionGroups: collisions.filter(group => new Set(group).size > 1).length,
      largestCollisionGroup: Math.max(0, ...collisions.map(group => group.length))
    }) + "\n");
    const repository = new JsonLibraryRepository({ storageDirectory, legacyPath });
    const migrator = new LibraryMigrator(repository, { storageDirectory, legacyPath });
    const result = await migrator.ensureMigrated();
    const tracks = result.snapshot?.tracks || [];
    if (sha256(sourcePath) !== sourceHash) throw new Error("Original legacy library changed during validation");
    process.stdout.write(JSON.stringify({
      status: result.status,
      schemaVersion: result.snapshot?.schemaVersion,
      domainVersion: result.snapshot?.domainVersion,
      revision: result.snapshot?.revision,
      tracks: tracks.length,
      missingYears: tracks.filter(track => track.year === undefined).length,
      validRevisions: await repository.listValidRevisions(),
      originalSha256Unchanged: sourceHash
    }, null, 2) + "\n");
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
