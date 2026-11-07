const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const { makeLegacyLibrary } = require("../tests/fixtures/library/fixtureFactory.cjs");
const { upgradeLibraryDomain } = require("../dist-electron/library/domain/LibraryDomain.js");
const { JsonLibraryRepository } = require("../dist-electron/library/repository/JsonLibraryRepository.js");

function memoryMb() {
  const usage = process.memoryUsage();
  return {
    rss: Number((usage.rss / 1024 / 1024).toFixed(1)),
    heapUsed: Number((usage.heapUsed / 1024 / 1024).toFixed(1))
  };
}

async function benchmark(trackCount) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `auralis-json-${trackCount}-`));
  try {
    global.gc?.();
    const initialMemoryMb = memoryMb();
    let started = performance.now();
    const payload = upgradeLibraryDomain(makeLegacyLibrary(trackCount));
    const domainBuildMs = performance.now() - started;
    const domainMemoryMb = memoryMb();

    const repository = new JsonLibraryRepository({ storageDirectory: directory, retentionCount: 5 });
    started = performance.now();
    const committed = await repository.commit(payload, { requestId: `benchmark-${trackCount}` });
    const commitMs = performance.now() - started;
    const commitMemoryMb = memoryMb();

    started = performance.now();
    const loaded = await repository.loadLatestValid();
    const loadMs = performance.now() - started;
    const loadMemoryMb = memoryMb();
    const revisionPath = path.join(directory, "revisions", "0000000001.json");

    return {
      trackCount,
      status: committed.status,
      loadedStatus: loaded.status,
      loadedTracks: loaded.snapshot?.tracks.length || 0,
      domainBuildMs: Number(domainBuildMs.toFixed(1)),
      commitMs: Number(commitMs.toFixed(1)),
      loadMs: Number(loadMs.toFixed(1)),
      revisionMiB: Number((fs.statSync(revisionPath).size / 1024 / 1024).toFixed(1)),
      memoryMb: { initial: initialMemoryMb, domain: domainMemoryMb, committed: commitMemoryMb, loaded: loadMemoryMb }
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function main() {
  const requested = process.argv.slice(2).map(Number).filter(value => Number.isSafeInteger(value) && value > 0);
  const sizes = requested.length ? requested : [15000, 50000, 100000];
  const results = [];
  for (const size of sizes) results.push(await benchmark(size));
  process.stdout.write(JSON.stringify({ repository: "JsonLibraryRepository", results }, null, 2) + "\n");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
