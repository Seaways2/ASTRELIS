const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const origin = process.env.ASTRELIS_VISUAL_ORIGIN;
const profile = process.env.ASTRELIS_VISUAL_PROFILE;
if (!origin || !profile) throw new Error('Use run-electron-ui.cjs so the user profile remains isolated');
app.setPath('userData', profile);
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'review/2.8.2-visual');
const results = { origin, isolatedProfile: true, audio: 'muted; synthetic analysis; actual playback is mocked', checks: [], screenshots: [], rendererErrors: [], externalRequestsBlocked: [] };
let win;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(fn, ...args) {
  return win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
}
async function waitFor(fn, label, timeout = 10000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await evaluate(fn)) return; await pause(50); }
  throw new Error(`Timed out: ${label}`);
}
async function screenshot(name) {
  await pause(120);
  const image = await win.webContents.capturePage();
  assert.ok(!image.isEmpty(), 'Empty Electron capture');
  const target = path.join(output, `${name}.png`);
  await fs.writeFile(target, image.toPNG());
  results.screenshots.push(target);
}
async function check(name, work) {
  const detail = await work();
  results.checks.push({ name, passed: true, detail });
  console.log(`PASS ${name}`);
}
async function goPage(page, selector) {
  await evaluate(value => window.__ui.store.getState().setActivePage(value), page);
  const until = Date.now() + 8000;
  while (Date.now() < until) {
    if (await evaluate(sel => !!document.querySelector(sel), selector)) { await pause(400); return; }
    await pause(50);
  }
  throw new Error(`Page ${page} missing ${selector}`);
}
async function closePopover() {
  await evaluate(() => { document.querySelector('.channel-strip-popover > header button')?.click(); });
  await pause(70);
}
async function material(selector) {
  return evaluate(sel => {
    const node = document.querySelector(sel);
    if (!node) throw new Error(`Missing surface ${sel}`);
    const s = getComputedStyle(node);
    return Object.fromEntries(['backgroundColor', 'backgroundImage', 'borderTopColor', 'borderTopWidth', 'borderTopStyle', 'boxShadow', 'backdropFilter'].map(key => [key, s[key]]));
  }, selector);
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  await app.whenReady();
  win = new BrowserWindow({ width: 1280, height: 720, useContentSize: true, frame: false, show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false, nodeIntegration: false, contextIsolation: true }
  });
  win.webContents.setAudioMuted(true);
  win.webContents.setFrameRate(30);
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const parsed = new URL(details.url);
    const allowed = ['data:', 'blob:', 'devtools:'].includes(parsed.protocol)
      || (['http:', 'ws:'].includes(parsed.protocol) && parsed.hostname === '127.0.0.1' && parsed.port === new URL(origin).port);
    if (!allowed) results.externalRequestsBlocked.push(details.url);
    callback({ cancel: !allowed });
  });
  win.webContents.on('console-message', (_event, level, message, line, source) => {
    if (level >= 3 && !/ERR_BLOCKED_BY_CLIENT|Electron Security Warning/.test(message)) results.rendererErrors.push({ message, line, source });
  });
  await win.loadURL(origin);
  await waitFor(() => !!document.querySelector('.app-shell'), 'App mount');
  await evaluate(async () => {
    const { usePlayerStore: store } = await import('/src/stores/playerStore.ts');
    const { useAtmosphereStore: atmosphere } = await import('/src/stores/atmosphereStore.ts');
    const { audioEngine: engine } = await import('/src/audio/AudioEngine.ts');
    const { useI18n } = await import('/src/i18n/index.ts');
    const meter = { left: .32, right: .4, peak: .52, rms: .22, low: .44, mid: .3, high: .2, sampleRate: 48000 };
    engine.play = async () => {};
    engine.pause = async () => {};
    engine.stop = () => {};
    engine.load = () => {};
    engine.seek = () => {};
    engine.meters = () => meter;
    engine.getFrequencyData = () => Uint8Array.from({ length: 256 }, (_, i) => Math.round(150 * Math.exp(-i / 110) + 24 * Math.sin(i * .19)));
    engine.getWaveformData = () => Uint8Array.from({ length: 256 }, (_, i) => 128 + Math.round(65 * Math.sin(i * .1)));
    // One short real PCM WAV, generated in the isolated renderer for waveform preview.
    const bytes = new Uint8Array(44 + 960 * 2); const view = new DataView(bytes.buffer);
    const text = (offset, value) => [...value].forEach((ch, i) => { bytes[offset + i] = ch.charCodeAt(0); });
    text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 48000, true); view.setUint32(28, 96000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, bytes.length - 44, true);
    for (let i = 0; i < 960; i++) view.setInt16(44 + i * 2, Math.round(12000 * Math.sin(i * .12)), true);
    const url = 'data:audio/wav;base64,' + btoa(String.fromCharCode(...bytes));
    const coverUrl = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#402778"/><stop offset="1" stop-color="#147185"/></linearGradient></defs><rect width="256" height="256" fill="url(#g)"/><circle cx="128" cy="128" r="88" fill="none" stroke="#a8dcf3" stroke-width="2"/></svg>');
    const makeTracks = count => Array.from({ length: count }, (_, i) => ({ id: `ui-${i}`, name: `UI TEST ${String(i + 1).padStart(5, '0')}`, artist: 'Synthetic audio', album: 'Isolated visual regression', format: 'WAV', size: bytes.length, duration: 180, url, coverUrl }));
    window.__ui = { store, atmosphere, engine, makeTracks };
    store.setState(state => ({ tracks: makeTracks(3), currentIndex: 0, currentTime: 42, duration: 180, playing: false,
      accent: '#8f75ff', visualizer: 'spectrum', fadeMs: 0,
      uiSettings: { ...state.uiSettings, colorMode: 'dark', gpuAccelerationEnabled: false, nativeOutputEnabled: false, visualTransition: 'fade' }
    }));
    atmosphere.getState().update({ coverColors: false, glassEdges: true, intensity: .3, trackTransition: false });
  });
  await pause(700);
  results.environment = await evaluate(() => ({ width: innerWidth, height: innerHeight, visibility: document.visibilityState, dpr: devicePixelRatio, shell: document.querySelector('.app-shell').className, fxMotion: document.querySelector('.app-shell').dataset.fxMotion }));
  assert.equal(results.environment.visibility, 'visible', 'Hidden/offscreen test must retain visible-page animation semantics');

  for (const theme of ['dark', 'light']) for (const mode of ['on', 'off', 'low']) {
    await evaluate((theme, mode) => {
      const { store, atmosphere } = window.__ui;
      store.setState(state => ({ uiSettings: { ...state.uiSettings, colorMode: theme, lowPerformanceMode: mode === 'low' } }));
      atmosphere.getState().update({ glassEdges: mode !== 'off', intensity: mode === 'off' ? 0 : .3 });
    }, theme, mode);
    await pause(200);
    for (const [page, selector] of [['appearance', '.appearance-section.panel'], ['settings', '.settings-section.panel'], ['playlist', '.playlist-table'], ['nowPlaying', '.cd-deck.panel']]) {
      await goPage(page, selector);
      await evaluate(() => document.querySelector('.volume-popover-trigger').click());
      await waitFor(() => !!document.querySelector('.channel-strip-popover'), 'ChannelStrip open');
      await pause(120);
      await check(`material:${theme}:${mode}:${page}`, async () => {
        const surface = await material(selector), popup = await material('.channel-strip-popover');
        assert.deepEqual(popup, surface, `${page} and ChannelStrip have different computed material`);
        assert.equal(await evaluate(() => document.querySelector('.channel-strip-popover').parentElement.matches('.app-shell')), true, 'Portal left app-shell');
        if (mode === 'low') assert.ok(!/blur\((?!0px)/.test(popup.backdropFilter), 'Low performance retained blur');
        return { surface, popup };
      });
      if (mode === 'on' && ((theme === 'dark' && page === 'appearance') || (theme === 'light' && page === 'settings'))) await screenshot(`${theme}-${page}-popover`);
      await closePopover();
    }
  }
  await check('pointer-follow:on-off-low', async () => {
    const samples = [];
    for (const mode of ['on', 'off', 'low']) {
      await evaluate(mode => {
        const { store, atmosphere } = window.__ui;
        store.setState(state => ({ uiSettings: { ...state.uiSettings, colorMode: 'dark', lowPerformanceMode: mode === 'low' } }));
        atmosphere.getState().update({ glassEdges: mode !== 'off', intensity: .3 });
      }, mode);
      await pause(180);
      const pair = [];
      for (const [x, y] of [[250, 210], [930, 440]]) {
        win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
        await pause(150);
        // The pointer light is set per surface, in that surface's own pixels.
        pair.push(await evaluate(() => { const shell = document.querySelector('.app-shell'), style = getComputedStyle(shell.querySelector('.meters .panel') || shell); return { x: style.getPropertyValue('--fx-light-x'), y: style.getPropertyValue('--fx-light-y'), edges: shell.dataset.fxEdges, motion: shell.dataset.fxMotion }; }));
      }
      if (mode === 'on') { assert.notEqual(pair[0].x, pair[1].x); assert.notEqual(pair[0].y, pair[1].y); }
      else assert.deepEqual(pair[0], pair[1], `Pointer kept animating in ${mode} mode`);
      samples.push({ mode, pair });
    }
    return samples;
  });

  await evaluate(() => {
    const { store, atmosphere } = window.__ui;
    store.setState(state => ({ uiSettings: { ...state.uiSettings, colorMode: 'dark', lowPerformanceMode: false } }));
    atmosphere.getState().update({ glassEdges: true, intensity: .3, orbitParticles: true });
  });
  await goPage('nowPlaying', '.cd-deck');
  for (const [width, height] of [[1120, 650], [1280, 720], [1920, 1080]]) {
    win.setContentSize(width, height);
    await pause(400);
    for (const playing of [true, false]) {
      await evaluate(value => window.__ui.store.getState().setPlaying(value), playing);
      await pause(750);
      await check(`cd:${width}x${height}:${playing ? 'playing' : 'paused'}`, async () => {
        const geometry = await evaluate(() => {
          const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
          const stage = document.querySelector('.cd-stage');
          const scene = document.querySelector('.cd-scene');
          const parts = [...document.querySelectorAll('.cd-scene .cd-disc, .cd-scene .cd-radar, .cd-scene .laser-arm, .cd-scene .laser-arm i')].map(node => {
            const r = rect(node);
            // The rotating CD/radar is circular. Axis-aligned bounds of its
            // transparent square corners are not the visible circle bounds.
            if (node.matches('.cd-disc, .cd-radar')) { const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2, radius = node.offsetWidth / 2; return { name: node.className, left: cx - radius, right: cx + radius, top: cy - radius, bottom: cy + radius }; }
            return { name: node.className || `${node.parentElement.className} child`, ...r };
          });
          return { viewport: { width: innerWidth, height: innerHeight }, stage: rect(stage), scene: rect(scene), parts };
        });
        assert.deepEqual(geometry.viewport, { width, height });
        for (const part of geometry.parts) {
          assert.ok(part.left >= geometry.stage.left - 1 && part.right <= geometry.stage.right + 1 && part.top >= geometry.stage.top - 1 && part.bottom <= geometry.stage.bottom + 1, `${part.name} is clipped at ${width}x${height}: ${JSON.stringify(geometry)}`);
        }
        assert.ok(geometry.stage.width > 0 && geometry.stage.height > 0);
        return geometry;
      });
      if (playing) await screenshot(`cd-${width}x${height}`);
    }
  }

  win.setContentSize(1280, 720);
  await evaluate(() => { const { store, makeTracks } = window.__ui; store.getState().setPlaying(false); store.setState({ tracks: makeTracks(10000), currentIndex: 0, currentTime: 0 }); });
  await goPage('playlist', '.playlist-table');
  await check('playlist:10000-start-bounded', async () => { const count = await evaluate(() => document.querySelectorAll('.playlist-table .table-row').length); assert.ok(count > 0 && count < 40); return { rowCount: count }; });
  await evaluate(() => { const scroller = document.querySelector('.page-content'); scroller.scrollTop = scroller.scrollHeight; });
  await waitFor(() => [...document.querySelectorAll('.playlist-table .table-row b')].some(node => node.textContent === 'UI TEST 10000'), 'Playlist tail');
  await check('playlist:tail-delete-doubleclick', async () => {
    const before = await evaluate(() => ({ rows: document.querySelectorAll('.playlist-table .table-row').length, tail: [...document.querySelectorAll('.playlist-table .table-row b')].at(-1).textContent }));
    assert.ok(before.rows < 40); assert.equal(before.tail, 'UI TEST 10000');
    await screenshot('playlist-10000-tail');
    await evaluate(() => { const row = [...document.querySelectorAll('.playlist-table .table-row')].at(-1); row.querySelector('.playlist-row-actions button:last-child').click(); });
    await waitFor(() => [...document.querySelectorAll('.playlist-table .table-row b')].at(-1)?.textContent === 'UI TEST 09999', 'Playlist tail after delete');
    await evaluate(() => { const row = [...document.querySelectorAll('.playlist-table .table-row')].at(-1); row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    await waitFor(() => window.__ui.store.getState().currentIndex === 9998, 'Playlist doubleclick index');
    return { before, after: await evaluate(() => { const s = window.__ui.store.getState(); return { rows: document.querySelectorAll('.playlist-table .table-row').length, count: s.tracks.length, currentIndex: s.currentIndex, currentId: s.tracks[s.currentIndex].id, playing: s.playing }; }) };
  });
  await evaluate(() => { const { store, makeTracks } = window.__ui; store.getState().setPlaying(false); store.setState({ tracks: makeTracks(10000), currentIndex: 0 }); document.querySelector('.queue-button').click(); });
  await waitFor(() => !!document.querySelector('.queue-list'), 'Queue drawer');
  await check('queue:10000-start-bounded', async () => { const count = await evaluate(() => document.querySelectorAll('.queue-row').length); assert.ok(count > 0 && count < 40); return { rowCount: count }; });
  await evaluate(() => { const scroller = document.querySelector('.queue-list'); scroller.scrollTop = scroller.scrollHeight; });
  await waitFor(() => [...document.querySelectorAll('.queue-row b')].at(-1)?.textContent === 'UI TEST 10000', 'Queue tail');
  await check('queue:tail-delete-doubleclick', async () => {
    await screenshot('queue-10000-tail');
    await evaluate(() => [...document.querySelectorAll('.queue-row')].at(-1).querySelector('button').click());
    await waitFor(() => [...document.querySelectorAll('.queue-row b')].at(-1)?.textContent === 'UI TEST 09999', 'Queue tail after delete');
    await evaluate(() => [...document.querySelectorAll('.queue-row')].at(-1).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    await waitFor(() => window.__ui.store.getState().currentIndex === 9998, 'Queue doubleclick index');
    const result = await evaluate(() => { const s = window.__ui.store.getState(); return { rows: document.querySelectorAll('.queue-row').length, count: s.tracks.length, currentIndex: s.currentIndex, currentId: s.tracks[s.currentIndex].id, playing: s.playing }; });
    assert.ok(result.rows < 40); assert.equal(result.currentId, 'ui-9998'); assert.equal(result.playing, true); return result;
  });
  results.passed = true;
}
main().catch(async error => {
  results.passed = false; results.failure = error.stack || String(error);
  console.error(results.failure);
  if (win && !win.isDestroyed()) { try { await screenshot('failure'); } catch {} }
}).finally(async () => {
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  if (win && !win.isDestroyed()) win.destroy();
  app.exit(results.passed ? 0 : 1);
});
