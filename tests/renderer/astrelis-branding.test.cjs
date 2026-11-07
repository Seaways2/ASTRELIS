const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("the titlebar uses the approved combined theme-colored ASTRELIS lockup", () => {
  const app = read("src/App.tsx");
  const styles = read("src/styles/global.css");
  assert.doesNotMatch(app, /function AstrelisEmblem\(\)/);
  assert.doesNotMatch(app, /function AstrelisWordmark\(\)/);
  assert.match(app, /className="brand-lockup" role="img" aria-label="ASTRELIS"/);
  assert.doesNotMatch(styles, /brand-localized/);
  assert.doesNotMatch(app, /アストレリス|星 律|brand-ornament|astrelis-icon\.png/);
  assert.match(styles, /astrelis-lockup-mask\.png/);
  assert.match(styles, /\.brand-lockup\s*\{[^}]*color:\s*var\(--accent\)/s);
  assert.match(styles, /\.brand-lockup\s*\{[^}]*background:\s*currentColor/s);
  assert.match(styles, /\.brand-lockup\s*\{[^}]*filter:[^}]*var\(--glow-strength\)/s);
  assert.match(styles, /\.titlebar \.now-status\s*\{\s*border-left:\s*0;/);
});

test("product-facing metadata is renamed while legacy identity keys remain compatible", () => {
  const appPackage = JSON.parse(read("package.json"));
  const html = read("index.html");
  const main = read("electron/main.ts");
  const store = read("src/stores/playerStore.ts");
  assert.equal(appPackage.name, "astrelis");
  assert.equal(appPackage.productName, "ASTRELIS");
  assert.equal(appPackage.build.productName, "ASTRELIS");
  assert.equal(appPackage.build.nsis.shortcutName, "ASTRELIS");
  assert.match(html, /ASTRELIS \/ アストレリス \/ 星律/);
  assert.match(main, /tray\.setToolTip\(displayName\(\)\)/);
  assert.doesNotMatch(main, /setToolTip\("Auralis/);
  assert.equal(appPackage.build.appId, "com.auralis.player", "the app identity must stay stable for upgrades");
  assert.match(store, /localStorage\.getItem\("auralis\.ui\.settings"\)/,
    "the established profile must remain readable after the rename");
});

test("current user-facing renderer copy no longer names the old product", () => {
  for (const relative of ["src/App.tsx", "src/i18n/index.ts", "src/components/OnlineBrowser.tsx", "src/components/VstRack.tsx", "index.html"]) {
    assert.doesNotMatch(read(relative), /\bAuralis\b|AURALIS-COMPATIBLE/, relative);
  }
});

test("a fresh profile starts with the Monochrome accent without replacing saved preferences", () => {
  const store = read("src/stores/playerStore.ts");
  assert.match(store, /accent:\s*localStorage\.getItem\("auralis\.accent"\)\s*\|\|\s*"#d7dde2"/);
});
