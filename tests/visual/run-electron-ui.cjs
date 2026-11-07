// Run with Node, not the user's application launcher. Everything uses an
// ephemeral Electron profile and an independently owned Vite process.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
async function availablePort() {
  for (let port = 41742; port < 41762; port++) {
    if (await new Promise(resolve => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    })) return port;
  }
  throw new Error('No free UI-test port');
}
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'astrelis-visual-test-'));
  let vite;
  try {
    const port = await availablePort();
    const origin = `http://127.0.0.1:${port}`;
    vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    let viteLog = '';
    for (const pipe of [vite.stdout, vite.stderr]) pipe.on('data', data => { viteLog += data; });
    const until = Date.now() + 30000;
    while (true) {
      try { const response = await fetch(origin); if (response.ok) break; } catch {}
      if (Date.now() > until || vite.exitCode !== null) throw new Error(`Vite failed: ${viteLog}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const env = { ...process.env, ASTRELIS_VISUAL_ORIGIN: origin, ASTRELIS_VISUAL_PROFILE: profile };
    delete env.ELECTRON_RUN_AS_NODE;
    const electron = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), [path.join(__dirname, process.argv[2] || 'electron-ui.cjs')], {
      cwd: root, env, windowsHide: true, stdio: 'inherit'
    });
    process.exitCode = await new Promise((resolve, reject) => {
      electron.once('error', reject);
      electron.once('exit', code => resolve(code ?? 1));
    });
  } finally {
    if (vite && vite.exitCode === null) {
      vite.kill();
      await new Promise(resolve => vite.once('exit', resolve));
    }
    const resolved = path.resolve(profile);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('astrelis-visual-test-'))
      throw new Error('Refusing to clean unexpected profile path');
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
