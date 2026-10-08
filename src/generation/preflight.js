const { extractGenerationIntent } = require('./semantic-index');

const PREFLIGHT_SCHEMA_VERSION = 'apollo.generation-preflight.v1';

function normalized(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('ru-RU');
}

function createCheck(id, passed, message, evidence = null) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    message,
    evidence,
  };
}

function fullRequestText(payload) {
  const dialogue = Array.isArray(payload?.dialogue)
    ? payload.dialogue.map((entry) => entry?.text || '').join('\n')
    : '';
  return `${payload?.brief || ''}\n${dialogue}\n${payload?.prompt || ''}`.trim();
}

function variantNumber(node, names) {
  const property = (node.variantProperties || []).find((item) =>
    names.includes(normalized(item.name))
  );
  const value = Number(property?.value);
  return Number.isFinite(value) ? value : null;
}

function hasExactAction(node, action) {
  const target = normalized(action);
  return (node.textOverrides || []).some((override) => normalized(override.value) === target);
}

function runGenerationPreflight(payload, semanticPlan, compiledNodes) {
  const intent = extractGenerationIntent(fullRequestText(payload));
  const semanticNodes = Array.isArray(semanticPlan.nodes) ? semanticPlan.nodes : [];
  const executionNodes = Array.isArray(compiledNodes) ? compiledNodes : semanticNodes;
  const roles = (role) => executionNodes.filter((node) => node.semanticRole === role);
  const components = (semanticComponentId) => executionNodes.filter((node) =>
    node.type === 'component' && node.semanticComponentId === semanticComponentId
  );
  const checks = [];

  const nodeById = new Map(executionNodes.map((node) => [node.id, node]));
  for (const node of executionNodes) {
    if (node.parentId === null) {
      checks.push(createCheck(
        `placement:${node.id}`,
        node.type === 'frame' && node.placement === 'append' && node.parentPath === null,
        'Корневой узел добавляется как обычный frame.',
        { nodeId: node.id, placement: node.placement },
      ));
      continue;
    }
    const parent = nodeById.get(node.parentId);
    const passed = node.placement === 'append'
      ? parent?.type === 'frame' && node.parentPath === null
      : parent?.type === 'component' && typeof node.parentPath === 'string';
    checks.push(createCheck(
      `placement:${node.id}`,
      passed,
      node.placement === 'append'
        ? 'Append-узел имеет frame-родителя.'
        : 'Структурная операция имеет instance-родителя и подтверждённый parentPath.',
      { nodeId: node.id, parentId: node.parentId, placement: node.placement, parentPath: node.parentPath },
    ));
  }

  if (intent.kind === 'landing') {
    for (const role of ['hero', 'main-content', 'footer']) {
      checks.push(createCheck(
        `landing:${role}`,
        roles(role).length >= 1,
        `Лендинг содержит обязательную секцию ${role}.`,
        { count: roles(role).length },
      ));
    }

    const corporate = components('CorporateContent');
    checks.push(createCheck(
      'landing:corporate-content',
      corporate.length === 1,
      'Лендинг использует один библиотечный CorporateContent как оболочку страницы.',
      { count: corporate.length },
    ));
    const mainContent = roles('main-content');
    checks.push(createCheck(
      'landing:corporate-body-slot',
      mainContent.some((node) =>
        node.placement === 'replace-slot' &&
        corporate.some((container) => container.id === node.parentId) &&
        /(?:^|\/)\s*\[?[dm]?\]?\s*body\s*$/i.test(node.parentPath || '')
      ),
      'Основной контент лендинга помещается в Body SLOT CorporateContent.',
      { mainContent: mainContent.map((node) => ({ parentId: node.parentId, placement: node.placement, parentPath: node.parentPath })) },
    ));

    const mainContentIds = new Set(mainContent.map((node) => node.id));
    const mainBlocks = executionNodes.filter((node) =>
      mainContentIds.has(node.parentId) &&
      ['benefits', 'features', 'content'].includes(node.semanticRole)
    );
    checks.push(createCheck(
      'landing:main-content-block-count',
      mainBlocks.length >= 2,
      'Основной контент лендинга содержит минимум два блока, включая Benefits первым.',
      { nodeIds: mainBlocks.map((node) => node.id), roles: mainBlocks.map((node) => node.semanticRole) },
    ));

    const footerFrames = semanticNodes.filter((node) =>
      node.type === 'frame' && node.semanticRole === 'footer'
    );
    checks.push(createCheck(
      'landing:footer-surface',
      footerFrames.every((node) => node.fillRole !== 'base-alt' && node.fillRole !== 'modal-alt'),
      'Футер с FAQ не получает дополнительную серую поверхность.',
      { footerFillRoles: footerFrames.map((node) => node.fillRole) },
    ));

    if (intent.platform === 'mobile-web') {
      const buttonStacks = components('ButtonStack');
      checks.push(createCheck(
        'landing:mobile-button-stack',
        buttonStacks.some((node) =>
          node.placement === 'swap-instance' && node.semanticRole === 'primary-action'
        ),
        'Мобильный hero заменяет вложенный ButtonGroup на библиотечный ButtonStack.',
        { nodes: buttonStacks.map((node) => ({ id: node.id, placement: node.placement, parentPath: node.parentPath })) },
      ));
    }
  }

  const requestedBenefits = intent.requirements.benefits;
  if (requestedBenefits !== null) {
    const explicitBenefits = roles('benefit').length;
    const wrapperCapacities = components('Benefits').map((node) =>
      variantNumber(node, ['capacity', 'количество', 'count'])
    ).filter((value) => value !== null);
    checks.push(createCheck(
      'content:benefit-count',
      explicitBenefits === requestedBenefits || wrapperCapacities.includes(requestedBenefits),
      `План явно обеспечивает ${requestedBenefits} преимуществ.`,
      { requested: requestedBenefits, explicitBenefits, wrapperCapacities },
    ));
  }

  const requestedFeatures = intent.requirements.featureCards;
  if (requestedFeatures !== null) {
    checks.push(createCheck(
      'content:feature-card-count',
      roles('feature').length === requestedFeatures,
      `План содержит ровно ${requestedFeatures} карточек ключевых особенностей.`,
      { requested: requestedFeatures, actual: roles('feature').length },
    ));
    if (intent.platform === 'desktop' && requestedFeatures === 5) {
      const featureContainers = roles('features').filter((node) => node.type === 'frame');
      const featureContainerIds = new Set(featureContainers.map((node) => node.id));
      const featureHeadings = components('TitleView').filter((node) =>
        featureContainerIds.has(node.parentId) &&
        (node.textOverrides || []).some((override) =>
          normalized(override.value) === 'ключевые особенности'
        )
      );
      checks.push(createCheck(
        'content:feature-heading',
        featureHeadings.length >= 1,
        'Блок карточек имеет явный заголовок «Ключевые особенности».',
        { nodeIds: featureHeadings.map((node) => node.id) },
      ));

      const rows = executionNodes.filter((node) =>
        node.type === 'frame' &&
        featureContainerIds.has(node.parentId) &&
        node.layout === 'horizontal'
      );
      const rowCardCounts = rows.map((row) => roles('feature').filter((node) => node.parentId === row.id).length);
      checks.push(createCheck(
        'content:feature-bento-3-2',
        rows.length === 2 && rowCardCounts[0] === 3 && rowCardCounts[1] === 2,
        'Пять PromoCard собраны в desktop bento 3+2.',
        { rowIds: rows.map((row) => row.id), rowCardCounts },
      ));
    }
  }

  if (intent.requirements.faq) {
    checks.push(createCheck(
      'content:faq',
      roles('faq').length >= 1 && components('FAQ').length >= 1,
      'План содержит библиотечный FAQ.',
      { roleCount: roles('faq').length, componentCount: components('FAQ').length },
    ));
    const faqHeadings = executionNodes.filter((node) =>
      node.type === 'component' &&
      node.semanticComponentId === 'TitleView' &&
      (node.textOverrides || []).some((override) => normalized(override.value) === 'частые вопросы')
    );
    checks.push(createCheck(
      'content:faq-heading',
      faqHeadings.length >= 1,
      'Перед FAQ явно создан заголовок «Частые вопросы».',
      { nodeIds: faqHeadings.map((node) => node.id) },
    ));
  }

  if (intent.requirements.form) {
    const modalForms = executionNodes.filter((node) =>
      node.semanticRole === 'form' &&
      compiledNodes.some((compiled) => compiled.id === node.id && compiled.presentation === 'modal')
    );
    checks.push(createCheck(
      'form:presentation',
      intent.requirements.formPresentation === 'modal'
        ? roles('form').length >= 1
        : roles('form').length >= 1 && components('VOC').length === 0 && modalForms.length === 0,
      intent.requirements.formPresentation === 'modal'
        ? 'План содержит запрошенную модальную форму.'
        : 'Форма встроена в страницу и не использует модальный VOC.',
      { formCount: roles('form').length, vocCount: components('VOC').length, modalFormIds: modalForms.map((node) => node.id) },
    ));
  }

  if (intent.primaryAction) {
    const actions = executionNodes.filter((node) => hasExactAction(node, intent.primaryAction));
    const matchingActions = actions;
    const expectedMinimum = intent.kind === 'landing' && intent.requirements.form ? 2 : 1;
    checks.push(createCheck(
      'action:exact-label',
      matchingActions.length >= expectedMinimum,
      `Главное действие «${intent.primaryAction}» задано явно во всех ключевых точках.`,
      { expectedMinimum, matchingNodeIds: matchingActions.map((node) => node.id) },
    ));
  }

  const failed = checks.filter((check) => check.status === 'fail');
  const report = {
    schemaVersion: PREFLIGHT_SCHEMA_VERSION,
    status: failed.length ? 'failed' : 'passed',
    intent,
    checks,
  };
  if (failed.length) {
    const error = new Error(`План генерации не прошёл предгенерационную проверку: ${failed.map((check) => check.message).join(' ')}`);
    error.code = 'GENERATION_PREFLIGHT_FAILED';
    error.status = 422;
    error.details = report;
    throw error;
  }
  return report;
}

module.exports = {
  PREFLIGHT_SCHEMA_VERSION,
  runGenerationPreflight,
};
