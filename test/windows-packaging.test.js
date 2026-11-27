'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { tarExecutable } = require('../windows-app/archive-tool');
const { safe, readPin, portability } = require('../windows-app/build');
test('Windows uses the absolute system archive tool; other platforms keep their current executable', () => {
  assert.equal(tarExecutable('win32', { SystemRoot: 'C:\\Windows' }), 'C:\\Windows\\System32\\tar.exe');
  assert.equal(tarExecutable('win32', { SYSTEMROOT: 'D:\\Windows' }), 'D:\\Windows\\System32\\tar.exe');
  assert.throws(() => tarExecutable('win32', { SystemRoot: 'relative' }), /WINDOWS_SYSTEM_ROOT_INVALID/);
  assert.equal(tarExecutable('darwin', {}), '/usr/bin/tar'); assert.equal(tarExecutable('linux', {}), '/usr/bin/tar');
});
test('Windows overlay requires exactly one accepted callsite and preserves the rest', () => {
  const before = Buffer.from("prefix\nconst TAR_EXECUTABLE = '/usr/bin/tar';\nsuffix");
  assert.equal(portability('proxy/src/knowledge-package/index.js', before).toString(), "prefix\nconst TAR_EXECUTABLE = require('../archive-tool').tarExecutable();\nsuffix");
  for (const bytes of [Buffer.from('changed'), Buffer.concat([before,before])]) assert.throws(() => portability('proxy/src/knowledge-package/index.js', bytes), /PREIMAGE_CHANGED/);
  assert.equal(portability('unchanged.js', before), before);
  const checker = Buffer.from("['-I', path.join(__dirname, 'checker.py')]");
  assert.equal(portability('proxy/src/skills/ux-writer/index.js', checker).toString(), "['-I', '-X', 'utf8', path.join(__dirname, 'checker.py')]");
});
test('packaging detects changed bytes and unsafe paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'windows-pins-'));
  try {
    const file = path.join(root, 'source'); fs.writeFileSync(file, 'accepted');
    const pin = { path: file, bytes: 8, sha256: crypto.createHash('sha256').update('accepted').digest('hex') };
    assert.equal(readPin(pin).toString(), 'accepted'); fs.writeFileSync(file, 'modified');
    assert.throws(() => readPin(pin), /INPUT_CHANGED/);
    for (const file of ['../bad', '/absolute', 'C:/bad', 'a\\b', 'a/./b']) assert.equal(safe(file), false);
    assert.equal(safe('proxy/src/accepted.js'), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
