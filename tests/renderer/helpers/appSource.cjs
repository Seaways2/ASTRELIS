// App.tsx was split into src/app/*; source-text tests read the shell and its
// extracted modules together so their assertions keep covering the same code.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const modules = [
  "src/App.tsx",
  "src/app/appShell.ts",
  "src/app/WithDisplayTime.tsx",
  "src/app/useImmersiveMode.ts",
  "src/app/useVolumeRouting.ts",
  "src/app/useWindowPresence.ts"
];

function readAppSource() {
  return modules.map(file => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
}

module.exports = { readAppSource, appModules: modules };
