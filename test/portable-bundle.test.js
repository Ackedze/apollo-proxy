const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildPortableRuntime } = require('../scripts/build-portable-runtime');
const { readRuntime, idOf } = require('../src/data-release');

test('sparse portable code copies literal module closure and rejects external/author-root dependencies', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-code-bundle-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'code');
  const put = (name, body) => { const f = path.join(source, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };
  put('src/start.cjs', 'module.exports=require("./helper.cjs")'); put('src/helper.cjs', 'module.exports="fixture"');
  const skill = 'Repo-pinned fixture instruction';
  put('skills/fixture/SKILL.md', skill);
  put('instructions/agent-generation/skill-profile.json', JSON.stringify({ targets: { frontend: { name: 'fixture',
    files: [{ path: 'SKILL.md', bytes: Buffer.byteLength(skill), sha256: require('../src/data-release').sha(Buffer.from(skill)) }] } } }));
  put('dist/build-inputs.json', JSON.stringify({ profileVersion: '0.4.1' }));
  put('dist/agent-figma-provider-descriptor.json', JSON.stringify({ sourceHash: 'a'.repeat(64) }));
  const choice = { id: 'fixture', key: 'published-key', bodyProperty: 'Body', slotSourceId: '1:2', defaultSourceIds: [],
    references: [{ path: '/Users/author/private-report.json' }], defaultPayloadEvidence: { source: { path: '/Users/author/receipt.json' } } };
  put('src/generation/agent/figma/source.json', JSON.stringify({ choices: [choice], capabilityPlatform: 'desktop',
    policyInputs: [{ path: '/Users/author/old-seal.json' }], genericMapping: { historical: true } }));
  const options = { apolloRoot: source, output: path.join(root, 'installed'), entries: ['src/start.cjs', 'dist/agent-figma-provider-descriptor.json', 'src/generation/agent/figma/source.json'] };
  const result = buildPortableRuntime(options);
  assert.equal(result.id, readRuntime(options.output).id);
  assert.ok(result.files.some(f => f.file === 'src/helper.cjs'));
  assert.ok(result.files.every(f => !path.isAbsolute(f.file)));
  assert.equal(fs.existsSync(path.join(options.output, '.git')), false);
  assert.equal(fs.readFileSync(path.join(options.output, 'skills/fixture/SKILL.md'), 'utf8'), skill);
  const projected = JSON.parse(fs.readFileSync(path.join(options.output, 'src/generation/agent/figma/source.json')));
  const { references, defaultPayloadEvidence, ...runtimeChoice } = choice;
  assert.deepEqual(projected, { choices: [runtimeChoice], capabilityPlatform: 'desktop' });
  assert.equal(JSON.stringify(projected).includes('/Users/author'), false);
  assert.equal(result.sourceProjection.originalSha256, require('../src/data-release').sha(fs.readFileSync(path.join(source, result.sourceProjection.file))));
  const wrongIdentity = { ...result, nativeSourceHash: 'b'.repeat(64) };
  wrongIdentity.id = idOf(wrongIdentity);
  fs.writeFileSync(path.join(options.output, 'portable-runtime.json'), JSON.stringify(wrongIdentity));
  assert.throws(() => readRuntime(options.output), { code: 'DATA_RELEASE_RUNTIME_INVALID' });
  put('src/start.cjs', 'require("private-sdk")');
  assert.throws(() => buildPortableRuntime({ ...options, output: path.join(root, 'bad-external') }), /explicit installed toolchain/);
  fs.writeFileSync(path.join(root, 'outside.cjs'), 'module.exports="private"');
  put('src/start.cjs', 'require("../../outside.cjs")');
  assert.throws(() => buildPortableRuntime({ ...options, output: path.join(root, 'bad-outside') }), /outside accepted code root/);
});
