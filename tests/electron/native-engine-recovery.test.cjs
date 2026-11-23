const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const Module = require("node:module");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

// Exercises electron/nativePlaybackEngine.ts against a scripted fake host: no
// real AuralisPluginHost, audio device or window is ever opened.
const root = path.resolve(__dirname, "../..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "auralis-version.json"), "utf8"));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "auralis-native-engine-"));
const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === "electron") return {
    app: { getAppPath: () => root, getVersion: () => manifest.appVersion, getPath: () => userData, isPackaged: false }
  };
  return originalLoad.call(this, request, ...rest);
};
const enginePath = require.resolve(path.join(root, "dist-electron/nativePlaybackEngine.js"));
const { writeNativeOutputState, nativeOutputStatePath } = require(path.join(root, "dist-electron/nativeOutputPersistence.js"));
test.after(() => {
  Module._load = originalLoad;
  fs.rmSync(userData, { recursive: true, force: true });
});

const flush = async (rounds = 60) => {
  for (let index = 0; index < rounds; index++) await new Promise(resolve => setImmediate(resolve));
};

class FakeHost extends EventEmitter {
  constructor(world) {
    super();
    this.world = world;
    this.pid = undefined; // never hand a real pid to taskkill
    this.exitCode = null;
    this.signalCode = null;
    this.killed = false;
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.commands = [];
    this.source = null;
    this.playing = false;
    this.position = 0;
    this.device = world.devices[0] || "";
    this.callbacks = 0;
    readline.createInterface({ input: this.stdin }).on("line", line => {
      const command = JSON.parse(line);
      this.commands.push(command);
      const reply = this.handle(command);
      if (command.type === "status" && this.holdStatus) return; // never answered
      setImmediate(() => {
        if (this.exitCode === null && this.signalCode === null)
          this.stdout.write(`${JSON.stringify({ ...reply, requestId: command.requestId })}\n`);
      });
    });
  }

  deviceActive() {
    return Boolean(this.device) && this.world.devices.includes(this.device);
  }

  handle(command) {
    switch (command.type) {
      case "status":
        return { ok: true, playing: this.playing, position: this.position, duration: this.source ? 200 : 0, playbackToken: this.source?.playbackToken || "" };
      case "load":
        this.source = { path: command.path, playbackToken: command.playbackToken };
        this.playing = false;
        this.position = 0;
        return { ok: true, playbackToken: command.playbackToken };
      case "play":
        this.playing = Boolean(this.source);
        return { ok: true };
      case "pause":
        this.playing = false;
        return { ok: true };
      case "seek":
        this.position = command.position;
        return { ok: true };
      case "device-status":
        if (this.deviceActive() && this.world.callbacksRunning) this.callbacks += 50;
        return this.deviceActive()
          ? { ok: true, state: "active", juceDeviceName: this.device, callbackCount: this.callbacks }
          : { ok: false, state: "no-device" };
      case "device-apply": {
        const name = command.candidate?.juceDeviceName;
        if (!this.world.devices.includes(name)) return { ok: false, committed: false, error: "OUTPUT_DEVICE_NOT_FOUND" };
        if (this.world.unopenable.includes(name)) {
          // The real host closes the playing device, fails the open and reopens it.
          this.world.audibleFailures++;
          return { ok: false, committed: false, error: "AUDIO_CALLBACK_HEALTH_TIMEOUT", recovery: "previous-route-restored" };
        }
        this.device = name;
        this.callbacks += 10;
        this.world.applied.push(name);
        return { ok: true, committed: true, lastKnownGood: command.candidate, actual: { juceDeviceName: name } };
      }
      case "device-enumerate":
        this.world.enumerations++;
        return { ok: true, devices: this.world.devices.map(name => ({ juceTypeName: "Windows Audio", juceDeviceName: name })) };
      default:
        return { ok: true };
    }
  }

  crash(code = 3221225477) {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.stdin.destroy();
    setImmediate(() => this.emit("exit", code, null));
  }

  kill() {
    this.killed = true;
    if (this.exitCode === null && this.signalCode === null) {
      this.signalCode = "SIGTERM";
      setImmediate(() => this.emit("exit", null, "SIGTERM"));
    }
    return true;
  }
}

function freshEngine({ devices = ["Speakers"], savedDevice } = {}) {
  delete require.cache[enginePath];
  const engine = require(enginePath);
  const world = { devices: [...devices], unopenable: [], audibleFailures: 0, enumerations: 0, callbacksRunning: true, applied: [], hosts: [], logs: [], now: 1000 };
  fs.rmSync(nativeOutputStatePath(userData), { force: true });
  if (savedDevice) {
    const candidate = { backend: "wasapi-shared", juceDeviceName: savedDevice, sampleRateMode: "system", bufferMode: "auto", exclusiveFallback: "shared-low-latency" };
    writeNativeOutputState(userData, { schemaVersion: 1, preferred: candidate, lastKnownGood: candidate, updatedAt: new Date(0).toISOString() });
  }
  engine.configureNativePlaybackEngine({
    writeLog: (level, message) => world.logs.push(`${level} ${message}`),
    getPcmDiagnostics: () => null,
    onEngineLost: () => undefined,
    spawnEngine: () => {
      const host = new FakeHost(world);
      world.hosts.push(host);
      return host;
    },
    now: () => world.now
  });
  return { engine, world };
}

async function shutdown(engine) {
  const current = engine.playbackEngineGate?.current();
  if (current) await engine.stopPlaybackEngine(current);
}

async function startPlayingTrack(engine) {
  await engine.sendPlaybackCommand({ type: "rack", plugins: [{ id: "crashy.vst3", path: "C:/crashy.vst3", enabled: true }], stateDirectory: "C:/state" });
  assert.equal((await engine.sendPlaybackCommand({ type: "load", path: "D:/music/song.flac", playbackToken: "t1:1" })).ok, true);
  await engine.sendPlaybackCommand({ type: "play" });
}

test("a crashed host is restored with the same source, position and play state instead of an empty host", async () => {
  const { engine, world } = freshEngine();
  await startPlayingTrack(engine);
  world.hosts[0].position = 42.5;
  const before = await engine.sendPlaybackCommand({ type: "status" });
  assert.equal(before.ok, true);
  assert.equal(before.playing, true);

  world.hosts[0].crash();
  await flush();
  assert.equal(world.hosts.length, 1, "the exit itself must not start a host");

  const status = await engine.sendPlaybackCommand({ type: "status" });
  assert.equal(world.hosts.length, 2);
  const replacement = world.hosts[1];
  assert.deepEqual(replacement.commands.map(command => command.type).filter(type => type !== "device-status"), ["rack", "load", "seek", "play", "status"]);
  assert.equal(replacement.commands[1].path, "D:/music/song.flac");
  assert.equal(replacement.commands[2].position, 42.5);
  assert.equal(status.ok, true);
  assert.equal(status.playing, true);
  assert.equal(status.playbackToken, "t1:1");
  assert.equal(status.engineLost, undefined);
  assert.ok(world.logs.some(line => /Native session restored after host loss/.test(line)));
  await shutdown(engine);
});

test("a host that dies again right after a restore is reported, not restarted in a loop", async () => {
  const { engine, world } = freshEngine();
  await startPlayingTrack(engine);
  world.hosts[0].crash();
  await flush();
  await engine.sendPlaybackCommand({ type: "status" });
  assert.equal(world.hosts.length, 2);

  world.now += 5000;
  world.hosts[1].crash();
  await flush();
  for (let poll = 0; poll < 5; poll++) {
    const status = await engine.sendPlaybackCommand({ type: "status" });
    assert.equal(status.ok, false);
    assert.equal(status.engineLost, true);
    assert.equal(status.playing, false);
    assert.equal(status.engineLossCount, 2);
    assert.deepEqual(status.suspectPlugins, ["crashy.vst3"]);
    assert.match(status.error, /NATIVE_ENGINE_LOST/);
  }
  assert.equal(world.hosts.length, 2, "status polls must not spawn empty hosts");
  const pause = await engine.sendPlaybackCommand({ type: "pause" });
  assert.equal(pause.ok, true);
  assert.equal((await engine.sendPlaybackCommand({ type: "play" })).ok, false);
  assert.equal(world.hosts.length, 2);

  // An explicit new source from the renderer is the way out.
  const loaded = await engine.sendPlaybackCommand({ type: "load", path: "D:/music/other.flac", playbackToken: "t2:2" });
  assert.equal(loaded.ok, true);
  assert.equal(world.hosts.length, 3);
  const status = await engine.sendPlaybackCommand({ type: "status" });
  assert.equal(status.ok, true);
  assert.equal(status.playbackToken, "t2:2");
  await shutdown(engine);
});

test("a rack changed and a pause made while the host is lost are what the restore uses", async () => {
  const { engine, world } = freshEngine();
  await startPlayingTrack(engine);
  world.hosts[0].position = 10;
  await engine.sendPlaybackCommand({ type: "status" });
  world.hosts[0].crash();
  await flush();
  assert.equal((await engine.sendPlaybackCommand({ type: "pause" })).ok, true);
  assert.equal(world.hosts.length, 1, "a pause must not start a host");
  await engine.sendPlaybackCommand({ type: "rack", plugins: [], stateDirectory: "C:/state" });
  const status = await engine.sendPlaybackCommand({ type: "status" });
  assert.equal(status.ok, true);
  assert.equal(status.playing, false);
  const replacement = world.hosts[1];
  const racks = replacement.commands.filter(command => command.type === "rack");
  assert.ok(racks.length >= 1);
  assert.ok(racks.every(command => command.plugins.length === 0));
  assert.equal(replacement.commands.some(command => command.type === "play"), false);
  assert.equal(replacement.source.path, "D:/music/song.flac");
  await shutdown(engine);
});

test("a host lost without a restorable file source reports the loss and stays down", async () => {
  const { engine, world } = freshEngine();
  await engine.sendPlaybackCommand({ type: "pcm-start", onlinePcmTransport: "pipe" });
  world.hosts[0].crash();
  await flush();
  const status = await engine.sendPlaybackCommand({ type: "status" });
  assert.equal(status.ok, false);
  assert.equal(status.engineLost, true);
  assert.equal(world.hosts.length, 1);
});

test("an intentional stop is not reported as a crash", async () => {
  const { engine, world } = freshEngine();
  await startPlayingTrack(engine);
  await engine.stopPlaybackEngine(world.hosts[0]);
  await flush();
  assert.equal(engine.nativeEngineHealthSnapshot().engineLost, false);
  const status = await engine.sendPlaybackCommand({ type: "status" });
  assert.equal(status.ok, true);
  assert.equal(status.engineLost, undefined);
  await shutdown(engine);
});

test("a TV that was off at start is re-attached when it appears, with degraded status meanwhile", async () => {
  const { engine, world } = freshEngine({ devices: ["Speakers"], savedDevice: "TV" });
  await startPlayingTrack(engine);
  const host = world.hosts[0];
  assert.equal(host.commands[0].type, "device-apply", "the saved route is restored before the first command");
  assert.equal(host.device, "Speakers");

  await engine.sendPlaybackCommand({ type: "status" });
  await flush();
  let status = await engine.sendPlaybackCommand({ type: "status" });
  assert.equal(status.ok, true);
  assert.equal(status.outputDegraded, true);
  assert.equal(status.outputState, "fallback-device");
  assert.equal(status.outputDevice, "Speakers");
  assert.equal(status.expectedOutputDevice, "TV");

  world.devices.push("TV");
  world.now += 4000;
  await engine.sendPlaybackCommand({ type: "status" });
  await flush();
  assert.equal(host.device, "TV");
  status = await engine.sendPlaybackCommand({ type: "status" });
  assert.equal(status.ok, true);
  assert.equal(status.outputDegraded, undefined);
  assert.ok(world.logs.some(line => /Native output re-attached/.test(line)));
  await shutdown(engine);
});

test("a vanished output device is reported as lost and re-opened when it returns", async () => {
  const { engine, world } = freshEngine({ devices: ["TV"], savedDevice: "TV" });
  await startPlayingTrack(engine);
  const host = world.hosts[0];
  await engine.sendPlaybackCommand({ type: "status" });
  await flush();

  world.devices = [];
  world.now += 3000;
  await engine.sendPlaybackCommand({ type: "status" });
  await flush();
  let status = await engine.sendPlaybackCommand({ type: "status" });
  // Reported beside ok:true: a failed status makes the renderer drop the
  // Native backend, which would outlive the device coming back.
  assert.equal(status.ok, true);
  assert.equal(status.outputDegraded, true);
  assert.equal(status.outputError, "NATIVE_OUTPUT_DEVICE_LOST");
  assert.equal(status.outputState, "no-device");

  world.devices = ["TV"];
  host.device = "";
  world.now += 4000;
  await engine.sendPlaybackCommand({ type: "status" });
  await flush();
  status = await engine.sendPlaybackCommand({ type: "status" });
  assert.equal(host.device, "TV");
  assert.equal(status.ok, true);
  assert.equal(status.outputDegraded, undefined);
  await shutdown(engine);
});

test("an open device whose callbacks stop is reported as stalled and re-applied", async () => {
  const { engine, world } = freshEngine({ devices: ["TV"], savedDevice: "TV" });
  await startPlayingTrack(engine);
  await engine.sendPlaybackCommand({ type: "status" });
  await flush();
  world.callbacksRunning = false;
  const appliedBefore = world.applied.length;
  world.now += 3000;
  await engine.sendPlaybackCommand({ type: "status" });
  await flush();
  assert.equal(world.applied.length, appliedBefore, "one frozen sample is not yet a stall");
  world.now += 3000;
  await engine.sendPlaybackCommand({ type: "status" });
  await flush();
  assert.equal(world.applied.length, appliedBefore + 1);
  assert.ok(world.logs.some(line => /ok -> stalled/.test(line)));
  await shutdown(engine);
});

test("the health check never overrides an output change the user makes at the same time", async () => {
  const { engine, world } = freshEngine({ devices: ["Speakers", "TV"], savedDevice: "TV" });
  await startPlayingTrack(engine);
  const host = world.hosts[0];
  await engine.sendPlaybackCommand({ type: "status" });
  await flush();
  assert.equal(host.device, "TV");
  const tvApplies = () => host.commands.filter(command => command.type === "device-apply" && command.candidate.juceDeviceName === "TV").length;
  const tvBefore = tvApplies();

  // The status reply starts a check while the user's apply is still queued in
  // the host; main persists the new route once that apply commits.
  world.now += 3000;
  const status = engine.sendPlaybackCommand({ type: "status" });
  const userApply = engine.sendPlaybackCommand({ type: "device-apply", generation: 7, candidate: { backend: "wasapi-shared", juceDeviceName: "Speakers" } })
    .then(response => {
      writeNativeOutputState(userData, { schemaVersion: 1, lastKnownGood: response.lastKnownGood, updatedAt: new Date(1).toISOString() });
      return response;
    });
  await Promise.all([status, userApply]);
  await flush();
  for (let round = 0; round < 3; round++) {
    world.now += 4000;
    await engine.sendPlaybackCommand({ type: "status" });
    await flush();
  }
  assert.equal(host.device, "Speakers");
  assert.equal(tvApplies(), tvBefore);
  const status2 = await engine.sendPlaybackCommand({ type: "status" });
  assert.equal(status2.outputDegraded, undefined);
  await shutdown(engine);
});

test("a plugin that crashes the host every 70 seconds is restored once, then reported", async () => {
  const { engine, world } = freshEngine();
  await startPlayingTrack(engine);
  world.hosts[0].crash();
  await flush();
  assert.equal((await engine.sendPlaybackCommand({ type: "status" })).ok, true);
  assert.equal(world.hosts.length, 2);

  // Outside the 60 s consecutive-loss window, but the same plugin set.
  world.now += 70000;
  world.hosts[1].crash();
  await flush();
  const status = await engine.sendPlaybackCommand({ type: "status" });
  assert.equal(status.ok, false);
  assert.equal(status.engineLost, true);
  assert.equal(status.playing, false);
  assert.deepEqual(status.suspectPlugins, ["crashy.vst3"]);
  assert.equal(world.hosts.length, 2, "the crashing rack must not be reloaded again");
  assert.ok(world.logs.some(line => /rackLosses=2/.test(line)));
});

test("a host crash after the rack window has passed is restored again", async () => {
  const { engine, world } = freshEngine();
  await startPlayingTrack(engine);
  world.hosts[0].crash();
  await flush();
  await engine.sendPlaybackCommand({ type: "status" });
  world.now += 11 * 60000;
  world.hosts[1].crash();
  await flush();
  const status = await engine.sendPlaybackCommand({ type: "status" });
  assert.equal(status.ok, true);
  assert.equal(world.hosts.length, 3);
  await shutdown(engine);
});

test("a status that is in flight when the host dies triggers the restore instead of failing", async () => {
  const { engine, world } = freshEngine();
  await startPlayingTrack(engine);
  world.hosts[0].position = 30;
  await engine.sendPlaybackCommand({ type: "status" });
  await flush();
  world.hosts[0].holdStatus = true;
  const pending = engine.sendPlaybackCommand({ type: "status" });
  await flush();
  world.hosts[0].crash();
  const status = await pending;
  assert.equal(world.hosts.length, 2);
  assert.equal(status.ok, true);
  assert.equal(status.playing, true);
  assert.equal(status.playbackToken, "t1:1");
  assert.equal(world.hosts[1].commands.find(command => command.type === "seek").position, 30);
  await shutdown(engine);
});

test("a saved device that is listed but cannot be opened is retried at most three times until the device list changes", async () => {
  const { engine, world } = freshEngine({ devices: ["Speakers", "TV"], savedDevice: "TV" });
  world.unopenable.push("TV");
  await startPlayingTrack(engine);
  const host = world.hosts[0];
  assert.equal(host.device, "Speakers");
  const failuresAtStart = world.audibleFailures;

  for (let round = 0; round < 8; round++) {
    world.now += 61000;
    await engine.sendPlaybackCommand({ type: "status" });
    await flush();
  }
  assert.equal(world.audibleFailures - failuresAtStart, 3, "each failed apply is a dropout on the playing device");
  assert.equal(host.device, "Speakers");
  assert.ok(world.enumerations >= 2, "while parked the device list is compared instead");
  assert.ok(world.logs.some(line => /retrying when the device list changes/.test(line)));
  const status = await engine.sendPlaybackCommand({ type: "status" });
  assert.equal(status.ok, true);
  assert.equal(status.outputState, "fallback-device");

  // The TV comes back as a new endpoint: the list changes and it is tried again.
  world.unopenable = [];
  world.devices.push("TV (2)");
  world.now += 61000;
  await engine.sendPlaybackCommand({ type: "status" });
  await flush();
  assert.equal(host.device, "TV");
  assert.equal(world.audibleFailures - failuresAtStart, 3);
  await shutdown(engine);
});
