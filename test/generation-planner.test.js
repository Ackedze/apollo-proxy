const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  PLAN_SCHEMA_VERSION,
  clearGenerationCatalogCache,
  createGenerationPlan,
} = require('../src/generation/planner');

function writeContract(root, packageName, contracts) {
  const directory = path.join(root, 'web', 'components', packageName);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'contract.generated.json'),
    JSON.stringify({ contracts }),
  );
}

function fixtureContract(id, name, platform, key) {
  return {
    id,
    name,
    platform,
    status: 'active',
    role: 'main',
    componentKey: key,
    figma: { defaultVariantKey: key },
  };
}

function createFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-generation-'));
  const entries = [
    ['TitleView', 'title-view.desktop', '[D] TitleView', '1'],
    ['Input', 'input.desktop', '[D][Corporate] Input', '2'],
    ['Select', 'select.desktop', '[D][Corporate] Select', '3'],
    ['ButtonsGroup', 'buttons-group.desktop', '[D] ButtonsGroup', '4'],
    ['FilterBar', 'filter-bar.desktop', '[D] FilterBar', '5'],
    ['TableView', 'table-view-horizontal.desktop', '[D] TableView :: Horizontal', '6'],
  ];
  for (const [packageName, id, name, digit] of entries) {
    writeContract(root, packageName, [
      fixtureContract(id, name, 'desktop', digit.repeat(40)),
    ]);
  }
  return root;
}

test.afterEach(() => clearGenerationCatalogCache());

test('creates a form plan from proxy-owned contracts', () => {
  const root = createFixtureRoot();
  try {
    const plan = createGenerationPlan(
      { prompt: 'Создай форму заявки с полями и кнопками' },
      { designSystemRoot: root },
    );
    assert.equal(plan.schemaVersion, PLAN_SCHEMA_VERSION);
    assert.equal(plan.recipe, 'form');
    assert.equal(plan.platform, 'desktop');
    assert.equal(plan.nodes[0].type, 'frame');
    assert.deepEqual(
      plan.nodes.filter((node) => node.type === 'component').map((node) => node.componentId),
      ['title-view.desktop', 'input.desktop', 'input.desktop', 'select.desktop', 'buttons-group.desktop'],
    );
    assert.equal(plan.knowledge.source, 'apollo-proxy');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('uses explicitly mentioned components instead of a default recipe', () => {
  const root = createFixtureRoot();
  try {
    const plan = createGenerationPlan(
      { prompt: 'Собери экран с FilterBar и TableView' },
      { designSystemRoot: root },
    );
    const componentIds = plan.nodes
      .filter((node) => node.type === 'component')
      .map((node) => node.componentId);
    assert.deepEqual(componentIds, ['filter-bar.desktop', 'table-view-horizontal.desktop']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects empty prompts before reading the catalog', () => {
  assert.throws(
    () => createGenerationPlan({ prompt: '   ' }, { designSystemRoot: '/missing' }),
    (error) => error.code === 'GENERATION_PROMPT_REQUIRED' && error.status === 400,
  );
});
