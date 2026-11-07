const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const profile = fs.mkdtempSync(path.join(root, 'release-work/window-geometry-'));
const env = { ...process.env, ASTRELIS_WINDOW_TEST_PROFILE: profile };
delete env.ELECTRON_RUN_AS_NODE;
(async () => {
  for (const args of [[], ['--restore']]) {
    const child = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'),
      [path.join(__dirname, 'window-geometry-main.cjs'), ...args], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    if (code !== 0) throw new Error(`Window integration exited ${code}`);
  }
  console.log('PASS: window integration and restart. Isolated test profile:', profile);
})().catch(error => { console.error(error); process.exitCode = 1; });
