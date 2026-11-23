const test = require('node:test');
const assert = require('node:assert/strict');
const { removeLibraryFolder } = require('../../dist-electron/library/removeLibraryFolder.js');

test('removing a root preserves similarly named directories and does not mutate input', () => {
  const original = { folders: ['K:\\Music', 'K:\\Music2'], tracks: [
    { sourcePath: 'K:\\Music\\a.flac' }, { sourcePath: 'K:\\Music2\\b.flac' }
  ] };
  const result = removeLibraryFolder(original, 'k:/music/');
  assert.deepEqual(result.folders, ['K:\\Music2']);
  assert.deepEqual(result.tracks, [original.tracks[1]]);
  assert.equal(original.tracks.length, 2);
  assert.equal(original.folders.length, 2);
});

test('tracks covered by another registered root survive removal', () => {
  const track = { sourcePath: 'K:\\Music\\Album\\a.flac' };
  const result = removeLibraryFolder({ folders: ['K:\\Music', 'K:\\Music\\Album'], tracks: [track] }, 'K:\\Music');
  assert.deepEqual(result.tracks, [track]);
});

test('removing a nested root removes the tracks it owns unless its parent scan covers it', (t) => {
  // A nested root the parent's scan does not enter (a junction, or one whose
  // parent cannot be read now): its tracks go with it instead of staying
  // unplayable forever under the parent.
  const linked = { sourcePath: 'K:\\Music\\Link\\a.flac' };
  const parentTrack = { sourcePath: 'K:\\Music\\b.flac' };
  const deeper = { sourcePath: 'K:\\Music\\Link\\Deeper\\c.flac' };
  const payload = { folders: ['K:\\Music', 'K:\\Music\\Link', 'K:\\Music\\Link\\Deeper'], tracks: [linked, parentTrack, deeper] };
  const result = removeLibraryFolder(payload, 'k:/music/link');
  assert.deepEqual(result.folders, ['K:\\Music', 'K:\\Music\\Link\\Deeper']);
  assert.deepEqual(result.tracks, [parentTrack, deeper], 'a deeper root keeps its own tracks');
  if (process.platform !== 'win32') return;
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auralis-remove-nested-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const parent = path.join(directory, 'Music'), target = path.join(directory, 'Elsewhere');
  fs.mkdirSync(path.join(parent, 'Plain'), { recursive: true }); fs.mkdirSync(target);
  fs.symlinkSync(target, path.join(parent, 'Link'), 'junction');
  const inLink = { sourcePath: path.join(parent, 'Link', 'a.flac') };
  const inPlain = { sourcePath: path.join(parent, 'Plain', 'b.flac') };
  const real = { folders: [parent, path.join(parent, 'Link'), path.join(parent, 'Plain')], tracks: [inLink, inPlain] };
  assert.deepEqual(removeLibraryFolder(real, path.join(parent, 'Link')).tracks, [inPlain], 'the junction root takes its tracks along');
  assert.deepEqual(removeLibraryFolder(real, path.join(parent, 'Plain')).tracks, [inLink, inPlain], 'a plain subfolder stays covered by its parent');
});

test('last root can be removed, and unregistered roots are rejected', () => {
  const payload = { folders: ['K:\\音乐'], tracks: [{ sourcePath: 'K:\\音乐\\专辑\\a.flac' }] };
  assert.deepEqual(removeLibraryFolder(payload, 'K:\\音乐'), { folders: [], tracks: [] });
  assert.throws(() => removeLibraryFolder(payload, 'K:\\Elsewhere'), /not registered/);
});
