const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const PROXY_ROOT = path.resolve(__dirname, '..');
const REPOSITORY_ROOT = path.resolve(PROXY_ROOT, '..', '..');
const DESIGN_SYSTEM_ROOT = process.env.DESIGN_SYSTEM_AB_ROOT
  ? path.resolve(process.env.DESIGN_SYSTEM_AB_ROOT)
  : path.join(REPOSITORY_ROOT, 'shared', 'design-system_ab');
const DEFAULT_SOURCE = path.join(
  DESIGN_SYSTEM_ROOT,
  'JSONS'
);
const INDEX_PATH = path.join(
  'apollo',
  'indexes',
  'componentContractIndex.json'
);

function parseArgs(argv) {
  const options = { source: DEFAULT_SOURCE, target: null, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check') options.check = true;
    else if (argument === '--source') options.source = path.resolve(argv[++index]);
    else if (argument === '--target') options.target = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function safeRelativePath(value, label) {
  if (
    typeof value !== 'string' ||
    !value ||
    path.isAbsolute(value) ||
    value.split(/[\\/]+/).includes('..')
  ) {
    throw new Error(`${label} must be a safe relative path: ${value}`);
  }
  return value;
}

async function buildArtifactPlan(sourceRoot, targetRoot = null) {
  const indexFile = path.join(sourceRoot, INDEX_PATH);
  const index = JSON.parse(await fsp.readFile(indexFile, 'utf8'));
  if (index.schemaVersion !== 2 || !Array.isArray(index.packages)) {
    throw new Error('componentContractIndex.json must use schemaVersion 2.');
  }

  const plan = [];
  const targetPaths = new Set();
  for (const packageEntry of index.packages) {
    const packagePath = safeRelativePath(
      packageEntry?.packagePath,
      'packagePath'
    );
    const artifacts = packageEntry?.artifacts;
    if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) {
      throw new Error(`Package ${packageEntry?.componentKey} has no artifacts.`);
    }
    for (const [role, artifactName] of Object.entries(artifacts)) {
      safeRelativePath(artifactName, `artifact ${role}`);
      const relativePath = path.join(packagePath, artifactName);
      const sourcePath = path.resolve(sourceRoot, relativePath);
      if (!sourcePath.startsWith(`${path.resolve(sourceRoot)}${path.sep}`)) {
        throw new Error(`Artifact escapes source root: ${relativePath}`);
      }
      const stat = await fsp.stat(sourcePath).catch(() => null);
      if (!stat?.isFile()) {
        throw new Error(`Required contract artifact is missing: ${relativePath}`);
      }
      if (targetPaths.has(relativePath)) {
        throw new Error(`Duplicate contract artifact target: ${relativePath}`);
      }
      targetPaths.add(relativePath);
      plan.push({
        packageKey: packageEntry.componentKey,
        role,
        relativePath,
        sourcePath,
        targetPath: targetRoot ? path.join(targetRoot, relativePath) : null,
        bytes: stat.size,
      });
    }
    const semanticTargetsRelativePath = path.join(
      packagePath,
      'semantic-targets.json'
    );
    if (!targetPaths.has(semanticTargetsRelativePath)) {
      const semanticTargetsSourcePath = path.resolve(
        sourceRoot,
        semanticTargetsRelativePath
      );
      const semanticTargetsStat = await fsp
        .stat(semanticTargetsSourcePath)
        .catch(() => null);
      if (semanticTargetsStat?.isFile()) {
        targetPaths.add(semanticTargetsRelativePath);
        plan.push({
          packageKey: packageEntry.componentKey,
          role: 'generationSemanticTargets',
          relativePath: semanticTargetsRelativePath,
          sourcePath: semanticTargetsSourcePath,
          targetPath: targetRoot
            ? path.join(targetRoot, semanticTargetsRelativePath)
            : null,
          bytes: semanticTargetsStat.size,
        });
      }
    }
  }
  return { index, plan };
}

async function copyArtifactPlan(plan, targetRoot) {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for (const artifact of plan) {
    await fsp.mkdir(path.dirname(artifact.targetPath), { recursive: true });
    await fsp.copyFile(artifact.sourcePath, artifact.targetPath);
    const content = await fsp.readFile(artifact.targetPath);
    hash.update(artifact.relativePath);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
    bytes += content.length;
  }
  const manifest = {
    schemaVersion: 1,
    packageCount: new Set(plan.map((item) => item.packageKey)).size,
    artifactCount: plan.length,
    bytes,
    checksum: hash.digest('hex'),
  };
  const manifestPath = path.join(
    targetRoot,
    'apollo',
    'contract-knowledge-manifest.json'
  );
  await fsp.mkdir(path.dirname(manifestPath), { recursive: true });
  await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.check && !options.target) {
    throw new Error('--target is required unless --check is used.');
  }
  const { index, plan } = await buildArtifactPlan(
    options.source,
    options.target
  );
  const bytes = plan.reduce((sum, artifact) => sum + artifact.bytes, 0);
  if (options.check) {
    console.log(
      `[Apollo] contract knowledge ready: ${index.packages.length} packages, ${plan.length} artifacts, ${(bytes / 1024 / 1024).toFixed(1)} MB`
    );
    return;
  }
  const manifest = await copyArtifactPlan(plan, options.target);
  console.log(
    `[Apollo] copied ${manifest.packageCount} contract packages (${manifest.artifactCount} artifacts, ${(manifest.bytes / 1024 / 1024).toFixed(1)} MB, ${manifest.checksum.slice(0, 12)})`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { buildArtifactPlan, copyArtifactPlan, parseArgs };
