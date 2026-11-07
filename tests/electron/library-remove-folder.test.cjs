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

test('last root can be removed, and unregistered roots are rejected', () => {
  const payload = { folders: ['K:\\音乐'], tracks: [{ sourcePath: 'K:\\音乐\\专辑\\a.flac' }] };
  assert.deepEqual(removeLibraryFolder(payload, 'K:\\音乐'), { folders: [], tracks: [] });
  assert.throws(() => removeLibraryFolder(payload, 'K:\\Elsewhere'), /not registered/);
});
