'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Report the mounted release, never the newest channel or a developer checkout.
function readClientCompatibility({ releaseRoot = process.env.APOLLO_RELEASE_ROOT,
  runtimeRoot = process.env.APOLLO_PROJECT_ROOT, dataRoot = process.env.APOLLO_DATA_ROOT } = {}) {
  const result = { protocolVersion: 1, data: { state: 'missing' } };
  if (!releaseRoot || !runtimeRoot) return result;
  try {
    const read = (root, name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
    const validId = value => {
      const body = Object.assign({}, value); delete body.id;
      return /^[a-f0-9]{64}$/.test(value.id || '') && value.id === crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    };
    const release = read(releaseRoot, 'manifest.json'), runtime = read(runtimeRoot, 'portable-runtime.json');
    const index = read(dataRoot || path.join(releaseRoot, 'contracts'), 'manifest.json');
    if (!validId(release) || !validId(runtime) || !validId(index)
      || release.schemaVersion !== 'apollo.proxy-data-release.v1' || index.schemaVersion !== 'apollo.data-index.v1'
      || runtime.schemaVersion !== 'apollo.proxy-portable-runtime.v1'
      || release.runtimeId !== runtime.id || release.dataId !== index.id
      || release.profileVersion !== runtime.profileVersion || release.profileVersion !== index.profileVersion
      || release.nativeSourceHash !== runtime.nativeSourceHash) throw Error('DATA_METADATA_MISMATCH');
    result.data = { state: 'ready', version: release.id, schemaVersion: release.schemaVersion,
      profileVersion: release.profileVersion, deliveryProfile: release.deliveryProfile || null,
      generatedAt: release.generatedAt };
  } catch {
    result.data = { state: 'invalid' };
  }
  return result;
}
module.exports = { readClientCompatibility };
