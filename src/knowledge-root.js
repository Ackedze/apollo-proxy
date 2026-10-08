const fs = require('node:fs');
const path = require('node:path');

function incompleteRoot() {
  const error = new Error('Selected knowledge root is incomplete or invalid.');
  error.code = 'CODEX_KNOWLEDGE_INCOMPLETE';
  error.status = 503;
  return error;
}

function isDirectory(root, relative) {
  return fs.statSync(path.join(root, relative), { throwIfNoEntry: false })?.isDirectory() === true;
}

function hasMarkdown(root, relative) {
  return isDirectory(root, relative) && fs.readdirSync(path.join(root, relative), { withFileTypes: true })
    .some(entry => entry.isFile() && entry.name.endsWith('.md'));
}

function readJson(root, relative) {
  const file = path.join(root, relative);
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) throw incompleteRoot();
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Structural prerequisites only. Managed package integrity and source authority
// still belong to the existing release validator and audit readers.
function isCompleteKnowledgeRoot(root, kind) {
  try {
    if (kind === 'design-system_ab') {
      const index = readJson(root, 'JSONS/apollo/indexes/componentContractIndex.json');
      const catalog = readJson(root, 'JSONS/apollo/designPatternRules.json');
      const dictionary = readJson(root, 'redpolrules/dictionary.json');
      return index?.schemaVersion === 2 && Array.isArray(index.packages) && index.packages.length > 0
        && Array.isArray(catalog?.rules) && Array.isArray(dictionary?.rules)
        && hasMarkdown(root, 'patterns');
    }
    if (kind === 'ds-ai-hub') {
      return isDirectory(root, 'products/ab/components')
        && isDirectory(root, 'core/web/components')
        && hasMarkdown(root, 'products/ab/patterns');
    }
    return false;
  } catch {
    return false;
  }
}

function isLocalComponentProjection(root, kind) {
  if (kind !== 'design-system_ab') return false;
  try {
    const manifest = readJson(root, 'apollo/contract-knowledge-manifest.json');
    return manifest?.schemaVersion === 1 && Number.isInteger(manifest.packageCount)
      && manifest.packageCount > 0 && isDirectory(root, 'web')
      && !['JSONS', 'patterns', 'redpolrules'].some(relative => fs.existsSync(path.join(root, relative)));
  } catch {
    return false;
  }
}

function resolveKnowledgeRoot({ kind, configuredRoot, bundledRoot, checkoutRoot }) {
  // Explicit/current release priority is immutable. Readiness validates it
  // before use; isolated v4 routes do not depend on legacy knowledge roots.
  if (configuredRoot) return path.resolve(configuredRoot);
  if (isCompleteKnowledgeRoot(bundledRoot, kind)) return path.resolve(bundledRoot);
  // Only the known component-only local projection may be skipped. A broken
  // full/release-looking tree must not silently switch to checkout knowledge.
  if (fs.existsSync(bundledRoot) && !isLocalComponentProjection(bundledRoot, kind)) throw incompleteRoot();
  if (isCompleteKnowledgeRoot(checkoutRoot, kind)) return path.resolve(checkoutRoot);
  throw incompleteRoot();
}

function assertCompleteKnowledgeRoot(root, kind) {
  if (!isCompleteKnowledgeRoot(root, kind)) throw incompleteRoot();
}

module.exports = { resolveKnowledgeRoot, assertCompleteKnowledgeRoot, isCompleteKnowledgeRoot };
