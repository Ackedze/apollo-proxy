'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { importDataPackage } = require('../src/data-packages/import');
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
async function main() {
  const args = process.argv.slice(2),
    options = { packages: [], figma: [] };
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    if (!value)
      fail(
        'Usage: --root DIR --apollo-root DIR --package ZIP --figma JSON [--seed JSON]'
      );
    const key = {
      '--root': 'root',
      '--apollo-root': 'apolloRoot',
      '--package': 'packages',
      '--figma': 'figma',
      '--seed': 'seed',
      '--frontend': 'frontend',
    }[args[i]];
    if (!key) fail('DATA_IMPORT_ARGUMENT');
    if (Array.isArray(options[key])) options[key].push(path.resolve(value));
    else
      options[key] = ['seed', 'frontend'].includes(key)
        ? JSON.parse(fs.readFileSync(value))
        : path.resolve(value);
  }
  if (!options.root || !options.apolloRoot) fail('DATA_IMPORT_ARGUMENT');
  console.log(JSON.stringify(await importDataPackage(options), null, 2));
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.code || e.message);
    process.exitCode = 1;
  });
module.exports = { importDataPackage };
