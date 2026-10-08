const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  PLAN_SCHEMA_VERSION,
  applyPatternCompilerDefaults,
  clearGenerationCatalogCache,
  createGenerationPlan,
  findComponent,
  inspectGenerationComponentAvailability,
  loadGenerationCatalog,
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

function writeSemanticTargets(root, packageName, componentId, profiles) {
  writeJson(
    path.join(root, 'web', 'components', packageName, 'semantic-targets.json'),
    {
      schemaVersion: 1,
      documentType: 'generation-semantic-target-map',
      componentId,
      sourceContract: 'contract.generated.json',
      profiles,
    },
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
      variants: {
        properties: options.variants || {},
        variantKeys: [{ key, properties: options.defaultVariantProperties || {} }],
      },
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
    ['CorporateContent', 'corporate-content.mobile-web', '[M] CorporateContent', 'b', 'mobile-web'],
    ['Benefits', 'benefits.mobile-web', '🔒 [M] Benefits', 'c', 'mobile-web'],
    ['ButtonStack', 'button-stack.mobile-web', '🔒 [M] ButtonStack', 'd', 'mobile-web'],
    ['BenefitCard', 'benefit-card.mobile-web', '[M] BenefitCard', '2', 'mobile-web'],
    ['PromoCard', 'promo-card.mobile-web', '[M] PromoCard', '3', 'mobile-web'],
    ['FAQ', 'faq.mobile-web', '[M][Promo] FAQ', '4', 'mobile-web'],
    ['Form', 'form.mobile-web', '🔒 [M] Form', '5', 'mobile-web'],
    ['Textarea', 'textarea.mobile-web', '[M] Textarea', 'e', 'mobile-web'],
    ['Button', 'button.mobile-web', '[M] Button', 'f', 'mobile-web'],
    ['VOC', 'voc.mobile-web', '[M] VOC', '8', 'mobile-web'],
    ['TitleViewMobile', 'title-view.mobile-web', '[M] TitleView', 'a', 'mobile-web'],
    ['TitleView', 'title-view.desktop', '[D] TitleView', '6', 'desktop'],
    ['Input', 'input.desktop', '[D] Input', '7', 'desktop'],
    ['Select', 'select.desktop', '[D] Select', '8', 'desktop'],
    ['ButtonsGroup', 'buttons-group.desktop', '[D] ButtonsGroup', '9', 'desktop'],
    ['ContentCardWrapper', 'content-card-wrapper.desktop', '[D] ContentCardWrapper', 'a', 'desktop'],
  ];
  for (const [packageName, id, name, digit, platform] of entries) {
    let options = {};
    if (packageName === 'PromoMainBlock') {
      options = {
        variants: { Appearance: ['Light', 'Dark'], Background: ['True', 'False'] },
        anatomy: [
          { type: 'TEXT', path: 'Content / Title / value' },
          { type: 'TEXT', path: 'Content / ButtonGroup / Primary / Text / Label' },
        ],
      };
    } else if (packageName === 'CorporateContent') {
      options = { anatomy: [{ type: 'SLOT', path: '[M] CorporateContent / [M] Body' }] };
    } else if (packageName === 'Benefits') {
      options = { variants: { Capacity: ['3', '4'] } };
    } else if (packageName === 'ButtonStack') {
      options = {
        anatomy: [{ type: 'TEXT', path: 'Presets=Primary / Content / MainButtonStack / [M] Button / Text / Label' }],
      };
    } else if (packageName === 'Button') {
      options = { anatomy: [{ type: 'TEXT', path: '[M] Button / Text / Label' }] };
    } else if (packageName === 'VOC') {
      options = { anatomy: [{ type: 'FRAME', path: '[M] VOC / ModalHeader' }] };
    } else if (packageName === 'Input') {
      options = {
          variants: {
            Size: ['48', '56'],
            FilledState: ['False', 'True'],
            OuterLabel: ['False', 'True'],
          },
          defaultVariantProperties: {
            Size: '56',
            FilledState: 'False',
            OuterLabel: 'True',
          },
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
    } else if (packageName === 'TitleView' || packageName === 'TitleViewMobile') {
      options = {
        variants: { View: ['xLarge', 'Large', 'Medium', 'Small'] },
        anatomy: [
          {
            type: 'TEXT',
            path: 'MainContent / Heading / Title',
          },
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
  writeSemanticTargets(designSystemRoot, 'PromoMainBlock', 'PromoMainBlock', [{
    id: 'mobile-page',
    platform: 'mobile-web',
    contractId: 'promo-main-block.mobile-web',
    publicRoot: '[M] PromoMainBlock',
    verification: { source: 'contract.generated.json', liveInstanceVerified: false },
    targets: [
      {
        id: 'variant.appearance',
        kind: 'variant-property',
        supported: true,
        property: 'Appearance',
        values: { light: 'Light', dark: 'Dark' },
      },
      {
        id: 'content.title',
        kind: 'text',
        supported: true,
        selectors: [{ strategy: 'path-suffix', path: 'Content / Title / value', nodeTypes: ['TEXT'], occurrence: 0 }],
        writePolicy: 'first',
      },
      {
        id: 'content.image',
        kind: 'unsupported',
        supported: false,
        reason: 'Asset selection unavailable.',
      },
    ],
  }]);
  writeSemanticTargets(designSystemRoot, 'CorporateContent', 'CorporateContent', [{
    id: 'mobile',
    platform: 'mobile-web',
    contractId: 'corporate-content.mobile-web',
    publicRoot: '[M] CorporateContent',
    verification: { source: 'contract.generated.json', liveInstanceVerified: false },
    targets: [{
      id: 'slots.body',
      kind: 'slot',
      supported: true,
      selectors: [{ strategy: 'path-suffix', path: '[M] Body', nodeTypes: ['SLOT'], occurrence: 0 }],
      writePolicy: 'first',
    }],
  }]);
  writeContract(designSystemRoot, 'NavigationCardView', [
    fixtureContract('navigation-card-view.mobile-web', '[M] Benefits', 'mobile-web', '0'.repeat(40)),
  ]);
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
  const componentRoots = {
    PromoMainBlock: '[M] PromoMainBlock',
    CorporateContent: '[M] CorporateContent',
    Benefits: '🔒 [M] Benefits',
    ButtonStack: '🔒 [M] ButtonStack',
    BenefitCard: '[M] BenefitCard',
    PromoCard: '[M] PromoCard',
    FAQ: '[M][Promo] FAQ',
    Form: '🔒 [M] Form',
    Textarea: '[M] Textarea',
    Button: '[M] Button',
    VOC: '[M] VOC',
    TitleView: '[D] TitleView',
    Input: '[D] Input',
    Select: '[D] Select',
    ButtonsGroup: '[D] ButtonsGroup',
    ContentCardWrapper: '[D] ContentCardWrapper',
  };
  for (const [componentId, componentRoot] of Object.entries(componentRoots)) {
    const componentName = componentId.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    writeHubSource(
      dsAiHubRoot,
      `products/ab/components/${componentName}/cookbook.md`,
      [`# Cookbook: ${componentName}`],
    );
    writeJson(
      path.join(dsAiHubRoot, `products/ab/components/${componentName}/meta.json`),
      {
        id: componentId,
        publicComponentRoots: componentId === 'TitleView'
          ? ['[D] TitleView', '[M] TitleView']
          : [componentRoot],
        recommendedComponentRoots: componentId === 'TitleView'
          ? ['[D] TitleView', '[M] TitleView']
          : [componentRoot],
      },
    );
  }
  return { root, designSystemRoot, dsAiHubRoot };
}

function source(pathValue, role, ruleIds = []) {
  return { path: pathValue, role, purpose: `Использовать ${pathValue}`, ruleIds };
}

function componentSources(componentIds) {
  return componentIds.flatMap((componentId) => {
    const directory = componentId.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    return [
      source(`products/ab/components/${directory}/meta.json`, 'guideline'),
      source(`products/ab/components/${directory}/cookbook.md`, 'component-recipe'),
    ];
  });
}

function frame(id, parentId, name, options = {}) {
  return {
    id,
    type: 'frame',
    parentId,
    name,
    semanticRole: options.semanticRole || (parentId === null ? 'screen' : 'content'),
    semanticComponentId: null,
    placement: options.placement || 'append',
    parentPath: options.parentPath || null,
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

const COMPONENT_ROOTS = {
  PromoMainBlock: '[M] PromoMainBlock',
  CorporateContent: '[M] CorporateContent',
  Benefits: '🔒 [M] Benefits',
  ButtonStack: '🔒 [M] ButtonStack',
  BenefitCard: '[M] BenefitCard',
  PromoCard: '[M] PromoCard',
  FAQ: '[M][Promo] FAQ',
  Form: '🔒 [M] Form',
  Textarea: '[M] Textarea',
  Button: '[M] Button',
  VOC: '[M] VOC',
  TitleView: '[D] TitleView',
  Input: '[D] Input',
  Select: '[D] Select',
  ButtonsGroup: '[D] ButtonsGroup',
  ContentCardWrapper: '[D] ContentCardWrapper',
};

function component(id, parentId, semanticComponentId, options = {}) {
  const componentQuery = options.componentQuery || COMPONENT_ROOTS[semanticComponentId];
  return {
    id,
    type: 'component',
    parentId,
    name: options.name || componentQuery,
    semanticRole: options.semanticRole || 'content',
    semanticComponentId,
    placement: options.placement || 'append',
    parentPath: options.parentPath || null,
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
    schemaVersion: 'apollo.semantic-generation.v3',
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
      ...componentSources([
        'PromoMainBlock', 'CorporateContent', 'ButtonStack', 'Benefits',
        'PromoCard', 'FAQ', 'Textarea', 'Button', 'TitleView',
      ]),
    ],
    clarification: null,
    blocked: null,
    nodes: [
      frame('screen', null, 'Apollo · Лендинг', {
        width: 390,
        minHeight: 760,
        gap: 0,
        padding: 0,
        fillRole: 'base',
      }),
      component('corporate', 'screen', 'CorporateContent'),
      frame('main', 'corporate', 'Основной контент', {
        semanticRole: 'main-content',
        placement: 'replace-slot',
        parentPath: '[M] Body',
      }),
      component('hero-component', 'main', 'PromoMainBlock', { semanticRole: 'hero' }),
      component('hero-action', 'hero-component', 'ButtonStack', {
        semanticRole: 'primary-action',
        placement: 'swap-instance',
        parentPath: 'Content / ContentWrapper / ButtonGroup',
        textOverrides: [{ path: '[M] Button / Text / Label', value: 'Оставить отзыв' }],
      }),
      component('benefits', 'main', 'Benefits', {
        semanticRole: 'benefits',
        variantProperties: [{ name: 'Capacity', value: '3' }],
      }),
      frame('features', 'main', 'Ключевые особенности', { semanticRole: 'features', fillRole: 'base-alt' }),
      ...Array.from({ length: 5 }, (_, index) =>
        component(`feature-${index + 1}`, 'features', 'PromoCard', { semanticRole: 'feature' })
      ),
      frame('footer', 'main', 'Футер', { semanticRole: 'footer' }),
      component('faq-heading', 'footer', 'TitleView', {
        semanticRole: 'content',
        componentQuery: '[M] TitleView',
        textOverrides: [{ path: 'MainContent / Heading / Title', value: 'Частые вопросы' }],
      }),
      component('faq', 'footer', 'FAQ', { semanticRole: 'faq' }),
      frame('form', 'footer', 'Форма обратной связи', { semanticRole: 'form' }),
      component('comment', 'form', 'Textarea', { semanticRole: 'field' }),
      component('form-action', 'form', 'Button', {
        semanticRole: 'primary-action',
        textOverrides: [{ path: 'Text / Label', value: 'Оставить отзыв' }],
      }),
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
    assert.equal(plan.knowledge.componentCount, 13);
    assert.equal(plan.preflight.status, 'passed');
    assert.equal(plan.nodes[0].fillVariableKey, 'c'.repeat(40));
    assert.deepEqual(
      plan.nodes.filter((node) => node.type === 'component').map((node) => node.componentId),
      [
        'corporate-content.mobile-web',
        'promo-main-block.mobile-web',
        'button-stack.mobile-web',
        'benefits.mobile-web',
        'promo-card.mobile-web',
        'promo-card.mobile-web',
        'promo-card.mobile-web',
        'promo-card.mobile-web',
        'promo-card.mobile-web',
        'title-view.mobile-web',
        'faq.mobile-web',
        'textarea.mobile-web',
        'button.mobile-web',
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
        ...componentSources(['Input', 'TitleView', 'Select', 'ButtonsGroup']),
      ],
      nodes: [
        frame('screen', null, 'Apollo · Форма', { width: 1200, fillRole: 'base-alt' }),
        frame('left', 'screen', 'Основная форма', {
          width: 760,
          padding: 32,
          gap: 24,
          semanticRole: 'form',
        }),
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
      schemaVersion: 'apollo.semantic-generation.v3',
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
      blocked: null,
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

test('converts a technical clarification into a terminal blocked outcome', () => {
  const roots = createFixtureRoots();
  fs.rmSync(roots.designSystemRoot, { recursive: true, force: true });
  try {
    const semantic = {
      schemaVersion: 'apollo.semantic-generation.v3',
      status: 'clarification_required',
      title: 'Нужно уточнение',
      summary: 'В пакете нет исполнимого target.',
      kind: null,
      recipe: null,
      platform: null,
      primaryPattern: null,
      sources: [source('products/ab/patterns/landing-pages.md', 'pattern')],
      clarification: {
        question: 'Добавить semantic target в контракт?',
        reason: 'В context packet нет нужного технического контракта.',
        suggestedAnswers: ['Да, обновить контракт'],
      },
      blocked: null,
      nodes: [],
    };
    const result = createGenerationPlan(
      { prompt: 'Собери лендинг' },
      semantic,
      { dsAiHubRoot: roots.dsAiHubRoot },
    );
    assert.equal(result.status, 'blocked');
    assert.equal(result.blocked.code, 'GENERATION_CAPABILITY_MISSING');
  } finally {
    fs.rmSync(roots.root, { recursive: true, force: true });
  }
});

test('stops a repeated product clarification instead of looping', () => {
  const roots = createFixtureRoots();
  fs.rmSync(roots.designSystemRoot, { recursive: true, force: true });
  try {
    const semantic = {
      schemaVersion: 'apollo.semantic-generation.v3',
      status: 'clarification_required',
      title: 'Нужно уточнение',
      summary: 'Нужен продуктовый выбор.',
      kind: null,
      recipe: null,
      platform: null,
      primaryPattern: null,
      sources: [source('products/ab/patterns/landing-pages.md', 'pattern')],
      clarification: {
        question: 'Какое главное действие использовать?',
        reason: 'От ответа зависит CTA.',
        suggestedAnswers: ['Оставить отзыв', 'Подробнее'],
      },
      blocked: null,
      nodes: [],
    };
    const result = createGenerationPlan(
      {
        prompt: 'Оставить отзыв',
        brief: 'Собери лендинг',
        dialogue: [{ role: 'assistant', text: 'Какое главное действие использовать?' }],
        clarificationRound: 1,
      },
      semantic,
      { dsAiHubRoot: roots.dsAiHubRoot },
    );
    assert.equal(result.status, 'blocked');
    assert.equal(result.blocked.code, 'GENERATION_CLARIFICATION_LIMIT');
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
      sources: defaultSources.concat(componentSources(['Input'])),
      nodes: [
        frame('screen', null, 'Форма', { width: 1200 }),
        component('input', 'screen', 'Input', {
          semanticRole: 'form',
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

test('omits a semantic text target that is unavailable in the selected component state', () => {
  const roots = createFixtureRoots();
  try {
    writeSemanticTargets(roots.designSystemRoot, 'Input', 'Input', [{
      id: 'desktop-comment',
      platform: 'desktop',
      contractId: 'input.desktop',
      publicRoot: '[D] Input',
      verification: { source: 'contract.generated.json', liveInstanceVerified: true },
      targets: [
        {
          id: 'variant.outerLabel',
          kind: 'variant-property',
          supported: true,
          property: 'OuterLabel',
          values: { true: 'True', false: 'False' },
        },
        {
          id: 'content.placeholder',
          kind: 'text',
          supported: true,
          selectors: [{
            strategy: 'path-suffix',
            path: 'Field / Content / Placeholder / Content / Placeholder',
            nodeTypes: ['TEXT'],
            occurrence: 0,
          }],
          writePolicy: 'first',
          availableWhen: [
            { property: 'FilledState', values: ['False'] },
            { property: 'OuterLabel', values: ['True'] },
          ],
          onUnavailable: 'omit',
        },
      ],
    }]);
    clearGenerationCatalogCache();
    const semantic = readySemanticPlan({
      platform: 'desktop',
      sources: [
        source('products/ab/patterns/landing-pages.md', 'pattern', ['rule:landing.required-three-sections']),
        ...componentSources(['Input']),
      ],
      nodes: [
        frame('screen', null, 'Поле', { width: 1200 }),
        component('input', 'screen', 'Input', {
          semanticRole: 'field',
          variantProperties: [{ name: 'variant.outerLabel', value: false }],
          textOverrides: [{ path: 'content.placeholder', value: 'Ваш комментарий' }],
        }),
      ],
    });
    const plan = createGenerationPlan({ prompt: 'Добавь поле ввода' }, semantic, roots);
    const input = plan.nodes.find((node) => node.id === 'input');
    assert.deepEqual(input.variantProperties, [{ name: 'OuterLabel', value: 'False' }]);
    assert.deepEqual(input.textOverrides, []);
    assert.deepEqual(input.preconditionOverrides, []);
    assert.match(plan.warnings.join('\n'), /content\.placeholder пропущен/u);
  } finally {
    fs.rmSync(roots.root, { recursive: true, force: true });
  }
});

test('compiles semantic edit context before the final nested instance state', () => {
  const roots = createFixtureRoots();
  try {
    writeSemanticTargets(roots.designSystemRoot, 'FAQ', 'FAQ', [{
      id: 'mobile-promo-footer',
      platform: 'mobile-web',
      contractId: 'faq.mobile-web',
      publicRoot: '[M][Promo] FAQ',
      verification: { source: 'contract.generated.json', liveInstanceVerified: true },
      targets: [
        {
          id: 'items.1.answer',
          kind: 'text',
          supported: true,
          selectors: [{
            strategy: 'path-suffix',
            path: 'FAQItem 01 / Accordion / Body / 🔩 AccordionBody / Subtitle',
            nodeTypes: ['TEXT'],
            occurrence: 0,
          }],
          writePolicy: 'first',
          editContext: [{ target: 'items.1.open', value: 'true' }],
        },
        {
          id: 'items.1.open',
          kind: 'instance-property',
          supported: true,
          property: 'Open',
          values: { true: 'True', false: 'False' },
          selectors: [{
            strategy: 'path-suffix',
            path: 'FAQItem 01',
            nodeTypes: ['INSTANCE'],
            occurrence: 0,
          }],
          writePolicy: 'first',
        },
      ],
    }]);
    clearGenerationCatalogCache();
    const semantic = readySemanticPlan({
      sources: [
        source('products/ab/patterns/landing-pages.md', 'pattern', ['rule:landing.required-three-sections']),
        ...componentSources(['FAQ']),
      ],
      nodes: [
        frame('screen', null, 'FAQ', { width: 390 }),
        component('faq', 'screen', 'FAQ', {
          semanticRole: 'faq',
          variantProperties: [{ name: 'items.1.open', value: false }],
          textOverrides: [{ path: 'items.1.answer', value: 'Ответ FAQ' }],
        }),
      ],
    });
    const plan = createGenerationPlan({ prompt: 'Настрой компонент' }, semantic, roots);
    const faq = plan.nodes.find((node) => node.id === 'faq');
    assert.deepEqual(faq.preconditionOverrides[0].properties, [{ name: 'Open', value: 'True' }]);
    assert.deepEqual(faq.instancePropertyOverrides[0].properties, [{ name: 'Open', value: 'False' }]);
    assert.equal(faq.textOverrides[0].semanticTarget, 'items.1.answer');
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
        component('input', 'screen', 'Input', { semanticRole: 'form' }),
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

test('resolves the exact Benefits public root and never falls back to NavigationCardView', () => {
  const roots = createFixtureRoots();
  try {
    const catalog = loadGenerationCatalog(roots.designSystemRoot);
    const exact = findComponent(catalog, '🔒 [M] Benefits', 'mobile-web', 'Benefits');
    const wrongRoot = findComponent(catalog, '[M] Benefits', 'mobile-web', 'Benefits');
    assert.equal(exact.id, 'benefits.mobile-web');
    assert.equal(wrongRoot, null);
  } finally {
    fs.rmSync(roots.root, { recursive: true, force: true });
  }
});

test('projects executable technical properties without exposing Figma keys', () => {
  const roots = createFixtureRoots();
  try {
    const availability = inspectGenerationComponentAvailability(
      roots.designSystemRoot,
      ['PromoMainBlock'],
    );
    assert.equal(availability.PromoMainBlock.available, true);
    assert.deepEqual(
      availability.PromoMainBlock.contracts[0].variantProperties,
      { Appearance: ['Light', 'Dark'], Background: ['True', 'False'] },
    );
    assert.equal(JSON.stringify(availability).includes('1'.repeat(40)), false);
    assert.equal('BlurEffect' in availability.PromoMainBlock.contracts[0].variantProperties, false);
    assert.deepEqual(
      availability.PromoMainBlock.contracts[0].semanticTargetProfiles[0].targets.map((target) => target.id),
      ['variant.appearance', 'content.title', 'content.image'],
    );
  } finally {
    fs.rmSync(roots.root, { recursive: true, force: true });
  }
});

test('compiles semantic targets into exact runtime operations', () => {
  const roots = createFixtureRoots();
  try {
    const semantic = readySemanticPlan();
    semantic.nodes.find((node) => node.id === 'main').parentPath = 'slots.body';
    const hero = semantic.nodes.find((node) => node.id === 'hero-component');
    hero.variantProperties = [{ name: 'variant.appearance', value: 'light' }];
    hero.textOverrides = [{ path: 'content.title', value: 'Новый продукт' }];
    const plan = createGenerationPlan(
      { prompt: 'Подготовь лендинг для мобильного веба' },
      semantic,
      roots,
    );
    const main = plan.nodes.find((node) => node.id === 'main');
    const compiledHero = plan.nodes.find((node) => node.id === 'hero-component');
    assert.equal(main.parentPath, '[M] Body');
    assert.equal(main.parentSemanticTarget, 'slots.body');
    assert.deepEqual(compiledHero.variantProperties, [{ name: 'Appearance', value: 'Light' }]);
    assert.deepEqual(compiledHero.textOverrides, [{
      path: 'Content / Title / value',
      occurrence: 0,
      nodeTypes: ['TEXT'],
      semanticTarget: 'content.title',
      value: 'Новый продукт',
    }]);
    assert.ok(
      plan.knowledge.sources.some((source) => source.role === 'semantic-target-map'),
    );
  } finally {
    fs.rmSync(roots.root, { recursive: true, force: true });
  }
});

test('preflight rejects a landing that loses the exact primary action label', () => {
  const roots = createFixtureRoots();
  try {
    const semantic = readySemanticPlan();
    semantic.nodes.find((node) => node.id === 'form-action').textOverrides = [];
    assert.throws(
      () => createGenerationPlan({
        prompt: 'Лендинг для мобильного веба с формой. Ключевое действие — Оставить отзыв',
      }, semantic, roots),
      (error) =>
        error.code === 'GENERATION_PREFLIGHT_FAILED' &&
        error.details.checks.some((check) => check.id === 'action:exact-label' && check.status === 'fail'),
    );
  } finally {
    fs.rmSync(roots.root, { recursive: true, force: true });
  }
});

test('preflight preserves original brief requirements after a clarification answer', () => {
  const roots = createFixtureRoots();
  try {
    const plan = createGenerationPlan({
      prompt: 'Без изображений',
      brief: 'Лендинг для мобильного веба: 3 преимущества, 5 карточек, FAQ и форма. Ключевое действие — Оставить отзыв',
      dialogue: [{ role: 'assistant', text: 'Использовать изображения?' }],
      clarificationRound: 1,
    }, readySemanticPlan(), roots);
    assert.equal(plan.preflight.intent.requirements.benefits, 3);
    assert.equal(plan.preflight.intent.requirements.featureCards, 5);
    assert.equal(plan.preflight.intent.primaryAction, 'Оставить отзыв');
  } finally {
    fs.rmSync(roots.root, { recursive: true, force: true });
  }
});

test('landing compiler enforces CorporateContent body placement and base footer surface', () => {
  const roots = createFixtureRoots();
  try {
    const semantic = readySemanticPlan();
    const main = semantic.nodes.find((node) => node.id === 'main');
    main.parentId = 'screen';
    main.placement = 'append';
    main.parentPath = null;
    const footer = semantic.nodes.find((node) => node.id === 'footer');
    footer.parentId = 'screen';
    footer.fillRole = 'base-alt';
    semantic.nodes.reverse();
    const plan = createGenerationPlan({
      prompt: 'Лендинг для мобильного веба: 3 преимущества, 5 карточек, FAQ и форма. Ключевое действие — Оставить отзыв',
    }, semantic, roots);
    const compiledMain = plan.nodes.find((node) => node.id === 'main');
    const compiledFooter = plan.nodes.find((node) => node.id === 'footer');
    assert.equal(compiledMain.parentId, 'corporate');
    assert.equal(compiledMain.placement, 'replace-slot');
    assert.equal(compiledMain.parentSemanticTarget, 'slots.body');
    assert.equal(compiledFooter.parentId, 'main');
    assert.equal(compiledFooter.fillVariableName, 'base-bg/primary');
    assert.equal(plan.nodes[0].id, 'screen');
    assert.ok(plan.nodes.findIndex((node) => node.id === 'main') < plan.nodes.findIndex((node) => node.id === 'footer'));
  } finally {
    fs.rmSync(roots.root, { recursive: true, force: true });
  }
});

test('desktop landing compiler creates a deterministic five-card bento', () => {
  const semantic = readySemanticPlan({ platform: 'desktop' });
  const normalized = applyPatternCompilerDefaults(semantic);
  const features = normalized.nodes.find((node) => node.semanticRole === 'features');
  const rows = normalized.nodes.filter((node) =>
    node.type === 'frame' && node.parentId === features.id && node.layout === 'horizontal'
  );
  const cards = normalized.nodes.filter((node) => node.semanticRole === 'feature');
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => cards.filter((card) => card.parentId === row.id).length),
    [3, 2],
  );
  for (const card of cards) {
    assert.ok(card.variantProperties.some((property) => property.name === 'variant.size' && property.value === 'small'));
    assert.ok(card.variantProperties.some((property) => property.name === 'variant.image' && property.value === 'none'));
  }
});

test('rejects modal VOC when the request asks for an inline feedback form', () => {
  const roots = createFixtureRoots();
  try {
    const semantic = readySemanticPlan({
      sources: readySemanticPlan().sources.concat(componentSources(['VOC'])),
      nodes: [
        frame('screen', null, 'Форма обратной связи', { width: 390 }),
        component('voc', 'screen', 'VOC', { semanticRole: 'form' }),
      ],
    });
    assert.throws(
      () => createGenerationPlan({ prompt: 'Собери встроенную форму обратной связи' }, semantic, roots),
      (error) => error.code === 'GENERATION_PRESENTATION_MISMATCH',
    );
  } finally {
    fs.rmSync(roots.root, { recursive: true, force: true });
  }
});
