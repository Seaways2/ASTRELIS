// The application log rotates by size and keeps a fixed number of backups.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { RotatingLogFile } = require("../../dist-electron/logFile.js");

const temporaryDirectory = t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "astrelis-log-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, "logs");
};

test("lines are appended in order and the directory is created on first write", t => {
  const directory = temporaryDirectory(t);
  const log = new RotatingLogFile(directory, 1024);
  log.write("first\n");
  log.write("second\n");
  assert.equal(fs.readFileSync(path.join(directory, "auralis.log"), "utf8"), "first\nsecond\n");
});

test("the log rotates past its size limit and keeps only the newest backups", t => {
  const directory = temporaryDirectory(t);
  const log = new RotatingLogFile(directory, 100, 2);
  const line = index => `${String(index).padStart(3, "0")} ${"x".repeat(45)}\n`; // 50 bytes
  for (let index = 0; index < 9; index++) log.write(line(index));
  const read = name => fs.readFileSync(path.join(directory, name), "utf8");
  assert.deepEqual(fs.readdirSync(directory).sort(), ["auralis.1.log", "auralis.2.log", "auralis.log"]);
  assert.equal(read("auralis.log"), line(8));
  assert.equal(read("auralis.1.log"), line(6) + line(7));
  assert.equal(read("auralis.2.log"), line(4) + line(5));
  for (const name of fs.readdirSync(directory)) assert.ok(fs.statSync(path.join(directory, name)).size <= 100);
});

test("an existing large log is rotated on the first write after a restart", t => {
  const directory = temporaryDirectory(t);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "auralis.log"), "y".repeat(500));
  new RotatingLogFile(directory, 100).write("after restart\n");
  assert.equal(fs.readFileSync(path.join(directory, "auralis.log"), "utf8"), "after restart\n");
  assert.equal(fs.statSync(path.join(directory, "auralis.1.log")).size, 500);
});
