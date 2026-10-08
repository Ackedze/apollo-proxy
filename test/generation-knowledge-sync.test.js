const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildArtifactPlan,
  copyArtifactPlan,
} = require('../scripts/sync-contract-knowledge');
const {
  resolveCatalogRoot,
} = require('../src/generation/planner');

test('generation catalog prefers canonical JSONS over a stale knowledge mirror', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-catalog-root-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await fsp.mkdir(path.join(root, 'web', 'components'), { recursive: true });
  const canonical = path.join(root, 'JSONS', 'web', 'components');
  await fsp.mkdir(canonical, { recursive: true });
  assert.equal(resolveCatalogRoot(root), canonical);
});

test('knowledge sync embeds adjacent generation semantic target maps', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-generation-sync-'));
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  const packagePath = path.join('web', 'components', 'PromoMainBlock');
  const packageDirectory = path.join(source, packagePath);
  const indexDirectory = path.join(source, 'apollo', 'indexes');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  await fsp.mkdir(packageDirectory, { recursive: true });
  await fsp.mkdir(indexDirectory, { recursive: true });
  await fsp.writeFile(
    path.join(packageDirectory, 'contract.generated.json'),
    '{"schemaVersion":1}\n',
  );
  await fsp.writeFile(
    path.join(packageDirectory, 'semantic-targets.json'),
    '{"schemaVersion":"apollo.generation-semantic-target-map.v1"}\n',
  );
  await fsp.writeFile(
    path.join(indexDirectory, 'componentContractIndex.json'),
    JSON.stringify({
      schemaVersion: 2,
      packages: [{
        componentKey: 'a'.repeat(40),
        packagePath,
        artifacts: { contract: 'contract.generated.json' },
      }],
    }),
  );

  const result = await buildArtifactPlan(source, target);
  const semanticArtifact = result.plan.find(
    (item) => item.role === 'generationSemanticTargets',
  );
  assert.equal(semanticArtifact?.relativePath, path.join(
    packagePath,
    'semantic-targets.json',
  ));

  await copyArtifactPlan(result.plan, target);
  assert.equal(
    await fsp.readFile(
      path.join(target, packagePath, 'semantic-targets.json'),
      'utf8',
    ),
    '{"schemaVersion":"apollo.generation-semantic-target-map.v1"}\n',
  );
});
