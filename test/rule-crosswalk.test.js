const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const designSystemRoot = process.env.DESIGN_SYSTEM_AB_ROOT
  ? path.resolve(process.env.DESIGN_SYSTEM_AB_ROOT)
  : path.resolve(__dirname, '../../../shared/design-system_ab');
const hubRoot = process.env.DS_AI_HUB_ROOT
  ? path.resolve(process.env.DS_AI_HUB_ROOT)
  : path.resolve(__dirname, '../../../ds-ai-hub');
const crosswalkPath = path.join(designSystemRoot, 'apollo/rule-crosswalk.json');

function hasRuleId(value, ruleId) {
  if (Array.isArray(value)) return value.some((item) => hasRuleId(item, ruleId));
  if (!value || typeof value !== 'object') return false;
  if (value.ruleId === ruleId) return true;
  return Object.values(value).some((item) => hasRuleId(item, ruleId));
}

function assertCanonicalLinks(crosswalk, readSource, readHub) {
  const checked = [];
  for (const entry of crosswalk.entries.filter((row) => row.canonicalRuleId)) {
    const id = entry.canonicalRuleId;
    assert.equal(entry.apolloRuleId, id, 'Apollo and canonical norm IDs differ');
    assert.ok(['exact', 'semantic-equivalent'].includes(entry.relation));
    assert.equal(entry.review.status, 'verified');
    const named = entry.hubEvidence.filter((row) => row.kind === 'named-rule');
    assert.equal(named.length, 1, 'Canonical norm needs one unambiguous named Hub rule');
    assert.equal(named[0].ruleId, id, 'Hub and canonical norm IDs differ');
    const hub = readHub(crosswalk.documents[named[0].document].path);
    assert.equal(hub.split('\n').filter((line) => line.trim() === `- ruleId: ${id}`).length, 1, 'Canonical Hub ID is missing or duplicated');
    assert.ok(hub.includes(named[0].heading));
    const source = readSource(entry.apolloSource);
    assert.ok(hasRuleId(source, id), 'Canonical ID is absent from executable norms');
    for (const alias of entry.legacyApolloRuleIds || []) {
      assert.notEqual(alias, id);
      assert.equal(hasRuleId(source, alias), false, 'Legacy alias is still an active norm');
      assert.equal((source.manual?.executionPolicy?.predicateRules || []).includes(alias), false, 'Legacy alias remains in execution policy');
    }
    assert.ok(entry.executionSources?.length, 'Canonical norm has no checked execution binding');
    for (const execution of entry.executionSources) {
      assert.equal(execution.kind, 'v3-composition');
      const body = readSource(execution.path);
      const contracts = body.runtime?.contracts || body.manual?.contracts || body.contracts || [];
      for (const alias of entry.legacyApolloRuleIds || []) {
        assert.equal(contracts.some((contract) => (contract.constraints || []).some((constraint) =>
          constraint.ruleId === alias || `${contract.id}.${constraint.id}` === alias)), false, 'Legacy alias remains in an execution binding');
      }
      const matches = contracts.flatMap((contract) => (contract.constraints || [])
        .filter((constraint) => constraint.ruleId === id).map((constraint) => `${contract.id}.${constraint.id}`));
      assert.deepEqual(matches, [id], 'V3 output ID differs from the canonical norm ID');
    }
    checked.push(id);
  }
  return checked;
}

test('canonical TitleView norm ID agrees with Hub, executable norm and current V3 binding', () => {
  const crosswalk = JSON.parse(fs.readFileSync(crosswalkPath, 'utf8'));
  const checked = assertCanonicalLinks(crosswalk,
    (file) => JSON.parse(fs.readFileSync(path.join(designSystemRoot, file), 'utf8')),
    (file) => fs.readFileSync(path.join(hubRoot, file), 'utf8'));
  assert.ok(checked.includes('rule:components.title-view.status-color-consistency'));
});

test('canonical guard rejects drift, ambiguous Hub IDs and an active legacy duplicate', () => {
  const id = 'rule:fixture.peer.equal';
  const valid = { documents: { fixture: { path: 'fixture.md' } }, entries: [{
    apolloRuleId: id, canonicalRuleId: id, legacyApolloRuleIds: ['old.fixture.equal'],
    apolloSource: 'rules.json', relation: 'exact', review: { status: 'verified' },
    hubEvidence: [{ kind: 'named-rule', document: 'fixture', heading: 'Rule 1', ruleId: id }],
    executionSources: [{ kind: 'v3-composition', path: 'composition.json' }],
  }] };
  const files = { 'rules.json': { manual: { rules: [{ ruleId: id }] } },
    'composition.json': { manual: { contracts: [{ id: 'rule:fixture.peer', constraints: [{ id: 'equal', ruleId: id }] }] } } };
  const text = `### Rule 1\n- ruleId: ${id}\n`;
  assert.deepEqual(assertCanonicalLinks(valid, (file) => files[file], () => text), [id]);
  for (const change of [
    (x) => { x.entries[0].apolloRuleId = 'wrong'; },
    (x) => { x.entries[0].hubEvidence[0].ruleId = 'wrong'; },
    (x) => { x.entries[0].relation = 'semantic-support'; },
    (x) => { x.entries[0].review.status = 'draft'; },
    (x) => { x.entries[0].hubEvidence.push(x.entries[0].hubEvidence[0]); },
  ]) {
    const candidate = structuredClone(valid); change(candidate);
    assert.throws(() => assertCanonicalLinks(candidate, (file) => files[file], () => text));
  }
  assert.throws(() => assertCanonicalLinks(valid, (file) => files[file], () => '### Rule 1\n'));
  assert.throws(() => assertCanonicalLinks(valid, (file) => files[file], () => text + text));
  const duplicate = structuredClone(files); duplicate['rules.json'].manual.rules.push({ ruleId: 'old.fixture.equal' });
  assert.throws(() => assertCanonicalLinks(valid, (file) => duplicate[file], () => text));
  const stalePolicy = structuredClone(files); stalePolicy['rules.json'].manual.executionPolicy = { predicateRules: ['old.fixture.equal'] };
  assert.throws(() => assertCanonicalLinks(valid, (file) => stalePolicy[file], () => text));
  const wrongOutput = structuredClone(files); wrongOutput['composition.json'].manual.contracts[0].id = 'old.fixture';
  assert.throws(() => assertCanonicalLinks(valid, (file) => wrongOutput[file], () => text));
  const oldBinding = structuredClone(files); oldBinding['composition.json'].manual.contracts.push({ id: 'old.fixture', constraints: [{ id: 'equal', ruleId: 'old.fixture.equal' }] });
  assert.throws(() => assertCanonicalLinks(valid, (file) => oldBinding[file], () => text));
});

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
    assert.ok(['draft', 'verified', 'conflict'].includes(entry.review.status));
    assert.ok(entry.review.basis, `${entry.apolloRuleId} has no review basis`);
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

  const promoMainBlock = JSON.parse(fs.readFileSync(
    path.join(
      designSystemRoot,
      'JSONS/web/components/web-corp-promo/PromoMainBlock/rules.json',
    ),
    'utf8',
  ));
  const expectedPromoMainBlockRuleIds = new Set(
    promoMainBlock.manual.rules.map((rule) => rule.ruleId),
  );
  const mappedPromoMainBlockRuleIds = new Set(
    crosswalk.entries
      .filter((entry) => (
        entry.apolloSource
        === 'JSONS/web/components/web-corp-promo/PromoMainBlock/rules.json'
      ))
      .map((entry) => entry.apolloRuleId),
  );
  assert.deepEqual(mappedPromoMainBlockRuleIds, expectedPromoMainBlockRuleIds);

  const projection = crosswalk.projections?.filterCompanySelect;
  assert.equal(projection?.readiness, 'draft');
  assert.equal(projection?.humanRuleRoutes?.length, 21);
  assert.deepEqual(
    projection.retiredApolloRuleIds,
    ['component:web-corp.filter-company-select.selected-value-content'],
  );

  const promoProjection = crosswalk.projections?.promoMainBlock;
  assert.equal(promoProjection?.readiness, 'ready');
  assert.equal(promoProjection?.humanRuleRoutes?.length, 25);
  assert.equal(promoProjection?.scenarioRules?.owner, 'landingPagesPattern');
});
