#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { projectPortableData } = require('./build-data-release');
const npmData = require('../src/data-packages/npm');
const releases = require('../src/data-release');

async function buildNpmDataPackage({ dataRoot, runtimeRoot, output, name, version, tarballUrl }) {
  output = path.resolve(output);
  npmData.validateReference({ name, version, tarballUrl, bytes: 1, dataId: '0'.repeat(64), integrity: 'sha512-' + Buffer.alloc(64).toString('base64') });
  await fs.mkdir(output, { recursive: false });
  const root = path.join(output, 'package');
  await fs.mkdir(root);
  const { index } = await projectPortableData({ dataRoot, runtimeRoot, output: path.join(root, 'data'), omitContractArchives: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name, version, description: 'Apollo portable contract data', license: 'UNLICENSED', files: ['data/'] }, null, 2) + '\n', { flag: 'wx' });
  const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], {
    cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024,
    env: { ...process.env, npm_config_cache: path.join(output, '.npm-cache') },
  }))[0];
  const tarballPath = path.join(output, packed.filename);
  const bytes = await fs.readFile(tarballPath);
  const npm = { name, version, tarballUrl, integrity: 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64'), bytes: bytes.length, dataId: index.id };
  if (packed.integrity !== npm.integrity) throw Error('npm pack integrity mismatch.');
  const runtime = releases.readRuntime(runtimeRoot);
  const descriptor = { schemaVersion: 'apollo.git-data-index.v2', runtimeId: runtime.id, npm };
  await npmData.readPackage(root, npm, runtimeRoot);
  await fs.writeFile(path.join(output, 'current.json'), JSON.stringify(descriptor, null, 2) + '\n', { flag: 'wx' });
  return { descriptor, tarballPath, packageRoot: root };
}
if (require.main === module) {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = { '--data': 'dataRoot', '--runtime': 'runtimeRoot', '--output': 'output', '--name': 'name', '--version': 'version', '--tarball-url': 'tarballUrl' }[process.argv[i]];
    if (!key || !process.argv[i + 1]) throw Error('Expected --data ROOT --runtime ROOT --output NEW_ROOT --name NAME --version EXACT --tarball-url HTTPS_URL');
    options[key] = process.argv[i + 1];
  }
  buildNpmDataPackage(options).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { buildNpmDataPackage };
