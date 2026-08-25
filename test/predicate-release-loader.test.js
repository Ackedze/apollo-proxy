const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadPredicateRelease } = require('../src/predicate-engine/release-loader');

const designSystemRoot = path.resolve(__dirname, '../../../shared/design-system_ab');

test('predicate release resolves canonical Figma keys and pins source checksums', () => {
  const release = loadPredicateRelease(designSystemRoot, [
    'f05915599f71e822fd8b46a2b2509a2e395005cf',
    '0012e7a5e420b87136b910b29578a4d06e6dd30c',
    '0b1fd301e14ae7dab9eb62de83c8f4b8d9eab376',
    '0fb58a88030651af939c278b544143643cdd1223',
    '6e9a72189d150779165acb1dde3a800b92daa2f9',
    'af607289bf050cc8236b882039cf787d32296383',
    '1043a9208a949b1af3f708637de5fd13721a4519',
    '7b188529df2fdf9c6e93989b2173f6cc95fc77d6',
    'b0e271a2c5e94e00b753d223c1bce95b87da95af',
    '0ccaf9d784aa8b603d6229a898f46433ee74b925',
    'd115bb68174c21fe7475748dc31f651221db4558',
    '1e8647f2b51a623083755fdad5c677fc38770e3e',
    '26b847ef2dadd62ff9728ab50c728f6c7dcef455',
    'a54fc8de49f424f46ddb87e1f14103cda8a5456e',
  ]);
  assert.equal(release.release.knowledgeSource, 'design-system_ab');
  assert.equal(release.release.checksum.length, 64);
  assert.equal(release.sourceChecksums.buttonsGroupComposition.length, 64);
  assert.equal(release.sourceChecksums.titleViewRules.length, 64);
  assert.equal(release.sourceChecksums.buttonPattern.length, 64);
  assert.equal(release.sourceChecksums.benefitsRules.length, 64);
  assert.equal(release.sourceChecksums.tableViewRules.length, 64);

  const buttonsGroup = release.componentIndex.f05915599f71e822fd8b46a2b2509a2e395005cf;
  assert.equal(buttonsGroup.identity, 'web-corp.buttons-group');
  assert.equal(buttonsGroup.lifecycle, 'active');
  assert.equal(buttonsGroup.library, 'Web _ Corp Components');

  const button = release.componentIndex['0012e7a5e420b87136b910b29578a4d06e6dd30c'];
  assert.equal(button.identity, 'web-core.button');

  const benefits = release.componentIndex['0b1fd301e14ae7dab9eb62de83c8f4b8d9eab376'];
  assert.equal(benefits.identity, 'web.benefits');
  const benefitCard = release.componentIndex['0fb58a88030651af939c278b544143643cdd1223'];
  assert.equal(benefitCard.identity, 'web.benefit-card');
  const tableView = release.componentIndex['6e9a72189d150779165acb1dde3a800b92daa2f9'];
  assert.equal(tableView.identity, 'web-corp.table-view');
  assert.equal(tableView.family, 'table-view-horizontal');
  const tableRow = release.componentIndex.af607289bf050cc8236b882039cf787d32296383;
  assert.equal(tableRow.family, 'row');
  const accountItemSum = release.componentIndex['7b188529df2fdf9c6e93989b2173f6cc95fc77d6'];
  const accountItemNumber = release.componentIndex['b0e271a2c5e94e00b753d223c1bce95b87da95af'];
  assert.equal(accountItemSum.identity, 'web-corp.account-select');
  assert.equal(accountItemNumber.identity, 'web-corp.account-select');
  assert.equal(accountItemSum.family, 'account-item');
  assert.equal(accountItemNumber.family, 'account-item');
  const cardSwiper360 = release.componentIndex['0ccaf9d784aa8b603d6229a898f46433ee74b925'];
  const cardSwiper320 = release.componentIndex.d115bb68174c21fe7475748dc31f651221db4558;
  assert.equal(cardSwiper360.identity, 'web-corp.card-swiper-mobile');
  assert.equal(cardSwiper320.identity, 'web-corp.card-swiper-mobile');
  assert.equal(cardSwiper360.family, 'card-swiper-mobile');
  assert.equal(cardSwiper320.family, 'card-swiper-mobile');
  const accountSelectContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.account-select.public-roots-only'
  ));
  assert.deepEqual(accountSelectContour, {
    schemaVersion: 'apollo.contour-definition.v1',
    kind: 'public-root',
    identity: 'web-corp.account-select',
    familyFact: 'component.family',
    allowedFamilies: ['account-option-list-content'],
    presentation: {
      schemaVersion: 'apollo.predicate-presentation.v1',
      title: 'Служебный компонент AccountSelect используется отдельно',
      observed: '{{actual}} размещён как самостоятельный компонент.',
      expectation: 'Самостоятельно допускается использовать только {{expected}}.',
      action: 'Заменить {{actual}} на {{expected}}.',
      valueLabels: {
        'account-item': 'AccountItem',
        'account-option-list-content': 'AccountOptionListContent',
      },
    },
    scope: { platform: ['desktop', 'mobile-web'] },
    unknownPolicy: 'not-evaluable',
    ruleId: 'component:web-corp.account-select.public-roots-only',
    revision: 1,
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp/AccountSelect/rules.json',
    sourceChecksum: accountSelectContour.sourceChecksum,
    sourceAnchor: 'rules/component:web-corp.account-select.public-roots-only',
    authorityStatus: 'active',
    provenance: 'design-system-author',
    severity: 'error',
  });
  assert.equal(accountSelectContour.sourceChecksum.length, 64);

  const accountSelectUniformContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.account-select.list-content-is-uniform'
  ));
  assert.deepEqual(accountSelectUniformContour, {
    schemaVersion: 'apollo.contour-definition.v1',
    kind: 'uniform-allowed-collection',
    identity: 'web-corp.account-select',
    where: [{
      predicate: 'equals',
      actual: { fact: 'component.family' },
      expected: { literal: 'account-option-list-content' },
    }],
    allowedValues: ['Sum', 'Number'],
    minimumCount: 1,
    query: {
      from: 'subject',
      traverse: 'descendants',
      where: [{
        predicate: 'equals',
        actual: { fact: 'component.family' },
        expected: { literal: 'account-item' },
      }],
      project: { fact: 'component.properties.Type' },
    },
    presentation: {
      schemaVersion: 'apollo.predicate-presentation.v1',
      title: 'Строки AccountSelect используют разные или недопустимые типы',
      observed: 'В AccountSelect обнаружены значения AccountItem.Type: {{actual}}.',
      expectation: 'В списке должна быть хотя бы одна строка; все строки используют одинаковый Type=Sum или Type=Number.',
      action: 'Выбрать для всех строк один допустимый Type: Sum или Number.',
      targetFact: 'component.properties.Type',
    },
    scope: { platform: ['desktop', 'mobile-web'] },
    unknownPolicy: 'not-evaluable',
    ruleId: 'component:web-corp.account-select.list-content-is-uniform',
    revision: 1,
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp/AccountSelect/rules.json',
    sourceChecksum: accountSelectUniformContour.sourceChecksum,
    sourceAnchor: 'rules/component:web-corp.account-select.list-content-is-uniform',
    authorityStatus: 'active',
    provenance: 'design-system-author',
    severity: 'error',
  });
  assert.equal(accountSelectUniformContour.sourceChecksum.length, 64);

  const cardSwiperBreakpointContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.card-swiper-mobile.screen-size-follows-viewport'
  ));
  assert.deepEqual(cardSwiperBreakpointContour, {
    schemaVersion: 'apollo.contour-definition.v1',
    kind: 'breakpoint-map',
    identity: 'web-corp.card-swiper-mobile',
    widthFact: 'page.context.viewportWidth',
    targetFact: 'component.properties.Screen Size',
    ranges: [{
      lower: 320,
      upper: 359,
      bounds: 'inclusive',
      expected: '320-360',
    }, {
      lower: 360,
      expected: '360+',
    }],
    presentation: {
      schemaVersion: 'apollo.predicate-presentation.v1',
      title: 'Screen Size не соответствует ширине страницы',
      observed: 'При ширине {{context}} px выбран Screen Size={{actual}}.',
      expectation: 'При ширине 320–359 px используется Screen Size=320-360; при ширине от 360 px — Screen Size=360+.',
      action: 'Выбрать Screen Size, соответствующий ширине страницы.',
      contextFact: 'page.context.viewportWidth',
      targetFact: 'component.properties.Screen Size',
    },
    scope: { platform: ['mobile-web'] },
    unknownPolicy: 'not-evaluable',
    ruleId: 'component:web-corp.card-swiper-mobile.screen-size-follows-viewport',
    revision: 1,
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp/CardSwiperMobile [M]/rules.json',
    sourceChecksum: cardSwiperBreakpointContour.sourceChecksum,
    sourceAnchor: 'rules/component:web-corp.card-swiper-mobile.screen-size-follows-viewport',
    authorityStatus: 'active',
    provenance: 'design-system-author',
    severity: 'error',
  });
  assert.equal(cardSwiperBreakpointContour.sourceChecksum.length, 64);

  const benefitsSizingContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web.benefits.fill-width-hug-height'
  ));
  assert.deepEqual(benefitsSizingContour, {
    schemaVersion: 'apollo.contour-definition.v1',
    kind: 'sizing',
    identity: 'web.benefits',
    expectations: {
      'layout.sizingHorizontal': 'FILL',
      'layout.sizingVertical': 'HUG',
    },
    presentation: {
      schemaVersion: 'apollo.predicate-presentation.v1',
      title: 'Sizing компонента Benefits изменён',
      observed: 'Размер корня Benefits не соответствует контракту Fill по ширине и Hug по высоте.',
      expectation: 'Корень Benefits должен использовать Fill container по ширине и Hug contents по высоте.',
      action: 'Установить для Benefits ширину Fill и высоту Hug.',
    },
    scope: { platform: ['desktop', 'mobile-web'] },
    unknownPolicy: 'not-evaluable',
    ruleId: 'component:web.benefits.fill-width-hug-height',
    revision: 1,
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp-promo/Benefits/rules.json',
    sourceChecksum: benefitsSizingContour.sourceChecksum,
    sourceAnchor: 'rules/component:web.benefits.fill-width-hug-height',
    authorityStatus: 'active',
    provenance: 'design-system-author',
    severity: 'error',
  });
  assert.equal(benefitsSizingContour.sourceChecksum.length, 64);

  const statusShapeContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.status-property.shape-is-fixed-by-preset'
  ));
  assert.deepEqual(statusShapeContour, {
    schemaVersion: 'apollo.contour-definition.v1',
    kind: 'context-map',
    identity: 'web-core.status',
    where: [{
      predicate: 'equals',
      actual: { fact: 'ownership.owner.component.identity' },
      expected: { literal: 'web-corp.status-property' },
    }, {
      predicate: 'one-of',
      actual: { fact: 'ownership.owner.component.family' },
      expected: { literal: ['status-preset', 'property-preset'] },
    }],
    contextFact: 'ownership.owner.component.family',
    targetFact: 'component.properties.Shape',
    mapping: {
      'status-preset': 'Rounded',
      'property-preset': 'Rectangular',
    },
    presentation: {
      schemaVersion: 'apollo.predicate-presentation.v1',
      title: 'Форма Status не соответствует preset',
      observed: 'Внутри {{contextLabel}} у Status выбран Shape={{actual}}.',
      expectation: 'Форма вложенного Status должна соответствовать preset: Shape={{expected}}.',
      action: 'Вернуть Shape={{expected}}.',
      contextLabels: {
        'status-preset': 'StatusPreset',
        'property-preset': 'PropertyPreset',
      },
    },
    scope: { platform: ['desktop', 'mobile-web'] },
    unknownPolicy: 'not-evaluable',
    ruleId: 'component:web-corp.status-property.shape-is-fixed-by-preset',
    revision: 1,
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp/Status & Property/rules.json',
    sourceChecksum: statusShapeContour.sourceChecksum,
    sourceAnchor: 'rules/component:web-corp.status-property.shape-is-fixed-by-preset',
    authorityStatus: 'active',
    provenance: 'design-system-author',
    severity: 'error',
  });
  assert.equal(statusShapeContour.sourceChecksum.length, 64);
});
