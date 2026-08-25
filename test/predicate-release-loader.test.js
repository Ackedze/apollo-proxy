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
