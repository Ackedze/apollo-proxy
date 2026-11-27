'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createFrozenDataCommand } = require('../windows-app/frozen-data');
const protectedData = require('../src/data-packages/protected');
const npmData = require('../src/data-packages/npm');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'windows-frozen-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = path.join(root, 'package.tgz'), indexFile = path.join(root, 'current.json'), bytes = Buffer.from('encrypted fixture');
  fs.writeFileSync(archive, bytes);
  const index = { schemaVersion: 'apollo.git-data-index.v3', runtimeId: 'a'.repeat(64),
    activation: protectedData.createActivation('Секрет редактора'), npm: { name: '@apollo/data', version: '1.0.0', dataId: 'b'.repeat(64),
      tarballUrl: 'https://example.invalid/pinned.tgz', bytes: bytes.length,
      integrity: 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64') } };
  fs.writeFileSync(indexFile, JSON.stringify(index));
  fs.mkdirSync(path.join(root, 'seed')); fs.writeFileSync(path.join(root, 'seed/.activation-required'), '');
  const releases = { readRuntime: () => ({ id: index.runtimeId }), ensureStore: async () => ({ state: { current: null, previous: null } }) };
  const options = { store: path.join(root, 'store'), seed: path.join(root, 'seed'), runtime: path.join(root, 'runtime') };
  const create = extra => createFrozenDataCommand({ indexFile, archive, releases, protectedData, validateReference: npmData.validateReference, cli: { runCommand: async command => ({ command }) }, ...extra });
  return { root, index, options, create, releases, archive };
}
test('frozen activation rejects a wrong password using the unchanged stock access guard', async t => {
  const f = fixture(t), command = f.create();
  await assert.rejects(command('activate', { ...f.options, access: { password: 'неверный' } }), { code: 'DATA_ACTIVATION_PASSWORD_INVALID' });
  assert.equal(fs.existsSync(f.options.store), false);
});
test('frozen bootstrap preserves runtime compatibility before touching a store', async t => {
  const f = fixture(t);
  const command = f.create({ releases: { ...f.releases, readRuntime: () => ({ id: 'c'.repeat(64) }) } });
  await assert.rejects(command('activate', f.options), /DATA_RELEASE_RUNTIME_INCOMPATIBLE/);
});
test('bundled bytes still go through the stock SHA-512 guard; other URLs cannot be fetched', async t => {
  const f = fixture(t);
  const command = f.create({ protectedData: { validateActivation: protectedData.validateActivation,
    async installProtected({ request, selected }) {
      await assert.rejects(request('https://other.invalid/secret.tgz'), /WINDOWS_SEED_REQUEST_FORBIDDEN/);
      await npmData.download(selected.index.npm, path.join(f.root, 'download'), request);
      return { accepted: true };
    } } });
  assert.deepEqual(await command('check', f.options), { accepted: true });
  fs.writeFileSync(f.archive, 'wrong-sized fixture');
  await assert.rejects(command('check', f.options), { code: 'NPM_DATA_SIZE_INVALID' });
});
test('an empty user store recovers only from the declared activation-required seed', async t => {
  const f = fixture(t);
  const command = f.create({ releases: { ...f.releases, ensureStore: async () => { throw Object.assign(Error('missing'), { code: 'ENOENT' }); } },
    protectedData: { validateActivation: protectedData.validateActivation, async installProtected({ ensured }) { return ensured.state; } } });
  assert.deepEqual(await command('check', f.options), { current: null, previous: null });
  fs.rmSync(path.join(f.options.seed, '.activation-required'));
  await assert.rejects(command('check', f.options), { code: 'ENOENT' });
});
