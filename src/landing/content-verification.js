'use strict';

const { readState } = require('./source-plan');
const componentRoot = 'knowledge/data/ds-ai-hub/products/ab/components/';
const contentRule = 'references/rules/content-and-assets.md';
const recipes = {
  Benefits: [
    'benefits/cookbook/04-compose-cards.md',
    'benefit-card/cookbook/04-graphic-and-surface.md',
  ],
  BentoGrid: [
    'bento-grid/cookbook/04-compose-cards.md',
    'bento-grid/cookbook/06-verify.md',
    'promo-card/cookbook/04-image-and-surface.md',
    'promo-card/cookbook/05-actions-sizing-and-responsive.md',
  ],
};

const nodeId = value => typeof value === 'string' && /^[\w:;-]{1,512}$/.test(value);
const assetKey = value => typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);
const positive = value => Number.isFinite(value) && value > 0;
const same = (a, b) => Math.abs(a - b) <= 1;

function illustrationSlots(ids) {
  return Array.isArray(ids) && ids.every(nodeId) && new Set(ids).size === ids.length ? ids : null;
}

function contentFamilies(instances) {
  if (!Array.isArray(instances) || !instances.every(instance => nodeId(instance?.id) && typeof instance.setName === 'string')) return null;
  const found = {};
  for (const instance of instances) {
    const family = instance.setName.trim().match(/^(?:🔒\s*)?\[[DM]\]\s+(Benefits|BentoGrid)$/)?.[1];
    if (family) found[instance.id] = family;
  }
  return found;
}

function contentInputs(source, families) {
  const rules = source.skill.bodies?.[contentRule];
  if (source.skill.id !== 'ab-generate-custom-landing' || typeof rules !== 'string') return null;
  const names = new Set(Object.values(families || {}));
  const recipesByFamily = Object.fromEntries(Object.entries(recipes).map(([family, paths]) => [
    family, paths.map(file => componentRoot + file),
  ]));
  const sources = [{ id: 'skills/' + source.skill.id + '/' + contentRule, text: rules }];
  const missing = [];
  for (const family of names) {
    for (const id of recipesByFamily[family] || []) {
      let result;
      try { result = source.read({ id, limit: 16000 }); }
      catch (error) {
        if (error.code !== 'LANDING_RESOURCE_INVALID') throw error;
      }
      if (!result?.text || result.offset !== 0 || result.next !== null || result.error || result.tooLarge) {
        missing.push(id);
      } else {
        sources.push({ id, text: result.text });
      }
    }
  }
  return { sources, recipesByFamily, missing };
}

function unfinishedRecipes(source, content, inventory, ledger) {
  if (!inventory) return [];
  const provided = new Set(content.sources.map(doc => doc.id));
  const names = new Set(Object.values(inventory.families));
  const missing = [];
  for (const name of names) {
    for (const id of content.recipesByFamily[name] || []) {
      if (provided.has(id)) continue;
      let row;
      try { row = source.read({ id, limit: 1 }); }
      catch (error) {
        if (error.code !== 'LANDING_RESOURCE_INVALID') throw error;
      }
      if (!row?.sha256 || readState({ file: id, sha256: row.sha256 }, ledger) !== 'read') missing.push(id);
    }
  }
  return missing;
}

const instructions = [
  'Read the provided contentInputs. Before content writes, confirm the current owned root and return instances: [{id,setName}] for the visible library sections using actual Figma component-set names, and illustrationSlotIds: [id] for all visible illustration slots to fill in the agreed structure. Use stable slot node IDs, including slots still showing default art. Read any applicable recipesByFamily not already in sources separately with read_source limit 16000 and follow next. If required guidance is unavailable, report the affected block.',
  'Plan all image slots together. Use the approved art direction and the installed catalogs. After all writes, use a fresh read-only use_figma call to return target and contentReadback taken from the actual visible tree. Measure section-by-section using short facts. Follow the skill rules for confirmed art direction, nested card resizing, and glyph-26 provenance.',
  'Return contentReadback: {imageSlots, groups}. imageSlots lists every visible illustration slot, with {id, variantKey, familyKey, gridVisible, repeatQuote?}. Use the verified actual asset mainComponent key and owning set key (or mainComponent key for a standalone asset). Leave keys null for a default or missing illustration. gridVisible is false when no visible Grid exists. Include repeatQuote only for a verbatim user approval of repeated art in that slot.',
  'groups lists every visible Benefits or BentoGrid instance as {id, family, capacity, cards}. Identify visible cards from their actual nodes, including ancestor visibility. Each card has its actual {id, width, height}. For Benefits also report {verticalSizing, stopperSizing, graphicBottom, graphicKind, graphicId, icon}; graphicKind is icon or image, graphicBottom is the actual Graphic bottom coordinate, icon is null or {variantKey, expectedVariantKey, set, size, expectedSize, gridVisible} verified using the glyph-26 recipe. For image Graphic put graphicId in imageSlots. gridVisible is false when no visible .Grid exists.',
  'For BentoGrid also report {areaWidth, areaHeight, verticalSizing} for each PromoCard and its assigned preset area, plus sizingRecipe when the preset deliberately leaves space below the card. Use final measured values, along with the actual preset modes. Finish with partial if a required slot or check remains unresolved.',
].join(' ');

function verifyContent(readback, inventory, messages) {
  if (!inventory || !Array.isArray(readback?.imageSlots) || !Array.isArray(readback.groups)) return null;
  const { families, slots } = inventory;
  const failures = { images: [], icons: [], sizing: [] };
  const ids = new Set();
  const assets = new Map();
  for (const slot of readback.imageSlots) {
    if (!nodeId(slot?.id) || ids.has(slot.id)) return null;
    ids.add(slot.id);
    if (!assetKey(slot.variantKey) || !assetKey(slot.familyKey) || slot.gridVisible !== false) {
      failures.images.push(slot.id + ' без подтверждённой иллюстрации');
      continue;
    }
    for (const key of new Set([slot.familyKey, slot.variantKey])) {
      const previous = assets.get(key);
      if (previous && !(typeof slot.repeatQuote === 'string' && slot.repeatQuote.trim().length >= 12 &&
          messages.some(message => message.role === 'user' && message.text.includes(slot.repeatQuote)))) {
        const duplicate = previous + ' и ' + slot.id;
        if (!failures.images.includes(duplicate)) failures.images.push(duplicate);
      }
      if (!previous) assets.set(key, slot.id);
    }
  }
  for (const id of slots) if (!ids.has(id)) failures.images.push(id + ' — пропал согласованный слот иллюстрации');
  const seen = new Set();
  for (const group of readback.groups) {
    if (!nodeId(group?.id) || seen.has(group.id) || !Object.hasOwn(families, group.id) ||
        families[group.id] !== group.family || !Array.isArray(group.cards)) return null;
    seen.add(group.id);
    if (!Number.isSafeInteger(group.capacity) || group.capacity < 1 || group.capacity !== group.cards.length) {
      failures.sizing.push(group.id + ' — число видимых карточек расходится с Capacity');
    }
    const cardIds = new Set();
    for (const card of group.cards) {
      if (!nodeId(card?.id) || cardIds.has(card.id) || !positive(card.width) || !positive(card.height)) return null;
      cardIds.add(card.id);
      if (group.family === 'Benefits') {
        if (!nodeId(card.graphicId)) return null;
        if (card.graphicKind === 'icon') {
          const icon = card.icon;
          if (icon?.set !== 'glyph-26' || !assetKey(icon.variantKey) || icon.variantKey !== icon.expectedVariantKey ||
              !positive(icon.size) || icon.size !== icon.expectedSize || icon.gridVisible !== false) {
            failures.icons.push(card.graphicId + ' — иконка glyph-26 в нужном размере не подтверждена');
          }
        } else if (card.graphicKind !== 'image' || !ids.has(card.graphicId)) {
          failures.icons.push(card.graphicId + ' — Graphic не подтверждён');
        }
        const first = group.cards[0];
        if (card.verticalSizing !== 'FILL' || !['FILL', 'FIXED'].includes(card.stopperSizing) ||
            !Number.isFinite(card.graphicBottom) || !same(card.height, first.height) ||
            !same(card.graphicBottom, first.graphicBottom)) {
          failures.sizing.push(card.id + ' — высота, Stopper или положение Graphic расходятся с группой');
        }
      } else {
        if (!positive(card.areaWidth) || !positive(card.areaHeight) || !['FILL', 'HUG', 'FIXED'].includes(card.verticalSizing)) return null;
        if (!same(card.width, card.areaWidth) || card.height > card.areaHeight + 1 ||
            !same(card.height, card.areaHeight) && (card.verticalSizing === 'FILL' ||
              !recipes.BentoGrid.some(file => file.startsWith('bento-grid/') && componentRoot + file === card.sizingRecipe))) {
          failures.sizing.push(card.id + ' — размеры карточки расходятся с областью пресета');
        }
      }
    }
  }
  if (seen.size !== Object.keys(families).length) return null;

  const status = (name, items, evidence) => ({
    name, status: items.length ? 'failed' : 'passed', evidence: (items.join(', ') || evidence).slice(0, 4000),
  });
  return [
    status('Иллюстрации', failures.images, readback.imageSlots.map(slot => slot.id + ' → ' + slot.familyKey).join(', ') || 'Видимых слотов иллюстраций: 0'),
    status('Иконки Benefits', failures.icons, readback.groups.filter(group => group.family === 'Benefits')
      .flatMap(group => group.cards.map(card => card.graphicId + ' → ' + (card.icon?.variantKey || 'изображение'))).join(', ') || 'Компонент Benefits отсутствует'),
    status('Размеры карточек', failures.sizing, readback.groups.flatMap(group =>
      group.cards.map(card => card.id + ' — ' + card.width + '×' + card.height)).join(', ') || 'Компоненты Benefits и BentoGrid отсутствуют'),
  ];
}

module.exports = { contentFamilies, contentInputs, illustrationSlots, instructions, unfinishedRecipes, verifyContent };
