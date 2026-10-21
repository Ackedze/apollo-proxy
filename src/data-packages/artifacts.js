'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const fail = (code) => {
  throw Object.assign(Error(code), { code, status: 503 });
};
const clone = (v) => JSON.parse(JSON.stringify(v));
function artifactReader(root) {
  root = fs.realpathSync(root);
  const pins = new Map();
  function read(pin) {
    if (
      !pin ||
      !safeArtifactPath(pin.file) ||
      !/^[a-f0-9]{64}$/.test(pin.sha256 || '')
    )
      fail('DATA_PACKAGE_INVALID');
    const file = path.join(root, pin.file),
      stat = fs.lstatSync(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      fs.realpathSync(file) !== file ||
      stat.size > 128 * 1024 * 1024
    )
      fail('DATA_PACKAGE_INVALID');
    const bytes = fs.readFileSync(file);
    if (
      sha(bytes) !== pin.sha256 ||
      (pin.bytes !== undefined && bytes.length !== pin.bytes)
    )
      fail('DATA_PACKAGE_STALE');
    pins.set(file, pin.sha256);
    return bytes;
  }
  function assertCurrent() {
    for (const [file, digest] of pins)
      read({ file: path.relative(root, file), sha256: digest });
  }
  return { root, read, pins, assertCurrent };
}
function readDataIndex(root, suppliedIndex = null) {
  const reader = artifactReader(root),
    file = path.join(reader.root, 'manifest.json');
  if (!suppliedIndex) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
      fail('DATA_INDEX_INVALID');
  }
  const index = suppliedIndex || JSON.parse(fs.readFileSync(file)),
    identity = clone(index);
  delete identity.id;
  if (
    index.schemaVersion !== 'apollo.data-index.v1' ||
    index.id !== sha(JSON.stringify(identity)) ||
    index.Ready !== false ||
    !Array.isArray(index.contracts) ||
    !index.contracts.length ||
    index.contracts.length > 32
  )
    fail('DATA_INDEX_INVALID');
  return { index, reader };
}

function safeArtifactPath(file) {
  return (
    typeof file === 'string' &&
    file
      .split('/')
      .every(
        (part) =>
          /^[a-zA-Z0-9_.-]+$/.test(part) && part !== '.' && part !== '..'
      )
  );
}
module.exports = {
  sha,
  fail,
  clone,
  safeArtifactPath,
  artifactReader,
  readDataIndex,
};
