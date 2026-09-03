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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
}

function writeContract(root, packageName, contracts) {
  writeJson(
    path.join(root, 'web', 'components', packageName, 'contract.generated.json'),
    { contracts },
  );
}

function fixtureContract(id, name, platform, key, options = {}) {
  return {
    id,
    name,
    normalizedName: options.normalizedName || name,
    platform,
    status: 'active',
    role: 'main',
    componentKey: key,
    figma: {
      defaultVariantKey: key,
      variants: { properties: options.variants || {} },
      anatomy: options.anatomy || [],
    },
  };
}

function writeTokenCatalog(root) {
  writeJson(path.join(root, 'tokens', 'Interface Dynamic.json'), {
    collections: [{
      variables: [
        ['base-bg/primary', 'c'],
        ['base-bg-alt/primary', 'd'],
        ['modal-bg/primary', 'e'],
        ['modal-bg-alt/primary', 'f'],
      ].map(([name, digit]) => ({
        name,
        key: digit.repeat(40),
        resolvedType: 'COLOR',
      })),
    }],
  });
}

function writeHubSource(root, relativePath, lines) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join('\n'));
}

function createFixtureRoots() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-generation-'));
  const designSystemRoot = path.join(root, 'design-system_ab');
  const dsAiHubRoot = path.join(root, 'ds-ai-hub');
  writeTokenCatalog(designSystemRoot);
  const entries = [
    ['PromoMainBlock', 'promo-main-block.mobile-web', '[M] PromoMainBlock', '1', 'mobile-web'],
    ['BenefitCard', 'benefit-card.mobile-web', '[M] BenefitCard', '2', 'mobile-web'],
    ['PromoCard', 'promo-card.mobile-web', '[M] PromoCard', '3', 'mobile-web'],
    ['FAQ', 'faq.mobile-web', '🔒 [M] FAQ', '4', 'mobile-web'],
    ['Form', 'form.mobile-web', '🔒 [M] Form', '5', 'mobile-web'],
    ['TitleView', 'title-view.desktop', '[D] TitleView', '6', 'desktop'],
    ['Input', 'input.desktop', '[D] Input', '7', 'desktop'],
    ['Select', 'select.desktop', '[D] Select', '8', 'desktop'],
    ['ButtonsGroup', 'buttons-group.desktop', '[D] ButtonsGroup', '9', 'desktop'],
    ['ContentCardWrapper', 'content-card-wrapper.desktop', '[D] ContentCardWrapper', 'a', 'desktop'],
  ];
  for (const [packageName, id, name, digit, platform] of entries) {
    let options = {};
    if (packageName === 'Input') {
      options = {
          variants: { Size: ['48', '56'], OuterLabel: ['False', 'True'] },
          anatomy: [
            {
              type: 'TEXT',
              path: 'Size=56, FilledState=False, OuterLabel=True / Label / Label',
            },
            {
              type: 'TEXT',
              path: 'Size=56, FilledState=False, OuterLabel=True / Field / Content / Placeholder / Content / Placeholder',
            },
          ],
        };
    } else if (packageName === 'TitleView') {
      options = {
        variants: { View: ['xLarge', 'Large', 'Medium', 'Small'] },
        anatomy: [
          {
            type: 'TEXT',
            path: 'View=xLarge, Skeleton=False / MainContent / Subtitle / Subtitle',
          },
          {
            type: 'TEXT',
            path: 'View=xLarge, Skeleton=False / MainContent / [D] TitleStatus / Content / Subtitle',
          },
        ],
      };
    }
    writeContract(designSystemRoot, packageName, [
      fixtureContract(id, name, platform, digit.repeat(40), options),
    ]);
  }
  writeHubSource(dsAiHubRoot, 'products/ab/patterns/landing-pages.md', [
    '# Pattern: Лендинги в Альфа-Бизнесе',
    '- patternId: ptrn:landing-pages.alfa-business',
    '- patternKey: landing-pages.alfa-business',
    '- ruleId: rule:landing.required-three-sections',
  ]);
  writeHubSource(dsAiHubRoot, 'products/ab/patterns/form-construction-rules.md', [
    '# Pattern: Правила построения форм',
    '- patternId: ptrn:forms.construction-rules',
    '- patternKey: forms.construction-rules',
    '- ruleId: rule:forms.layout-8-4',
  ]);
  writeHubSource(dsAiHubRoot, 'products/ab/components/input/cookbook.md', [
    '# Cookbook: Input',
    'Size, OuterLabel, Field / Content / Label',
  ]);
  for (const componentName of [
    'promo-main-block',
    'benefit-card',
    'promo-card',
    'faq',
    'form',
    'title-view',
    'select',
    'buttons-group',
  ]) {
    writeHubSource(
      dsAiHubRoot,
      `products/ab/components/${componentName}/cookbook.md`,
      [`# Cookbook: ${componentName}`],
    );
  }
  return { root, designSystemRoot, dsAiHubRoot };
}

function source(pathValue, role, ruleIds = []) {
  return { path: pathValue, role, purpose: `Использовать ${pathValue}`, ruleIds };
}

function frame(id, parentId, name, options = {}) {
  return {
    id,
    type: 'frame',
    parentId,
    name,
    width: options.width || 'fill',
    minHeight: options.minHeight ?? null,
    layout: options.layout || 'vertical',
    gap: options.gap ?? 16,
    padding: options.padding ?? 20,
    fillRole: options.fillRole || 'none',
    cornerRadius: options.cornerRadius ?? 0,
    componentQuery: null,
    variantProperties: [],
    textOverrides: [],
  };
}

function component(id, parentId, componentQuery, options = {}) {
  return {
    id,
    type: 'component',
    parentId,
    name: options.name || componentQuery,
    componentQuery,
    width: options.width || 'fill',
    minHeight: null,
    layout: null,
    gap: null,
    padding: null,
    fillRole: null,
    cornerRadius: null,
    variantProperties: options.variantProperties || [],
    textOverrides: options.textOverrides || [],
  };
}

function readySemanticPlan(overrides = {}) {
  return {
    schemaVersion: 'apollo.semantic-generation.v1',
    status: 'ready',
    title: 'Лендинг',
    summary: 'Лендинг собран агентом по правилам ds-ai-hub.',
    kind: 'pattern',
    recipe: null,
    platform: 'mobile-web',
    primaryPattern: {
      id: 'ptrn:landing-pages.alfa-business',
      sourcePath: 'products/ab/patterns/landing-pages.md',
      ruleIds: ['rule:landing.required-three-sections'],
    },
    sources: [
      source(
        'products/ab/patterns/landing-pages.md',
        'pattern',
        ['rule:landing.required-three-sections'],
      ),
      ...[
        'promo-main-block',
        'benefit-card',
        'promo-card',
        'faq',
        'form',
      ].map((name) => source(
        `products/ab/components/${name}/cookbook.md`,
        'component-recipe',
      )),
    ],
    clarification: null,
    nodes: [
      frame('screen', null, 'Apollo · Лендинг', {
        width: 390,
        minHeight: 760,
        gap: 0,
        padding: 0,
        fillRole: 'base',
      }),
      frame('hero', 'screen', 'Главный блок'),
      frame('main', 'screen', 'Основной контент'),
      frame('benefits', 'main', 'Бенефиты'),
      frame('features', 'main', 'Ключевые особенности', { fillRole: 'base-alt' }),
      frame('footer', 'screen', 'Футер'),
      component('hero-component', 'hero', 'PromoMainBlock'),
      ...Array.from({ length: 3 }, (_, index) =>
        component(`benefit-${index + 1}`, 'benefits', 'BenefitCard')
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        component(`feature-${index + 1}`, 'features', 'PromoCard')
      ),
      component('faq', 'footer', 'FAQ'),
      component('form', 'footer', 'Form'),
    ],
    ...overrides,
  };
}

test.afterEach(() => clearGenerationCatalogCache());

test('resolves an agent landing plan through ds-ai-hub evidence and design-system_ab keys', () => {
  const roots = createFixtureRoots();
  try {
    const plan = createGenerationPlan(
      { prompt: 'Подготовь лендинг для мобильного веба' },
      readySemanticPlan(),
      roots,
    );
    assert.equal(plan.schemaVersion, PLAN_SCHEMA_VERSION);
    assert.equal(plan.kind, 'pattern');
    assert.equal(plan.pattern.sourcePath, 'products/ab/patterns/landing-pages.md');
    assert.equal(plan.knowledge.primarySource, 'ds-ai-hub');
    assert.equal(plan.knowledge.technicalSource, 'design-system_ab');
    assert.equal(plan.knowledge.componentCount, 11);
    assert.equal(plan.nodes[0].fillVariableKey, 'c'.repeat(40));
    assert.deepEqual(
      plan.nodes.filter((node) => node.type === 'component').map((node) => node.componentId),
      [
        'promo-main-block.mobile-web',
        'benefit-card.mobile-web',
        'benefit-card.mobile-web',
        'benefit-card.mobile-web',
        'promo-card.mobile-web',
        'promo-card.mobile-web',
        'promo-card.mobile-web',
        'promo-card.mobile-web',
        'promo-card.mobile-web',
        'faq.mobile-web',
        'form.mobile-web',
      ],
    );
  } finally {
    fs.rmSync(roots.root, { recursive: true, force: true });
  }
});

test('supports the form pattern without a pattern-specific compiler', () => {
  const roots = createFixtureRoots();
  try {
    const semantic = readySemanticPlan({
      title: 'Форма заявки',
      summary: 'Форма заявки по паттерну ds-ai-hub.',
      platform: 'desktop',
      primaryPattern: {
        id: 'ptrn:forms.construction-rules',
        sourcePath: 'products/ab/patterns/form-construction-rules.md',
        ruleIds: ['rule:forms.layout-8-4'],
      },
      sources: [
        source(
          'products/ab/patterns/form-construction-rules.md',
          'pattern',
          ['rule:forms.layout-8-4'],
        ),
        source('products/ab/components/input/cookbook.md', 'component-recipe'),
        source('products/ab/components/title-view/cookbook.md', 'component-recipe'),
        source('products/ab/components/select/cookbook.md', 'component-recipe'),
        source('products/ab/components/buttons-group/cookbook.md', 'component-recipe'),
      ],
      nodes: [
        frame('screen', null, 'Apollo · Форма', { width: 1200, fillRole: 'base-alt' }),
        frame('left', 'screen', 'Основная форма', { width: 760, padding: 32, gap: 24 }),
        component('title', 'left', 'TitleView', {
          variantProperties: [{ name: 'View', value: 'Medium' }],
          textOverrides: [{ path: 'Subtitle', value: 'Данные компании' }],
        }),
        component('input', 'left', 'Input', {
          variantProperties: [
            { name: 'Size', value: '56' },
            { name: 'Hint#29:476', value: 'False' },
          ],
          textOverrides: [{ path: 'Field / Content / Label', value: 'Название компании' }],
        }),
        component('select', 'left', 'Select'),
        component('actions', 'left', 'ButtonsGroup'),
      ],
    });
    const plan = createGenerationPlan(
      { prompt: 'Собери форму заявки' },
      semantic,
      roots,
    );
    assert.equal(plan.pattern.id, 'ptrn:forms.construction-rules');
    assert.deepEqual(plan.nodes[2].textOverrides, [{
      path: 'View=xLarge, Skeleton=False / MainContent / Subtitle / Subtitle',
      value: 'Данные компании',
    }]);
    assert.deepEqual(plan.nodes[3].variantProperties, [
      { name: 'Size', value: '56' },
      { name: 'Hint#29:476', value: false },
    ]);
    assert.deepEqual(plan.nodes[3].textOverrides, [{
      path: 'Size=56, FilledState=False, OuterLabel=True / Label / Label',
      value: 'Название компании',
    }]);
    assert.ok(plan.warnings.some((warning) => warning.includes('уникальному имени слоя')));
    assert.ok(plan.warnings.some((warning) => warning.includes('Hint#29:476')));
  } finally {
    fs.rmSync(roots.root, { recursive: true, force: true });
  }
});

test('returns an agent clarification without reading technical catalogs', () => {
  const roots = createFixtureRoots();
  fs.rmSync(roots.designSystemRoot, { recursive: true, force: true });
  try {
    const semantic = {
      schemaVersion: 'apollo.semantic-generation.v1',
      status: 'clarification_required',
      title: 'Нужно уточнение',
      summary: 'Состав формы зависит от сценария.',
      kind: null,
      recipe: null,
      platform: null,
      primaryPattern: null,
      sources: [source('products/ab/patterns/form-construction-rules.md', 'pattern')],
      clarification: {
        question: 'Какие данные пользователь должен отправить в форме?',
        reason: 'От ответа зависит состав и группировка полей.',
        suggestedAnswers: ['Контакты', 'Реквизиты компании'],
      },
      nodes: [],
    };
    const result = createGenerationPlan(
      { prompt: 'Сделай форму' },
      semantic,
      { dsAiHubRoot: roots.dsAiHubRoot },
    );
    assert.equal(result.status, 'clarification_required');
    assert.match(result.clarification.question, /Какие данные/);
  } finally {
    fs.rmSync(roots.root, { recursive: true, force: true });
  }
});

test('rejects source paths that were not actually read from ds-ai-hub', () => {
  const roots = createFixtureRoots();
  try {
    const semantic = readySemanticPlan({
      sources: [source('products/ab/patterns/missing.md', 'pattern')],
    });
    assert.throws(
      () => createGenerationPlan({ prompt: 'Лендинг' }, semantic, roots),
      (error) => error.code === 'GENERATION_SOURCE_MISSING',
    );
  } finally {
    fs.rmSync(roots.root, { recursive: true, force: true });
  }
});

test('rejects a real hub source that was not present in the agent context packet', () => {
  const roots = createFixtureRoots();
  try {
    assert.throws(
      () => createGenerationPlan(
        { prompt: 'Лендинг' },
        readySemanticPlan(),
        {
          ...roots,
          allowedSourcePaths: ['products/ab/patterns/landing-pages.md'],
        },
      ),
      (error) => error.code === 'GENERATION_CONTEXT_SOURCE_UNAVAILABLE',
    );
  } finally {
    fs.rmSync(roots.root, { recursive: true, force: true });
  }
});

test('rejects unsupported component properties from the technical contract', () => {
  const roots = createFixtureRoots();
  try {
    const defaultSources = readySemanticPlan().sources;
    const semantic = readySemanticPlan({
      platform: 'desktop',
      sources: defaultSources.concat(
        source('products/ab/components/input/cookbook.md', 'component-recipe'),
      ),
      nodes: [
        frame('screen', null, 'Форма', { width: 1200 }),
        component('input', 'screen', 'Input', {
          variantProperties: [{ name: 'Size', value: '96' }],
        }),
      ],
    });
    assert.throws(
      () => createGenerationPlan({ prompt: 'Форма' }, semantic, roots),
      (error) => error.code === 'GENERATION_COMPONENT_PROPERTY_UNAVAILABLE',
    );
  } finally {
    fs.rmSync(roots.root, { recursive: true, force: true });
  }
});

test('rejects a component that has no semantic evidence in ds-ai-hub sources', () => {
  const roots = createFixtureRoots();
  try {
    const semantic = readySemanticPlan({
      platform: 'desktop',
      nodes: [
        frame('screen', null, 'Форма', { width: 1200 }),
        component('input', 'screen', 'Input'),
      ],
    });
    assert.throws(
      () => createGenerationPlan({ prompt: 'Форма' }, semantic, roots),
      (error) => error.code === 'GENERATION_COMPONENT_KNOWLEDGE_MISSING',
    );
  } finally {
    fs.rmSync(roots.root, { recursive: true, force: true });
  }
});
