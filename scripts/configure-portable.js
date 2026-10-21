#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readSettings, stateRoot, validateSettings } = require('../src/portable-runtime');
const settings = readSettings();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = { '--data-url': 'dataDescriptorUrl', '--figma-file': 'figmaFileKey', '--frontend-toolchain': 'frontendToolchainHome', '--chrome': 'chromeExecutable' }[process.argv[i]];
  if (!key || !process.argv[i + 1]) throw Error('Use --data-url HTTPS_URL, --figma-file FILE_KEY, --frontend-toolchain ROOT or --chrome EXECUTABLE');
  settings[key] = process.argv[i + 1];
}
validateSettings(settings);
const root = stateRoot(), file = path.join(root, 'portable-settings.json');
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(file + '.tmp', JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
fs.renameSync(file + '.tmp', file);
console.log('Saved connection settings: ' + file + '. Restart the app to use a different target/toolchain.');
