const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({ appOutDir }) => {
  const files = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else files.push(path.relative(appOutDir, file));
    }
  }
  visit(appOutDir);
  files.push('resources\\installed-files.json', 'resources\\elevate.exe');
  fs.writeFileSync(path.join(appOutDir, 'resources', 'installed-files.json'), JSON.stringify(files));
};
