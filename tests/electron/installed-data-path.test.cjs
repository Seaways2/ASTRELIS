const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installedDataPath } = require('../../dist-electron/installedDataPath');

test('installer and first launch allow a writable system-drive folder and preserve it on upgrade', {skip: process.platform !== 'win32'}, () => {
  const {spawnSync} = require('node:child_process');
  const parent = os.tmpdir();
  const root = fs.mkdtempSync(path.join(parent, 'astrelis-system-data-test-'));
  const data = path.join(root, '中文 UserData');
  const script = path.resolve('build/data-lifecycle.ps1');
  const prepare = target => spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Action','Prepare','-Target',target], {encoding:'utf8',windowsHide:true});
  try {
    assert.equal(path.parse(root).root.toLowerCase(), `${process.env.SystemDrive || 'C:'}\\`.toLowerCase(), 'Fixture must exercise the actual system drive');
    // Also exercise recovery before the installer has created the marker.
    fs.writeFileSync(path.join(root,'astrelis-data.ini'), '[UserData]\nPath='+data+'\n');
    const profile = installedDataPath(path.join(root,'ASTRELIS.exe'));
    fs.writeFileSync(path.join(profile,'settings.json'),'preserve');
    let result = prepare(data);
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal(fs.readFileSync(path.join(profile,'settings.json'),'utf8'),'preserve');
    const fresh=path.join(root,'new-install');
    result=prepare(fresh);
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal(fs.readFileSync(path.join(fresh,'.astrelis-owner'),'utf8'),'com.auralis.player');
    const unknown=path.join(root,'unrelated');fs.mkdirSync(unknown);fs.writeFileSync(path.join(unknown,'keep.txt'),'keep');
    assert.notEqual(prepare(unknown).status,0);
    assert.equal(fs.readFileSync(path.join(unknown,'keep.txt'),'utf8'),'keep');
    assert.notEqual(prepare(path.parse(root).root).status,0);
  } finally {
    assert.equal(path.dirname(path.resolve(root)),path.resolve(parent));
    assert.ok(path.basename(root).startsWith('astrelis-system-data-test-'));
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('missing installation data is initialized only in dedicated empty folders on any drive', () => {
  const parent = path.resolve('release-work');
  fs.mkdirSync(parent, {recursive:true});
  const root = fs.mkdtempSync(path.join(parent, 'data-recovery-'));
  const executable = path.join(root, 'ASTRELIS.exe');
  const configure = data => fs.writeFileSync(path.join(root, 'astrelis-data.ini'), '\ufeff[UserData]\r\nPath=' + data + '\r\n', 'utf16le');
  try {
    const data = path.join(root, '中文 空目录'); configure(data);
    const profile = installedDataPath(executable);
    assert.equal(profile, path.join(data,'Profile'));
    assert.equal(fs.readFileSync(path.join(data,'.astrelis-owner'),'utf8'),'com.auralis.player');
    fs.writeFileSync(path.join(profile,'settings.json'),'keep');
    assert.equal(installedDataPath(executable),profile);
    fs.unlinkSync(path.join(data,'.astrelis-owner'));
    assert.throws(()=>installedDataPath(executable),/已有文件已保留/);
    assert.equal(fs.readFileSync(path.join(profile,'settings.json'),'utf8'),'keep');
    const empty = path.join(root,'empty'); fs.mkdirSync(empty); configure(empty);
    assert.equal(installedDataPath(executable),path.join(empty,'Profile'));
    configure(path.parse(root).root);
    assert.throws(()=>installedDataPath(executable),/磁盘根目录/);
  } finally {
    if (!path.resolve(root).startsWith(parent + path.sep)) throw Error('Unsafe fixture cleanup');
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('installed profile uses configured Unicode path and preserves data on reuse', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'astrelis-data-test-'));
  try {
    const data = path.join(root, '中文 UserData');
    fs.mkdirSync(data);
    fs.writeFileSync(path.join(data, '.astrelis-owner'), 'com.auralis.player');
    fs.writeFileSync(path.join(root, 'astrelis-data.ini'), '\ufeff[UserData]\r\nPath=' + data + '\r\n', 'utf16le');
    const profile = installedDataPath(path.join(root, 'ASTRELIS.exe'));
    assert.equal(profile, path.join(data, 'Profile'));
    fs.writeFileSync(path.join(profile, 'settings.json'), 'preserve');
    installedDataPath(path.join(root, 'ASTRELIS.exe'));
    assert.equal(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'), 'preserve');
    fs.writeFileSync(path.join(data, '.astrelis-owner'), 'another-app');
    assert.throws(() => installedDataPath(path.join(root, 'ASTRELIS.exe')), /归属/);
    fs.unlinkSync(path.join(root, 'astrelis-data.ini'));
    assert.throws(() => installedDataPath(path.join(root, 'ASTRELIS.exe')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
