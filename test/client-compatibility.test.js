const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { readClientCompatibility } = require('../src/client-compatibility');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-compatibility-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sign = value => Object.assign({}, value, { id: crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex') });
  const write = (name, value) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
  const runtime = sign({ schemaVersion: 'apollo.proxy-portable-runtime.v1', profileVersion: '0.4.1', nativeSourceHash: 'b'.repeat(64) });
  const index = sign({ schemaVersion: 'apollo.data-index.v1', profileVersion: '0.4.1' });
  const release = sign({ schemaVersion: 'apollo.proxy-data-release.v1', runtimeId: runtime.id, dataId: index.id,
    profileVersion: '0.4.1', nativeSourceHash: runtime.nativeSourceHash, deliveryProfile: 'checking-ask-figma-mcp', generatedAt: '2026-11-02T12:00:00Z' });
  write('runtime/portable-runtime.json', runtime); write('release/manifest.json', release); write('release/contracts/manifest.json', index);
  return { root, write, release, index, options: { releaseRoot: path.join(root, 'release'), runtimeRoot: path.join(root, 'runtime'), dataRoot: '' } };
}
test('reports only the mounted data and runtime metadata, with no local paths', t => {
  const f = fixture(t), result = readClientCompatibility(f.options);
  assert.equal(result.protocolVersion, 1); assert.equal(result.data.state, 'ready');
  assert.equal(result.data.version, f.release.id); assert.equal(result.data.profileVersion, '0.4.1');
  assert.equal(JSON.stringify(result).includes(f.root), false);
});
test('missing data is separate from invalid or mixed metadata', t => {
  const f = fixture(t);
  assert.deepEqual(readClientCompatibility({ releaseRoot: '', runtimeRoot: '' }), { protocolVersion: 1, data: { state: 'missing' } });
  f.write('release/contracts/manifest.json', Object.assign({}, f.index, { profileVersion: '0.4.0' }));
  assert.equal(readClientCompatibility(f.options).data.state, 'invalid');
});
test('an overridden contracts root must match the release actually mounted', t => {
  const f = fixture(t); f.write('different/manifest.json', { schemaVersion: 'apollo.data-index.v1', id: 'c'.repeat(64) });
  assert.equal(readClientCompatibility(Object.assign({}, f.options, { dataRoot: path.join(f.root, 'different') })).data.state, 'invalid');
});
test('missing files and corrupt JSON do not break health or leak a filesystem error', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.root, 'runtime/portable-runtime.json'), '{');
  assert.deepEqual(readClientCompatibility(f.options), { protocolVersion: 1, data: { state: 'invalid' } });
});
