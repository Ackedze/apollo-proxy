'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const knowledge = require('../knowledge-package');
const { fail } = require('./artifacts');

const { MAX_ARCHIVE_BYTES, MAX_RELEASE_BYTES } = require('../data-release');
function validateReference(pin) {
  let url;
  try { url = new URL(pin?.tarballUrl); } catch { fail('NPM_DATA_REFERENCE_INVALID'); }
  if (!pin || Object.keys(pin).sort().join(',') !== 'bytes,dataId,integrity,name,tarballUrl,version' ||
      !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(pin.name || '') ||
      !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(pin.version || '') ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(pin.integrity || '') ||
      !/^[a-f0-9]{64}$/.test(pin.dataId || '') || !Number.isSafeInteger(pin.bytes) || pin.bytes < 1 || pin.bytes > MAX_ARCHIVE_BYTES ||
      url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('.tgz')) fail('NPM_DATA_REFERENCE_INVALID');
  return pin;
}

async function download(pin, destination, request = fetch) {
  validateReference(pin);
  // Repository tokens are never forwarded to a separate npm asset origin.
  const response = await request(pin.tarballUrl, { headers: { Accept: 'application/octet-stream' }, redirect: 'error', signal: AbortSignal.timeout(60000) });
  if (!response.ok) fail('NPM_DATA_HTTP_' + response.status);
  const hash = crypto.createHash('sha512');
  const handle = await fs.open(destination, 'wx', 0o600);
  let size = 0;
  try {
    for await (const part of response.body) {
      size += part.length;
      if (size > pin.bytes) fail('NPM_DATA_SIZE_INVALID');
      hash.update(part); await handle.writeFile(part);
    }
    if (size !== pin.bytes || 'sha512-' + hash.digest('base64') !== pin.integrity) fail('NPM_DATA_INTEGRITY_INVALID');
  } finally { await handle.close(); }
}

async function readPackage(root, pin, runtimeRoot) {
  validateReference(pin);
  const file = path.join(root, 'package.json');
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) fail('NPM_DATA_PACKAGE_INVALID');
  const pkg = JSON.parse(await fs.readFile(file, 'utf8'));
  if (pkg.name !== pin.name || pkg.version !== pin.version ||
      ['scripts', 'dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies', 'bin'].some(key => pkg[key] !== undefined)) fail('NPM_DATA_PACKAGE_INVALID');
  const data = require('./generation').readGenerationData({ root: path.join(root, 'data'), apolloRoot: runtimeRoot });
  if (data.index.id !== pin.dataId || data.index.deliveryProfile !== 'checking-ask-figma-mcp') fail('NPM_DATA_IDENTITY_INVALID');
  const allowed = new Set(['package.json', 'data/manifest.json', ...Array.from(data.reader.pins.keys(), file => path.relative(root, file))]);
  const files = await knowledge.listPackageFiles(root);
  if (files.length !== allowed.size || files.some(file => !allowed.has(file))) fail('NPM_DATA_EXTRA_FILE');
  if (files.length > 20000) fail('NPM_DATA_EXTRA_FILE');
  let total = 0;
  for (const file of files) {
    const { size } = await fs.stat(path.join(root, file));
    total += size;
    if (size > 128 * 1024 * 1024 || total > MAX_RELEASE_BYTES) fail('NPM_DATA_TOO_LARGE');
  }
  data.assertCurrent();
  return data;
}
module.exports = { MAX_ARCHIVE_BYTES, validateReference, download, readPackage };
