const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const designSystemRoot = path.resolve(__dirname, '../../../shared/design-system_ab');
const hubRoot = path.resolve(__dirname, '../../../ds-ai-hub');
const crosswalkPath = path.join(designSystemRoot, 'apollo/rule-crosswalk.json');

function hasRuleId(value, ruleId) {
  if (Array.isArray(value)) return value.some((item) => hasRuleId(item, ruleId));
  if (!value || typeof value !== 'object') return false;
  if (value.ruleId === ruleId) return true;
  return Object.values(value).some((item) => hasRuleId(item, ruleId));
}

test('rule crosswalk links Apollo rules to verifiable human evidence without ID duplication', () => {
  const crosswalk = JSON.parse(fs.readFileSync(crosswalkPath, 'utf8'));
  assert.equal(crosswalk.schemaVersion, 'apollo.rule-crosswalk.v2');
  assert.ok(Array.isArray(crosswalk.entries));
  assert.ok(crosswalk.documents && typeof crosswalk.documents === 'object');

  const allowedRelations = new Set([
    'exact',
    'semantic-equivalent',
    'semantic-support',
    'technical-only',
    'conflict',
  ]);
  const seenApolloRuleIds = new Set();

  for (const entry of crosswalk.entries) {
    assert.match(entry.apolloRuleId, /.+/u);
    assert.equal(seenApolloRuleIds.has(entry.apolloRuleId), false, `duplicate ${entry.apolloRuleId}`);
    seenApolloRuleIds.add(entry.apolloRuleId);
    assert.ok(allowedRelations.has(entry.relation), `unsupported relation ${entry.relation}`);
    assert.ok(['verified', 'conflict'].includes(entry.review.status));
    assert.ok(Array.isArray(entry.hubEvidence));
    if (entry.relation === 'technical-only') assert.equal(entry.hubEvidence.length, 0);
    if (entry.relation === 'conflict') {
      assert.equal(entry.review.status, 'conflict');
      assert.ok(entry.hubEvidence.length >= 2);
    }

    const source = JSON.parse(fs.readFileSync(path.join(designSystemRoot, entry.apolloSource), 'utf8'));
    assert.equal(
      hasRuleId(source, entry.apolloRuleId),
      true,
      `${entry.apolloRuleId} is absent from ${entry.apolloSource}`,
    );

    for (const evidence of entry.hubEvidence) {
      const document = crosswalk.documents[evidence.document];
      assert.ok(document, `unknown hub document ${evidence.document}`);
      const hubDocument = fs.readFileSync(path.join(hubRoot, document.path), 'utf8');
      if (evidence.kind === 'named-rule') {
        assert.ok(
          hubDocument.includes(`ruleId: ${evidence.ruleId}`),
          `${evidence.ruleId} is absent from ${document.path}`,
        );
      }
      assert.ok(hubDocument.includes(evidence.heading), `${evidence.heading} is absent from ${document.path}`);
    }
  }

  const amountStyles = JSON.parse(fs.readFileSync(
    path.join(designSystemRoot, 'JSONS/web/components/web-corp/AmountStyles/rules.json'),
    'utf8',
  ));
  const expectedAmountStylesRuleIds = new Set(amountStyles.manual.rules.map((rule) => rule.ruleId));
  const mappedAmountStylesRuleIds = new Set(
    crosswalk.entries
      .filter((entry) => entry.apolloSource === 'JSONS/web/components/web-corp/AmountStyles/rules.json')
      .map((entry) => entry.apolloRuleId),
  );
  assert.deepEqual(mappedAmountStylesRuleIds, expectedAmountStylesRuleIds);

  const contentCardWrapper = JSON.parse(fs.readFileSync(
    path.join(designSystemRoot, 'JSONS/web/components/web-corp/ContentCardWrapper/rules.json'),
    'utf8',
  ));
  const expectedContentCardWrapperRuleIds = new Set(
    contentCardWrapper.manual.rules.map((rule) => rule.ruleId),
  );
  const mappedContentCardWrapperRuleIds = new Set(
    crosswalk.entries
      .filter((entry) => entry.apolloSource === 'JSONS/web/components/web-corp/ContentCardWrapper/rules.json')
      .map((entry) => entry.apolloRuleId),
  );
  assert.deepEqual(mappedContentCardWrapperRuleIds, expectedContentCardWrapperRuleIds);

  const filterCompanySelect = JSON.parse(fs.readFileSync(
    path.join(designSystemRoot, 'JSONS/web/components/web-corp/FilterCompanySelect/rules.json'),
    'utf8',
  ));
  const expectedFilterCompanySelectRuleIds = new Set(
    filterCompanySelect.manual.rules.map((rule) => rule.ruleId),
  );
  const mappedFilterCompanySelectRuleIds = new Set(
    crosswalk.entries
      .filter((entry) => entry.apolloSource === 'JSONS/web/components/web-corp/FilterCompanySelect/rules.json')
      .map((entry) => entry.apolloRuleId),
  );
  assert.deepEqual(mappedFilterCompanySelectRuleIds, expectedFilterCompanySelectRuleIds);

  const projection = crosswalk.projections?.filterCompanySelect;
  assert.equal(projection?.readiness, 'draft');
  assert.equal(projection?.humanRuleRoutes?.length, 21);
  assert.deepEqual(
    projection.retiredApolloRuleIds,
    ['component:web-corp.filter-company-select.selected-value-content'],
  );
});
