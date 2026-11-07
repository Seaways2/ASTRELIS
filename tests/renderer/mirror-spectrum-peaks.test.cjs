const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "src/visualizers/VisualizerCanvas.tsx"), "utf8");

test("Mirror Spectrum draws held peak blocks above and below the center line", () => {
  assert.match(source, /mirrorPeakHeight = \(peakBars\[i\] \?\? value\) \* height \* \.42/);
  assert.match(source, /upperPeakY = height \/ 2 - mirrorPeakHeight/);
  assert.match(source, /lowerPeakY = height \/ 2 \+ mirrorPeakHeight - mirrorPeakThickness/);
  assert.match(source, /fillRect\(x, upperPeakY, barWidth, mirrorPeakThickness\)/);
  assert.match(source, /fillRect\(x, lowerPeakY, barWidth, mirrorPeakThickness\)/);
});

test("Mirror Spectrum peak blocks use the same opacity as their matching bars", () => {
  const mirrorBlock = source.match(/if \(mode === "mirror"\) \{[\s\S]*?\} else \{/)?.[0] || "";
  assert.match(mirrorBlock, /context\.globalAlpha = barOpacity;[\s\S]*fillRect\(x, upperPeakY/);
  assert.match(mirrorBlock, /context\.globalAlpha = barOpacity \* \.55;[\s\S]*fillRect\(x, lowerPeakY/);
});
