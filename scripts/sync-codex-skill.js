const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const PROXY_ROOT = path.resolve(__dirname, '..');
const REPOSITORY_ROOT = path.resolve(PROXY_ROOT, '..', '..');
const SKILL_NAME = 'apollo-design-validator';
const SOURCE_ROOT = path.join(
  REPOSITORY_ROOT,
  'projects',
  'Apollo-v2',
  '.agents',
  'skills',
  SKILL_NAME
);
const TARGET_ROOT = path.join(
  PROXY_ROOT,
  'codex-workspace',
  '.agents',
  'skills',
  SKILL_NAME
);

function listFiles(root, directory = root) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(root, absolutePath));
    else if (entry.isFile()) files.push(path.relative(root, absolutePath));
  }
  return files.sort();
}

function checksum(root) {
  const hash = crypto.createHash('sha256');
  for (const relativePath of listFiles(root)) {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, relativePath)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function validateStructuredOutputSchema(node, location = '#') {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  if (
    Object.prototype.hasOwnProperty.call(node, 'const') &&
    !Object.prototype.hasOwnProperty.call(node, 'type')
  ) {
    throw new Error(`Structured Output const is missing type at ${location}`);
  }
  if (Array.isArray(node.enum) && !Object.prototype.hasOwnProperty.call(node, 'type')) {
    throw new Error(`Structured Output enum is missing type at ${location}`);
  }
  if (node.type === 'object') {
    if (node.additionalProperties !== false) {
      throw new Error(
        `Structured Output object must set additionalProperties=false at ${location}`
      );
    }
    const propertyNames = Object.keys(node.properties || {});
    const requiredNames = Array.isArray(node.required) ? node.required : [];
    const missingRequired = propertyNames.filter(
      (propertyName) => !requiredNames.includes(propertyName)
    );
    if (missingRequired.length) {
      throw new Error(
        `Structured Output properties must be required at ${location}: ${missingRequired.join(', ')}`
      );
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' || key === '$defs') {
      for (const [childKey, childValue] of Object.entries(value || {})) {
        validateStructuredOutputSchema(childValue, `${location}/${key}/${childKey}`);
      }
    } else if (key === 'items') {
      validateStructuredOutputSchema(value, `${location}/items`);
    }
  }
}

async function main() {
  if (!fs.existsSync(path.join(SOURCE_ROOT, 'SKILL.md'))) {
    throw new Error(`Canonical Apollo skill is missing: ${SOURCE_ROOT}`);
  }

  const responseSchemaPath = path.join(
    SOURCE_ROOT,
    'references',
    'audit-response.schema.json'
  );
  const responseSchema = JSON.parse(await fsp.readFile(responseSchemaPath, 'utf8'));
  validateStructuredOutputSchema(responseSchema);

  await fsp.rm(TARGET_ROOT, { recursive: true, force: true });
  await fsp.mkdir(path.dirname(TARGET_ROOT), { recursive: true });
  await fsp.cp(SOURCE_ROOT, TARGET_ROOT, { recursive: true, force: true });

  const sourceChecksum = checksum(SOURCE_ROOT);
  const targetChecksum = checksum(TARGET_ROOT);
  if (sourceChecksum !== targetChecksum) {
    throw new Error('Apollo skill copy checksum mismatch.');
  }

  console.log(
    `[Apollo] synced ${SKILL_NAME} (${sourceChecksum.slice(0, 12)})`
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
