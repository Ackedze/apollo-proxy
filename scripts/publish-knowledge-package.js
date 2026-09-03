#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
const { buildKnowledgePackage } = require('./build-knowledge-package');
const { downloadFile, sha256File, validateChannelDescriptor } = require('../src/knowledge-package');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ENV_PATH = path.join(REPOSITORY_ROOT, '.env.knowledge-publish');
const STABLE_DESCRIPTOR_PATH = 'apollo/knowledge/channels/stable.json';

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run' || argument === '--skip-gates' || argument === '--allow-dirty') {
      options[argument.slice(2)] = true;
      continue;
    }
    if (!argument.startsWith('--') || index + 1 >= argv.length) throw new Error(`Invalid argument: ${argument}`);
    options[argument.slice(2)] = argv[++index];
  }
  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || REPOSITORY_ROOT,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return result;
}

function git(root, args, options = {}) {
  return run('git', ['-C', root, ...args], options);
}

function resolveSourceRoot(explicit, environmentValue, fallback) {
  const candidate = explicit || environmentValue || fallback;
  if (!candidate || !fs.existsSync(candidate)) throw new Error(`Knowledge source does not exist: ${candidate || '<not configured>'}`);
  return path.resolve(candidate);
}

function normalizeGitHubRepository(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value || '')) {
    throw new Error('GitHub repository must use owner/name format.');
  }
  return value;
}

function githubReleaseTag(contentVersion) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(contentVersion || '')) throw new Error('Unsafe knowledge contentVersion.');
  return `apollo-knowledge-${contentVersion}`;
}

function githubReleaseBaseUrl(repository, tag) {
  return `https://github.com/${normalizeGitHubRepository(repository)}/releases/download/${encodeURIComponent(tag)}`;
}

function githubRawDescriptorUrl(repository, branch = 'main') {
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..')) throw new Error('Unsafe GitHub branch.');
  return `https://raw.githubusercontent.com/${normalizeGitHubRepository(repository)}/${branch}/${STABLE_DESCRIPTOR_PATH}`;
}

function parseGitCredential(output) {
  const fields = Object.fromEntries(
    String(output || '').split(/\r?\n/).filter(Boolean).map((line) => {
      const separator = line.indexOf('=');
      return separator > 0 ? [line.slice(0, separator), line.slice(separator + 1)] : [line, ''];
    })
  );
  return fields.password || null;
}

function resolveGitHubEnvironment() {
  if (process.env.GH_TOKEN) return { GH_TOKEN: process.env.GH_TOKEN };
  if (process.env.GITHUB_TOKEN) return { GH_TOKEN: process.env.GITHUB_TOKEN };
  const credential = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const token = credential.status === 0 ? parseGitCredential(credential.stdout) : null;
  if (!token) {
    throw new Error('GitHub write credential is unavailable. Run gh auth login or configure the Git credential helper.');
  }
  return { GH_TOKEN: token };
}

function runApolloGates(designRoot, hubRoot) {
  run('npm', ['test'], {
    inherit: true,
    env: {
      CODEX_DESIGN_SYSTEM: designRoot,
      DESIGN_SYSTEM_AB_ROOT: designRoot,
      CODEX_DS_AI_HUB: hubRoot,
      DS_AI_HUB_ROOT: hubRoot,
    },
  });
}

async function buildReproducibly({ designRoot, hubRoot, output, baseUrl, allowDirty = false }) {
  const firstOutput = path.join(output, 'build-a');
  const secondOutput = path.join(output, 'build-b');
  await Promise.all([
    fsp.rm(firstOutput, { recursive: true, force: true }),
    fsp.rm(secondOutput, { recursive: true, force: true }),
  ]);
  const buildOptions = {
    'design-system-root': designRoot,
    'ds-ai-hub-root': hubRoot,
    channel: 'stable',
    minEngine: '1.0.1',
    maxEngine: '1.0.1',
    'base-url': baseUrl,
    'require-clean': !allowDirty,
  };
  const built = await buildKnowledgePackage({ ...buildOptions, output: firstOutput });
  const repeated = await buildKnowledgePackage({ ...buildOptions, output: secondOutput });
  const [firstDigest, secondDigest] = await Promise.all([
    sha256File(built.tarball),
    sha256File(repeated.tarball),
  ]);
  if (firstDigest !== secondDigest || built.manifest.contentVersion !== repeated.manifest.contentVersion) {
    throw new Error('Knowledge package build is not reproducible; nothing was published.');
  }
  return { ...built, descriptorPath: path.join(firstOutput, 'latest-stable.json') };
}

async function verifyPublishedTarball(descriptor, expectedTarball) {
  validateChannelDescriptor(descriptor);
  const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'apollo-knowledge-release-verify-'));
  const target = path.join(temporaryRoot, 'release.tgz');
  try {
    const expected = await sha256File(expectedTarball);
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await fsp.rm(target, { force: true });
        await downloadFile(descriptor.tarballUrl, target);
        const actual = await sha256File(target);
        if (actual !== expected) throw new Error('Downloaded GitHub Release asset checksum does not match the built tarball.');
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
    throw lastError;
  } finally {
    await fsp.rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function writeDescriptorAtomic(designRoot, descriptor) {
  const target = path.join(designRoot, STABLE_DESCRIPTOR_PATH);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${crypto.randomUUID()}`;
  await fsp.writeFile(temporary, `${JSON.stringify(descriptor, null, 2)}\n`);
  await fsp.rename(temporary, target);
  return target;
}

async function publishGitHubRelease({ designRoot, repository, branch, built }) {
  const contentVersion = built.manifest.contentVersion;
  const tag = githubReleaseTag(contentVersion);
  const designCommit = built.manifest.sourceCommits['design-system_ab'];
  const assetName = path.basename(built.tarball);
  const descriptor = JSON.parse(await fsp.readFile(built.descriptorPath, 'utf8'));
  const githubEnvironment = resolveGitHubEnvironment();
  git(designRoot, ['fetch', 'origin', branch]);
  const localHead = git(designRoot, ['rev-parse', 'HEAD']).stdout.trim();
  const remoteCommit = git(designRoot, ['rev-parse', `origin/${branch}`]).stdout.trim();
  if (localHead !== remoteCommit) {
    throw new Error(`design-system_ab HEAD ${localHead} is not origin/${branch} ${remoteCommit}; nothing was published.`);
  }
  const existing = run('gh', ['release', 'view', tag, '--repo', repository, '--json', 'tagName,assets'], {
    allowFailure: true,
    env: githubEnvironment,
  });
  if (existing.status !== 0) {
    const releaseLookupError = `${existing.stderr || ''}\n${existing.stdout || ''}`;
    if (!/release not found|HTTP 404/i.test(releaseLookupError)) {
      throw new Error(`Unable to check GitHub Release ${tag}: ${releaseLookupError.trim()}`);
    }
    run('gh', [
      'release', 'create', tag, built.tarball,
      '--repo', repository,
      '--target', designCommit,
      '--title', `Apollo knowledge ${contentVersion}`,
      '--notes', `Data-only Apollo knowledge package. design-system_ab=${designCommit}; ds-ai-hub=${built.manifest.sourceCommits['ds-ai-hub']}`,
      '--latest=false',
    ], { env: githubEnvironment });
  } else {
    const release = JSON.parse(existing.stdout);
    if (!release.assets?.some((asset) => asset.name === assetName)) {
      run('gh', ['release', 'upload', tag, built.tarball, '--repo', repository], { env: githubEnvironment });
    }
  }
  await verifyPublishedTarball(descriptor, built.tarball);
  const descriptorTarget = await writeDescriptorAtomic(designRoot, descriptor);
  git(designRoot, ['add', STABLE_DESCRIPTOR_PATH]);
  const descriptorChanged = git(designRoot, ['diff', '--cached', '--quiet', '--', STABLE_DESCRIPTOR_PATH], { allowFailure: true });
  if (descriptorChanged.status === 1) {
    git(designRoot, ['commit', '-m', `chore(apollo): publish knowledge ${contentVersion}`]);
    git(designRoot, ['push', 'origin', branch]);
  } else if (descriptorChanged.status !== 0) {
    throw new Error('Unable to determine whether the stable descriptor changed.');
  }
  return {
    contentVersion,
    tag,
    tarballUrl: descriptor.tarballUrl,
    descriptorUrl: githubRawDescriptorUrl(repository, branch),
    descriptorPath: descriptorTarget,
  };
}

async function main() {
  const preliminary = parseArgs(process.argv.slice(2));
  dotenv.config({ path: preliminary.env ? path.resolve(preliminary.env) : DEFAULT_ENV_PATH, quiet: true });
  const options = parseArgs(process.argv.slice(2));
  const designRoot = resolveSourceRoot(
    options['design-system-root'],
    process.env.DESIGN_SYSTEM_AB_ROOT || process.env.CODEX_DESIGN_SYSTEM,
    path.resolve(REPOSITORY_ROOT, '../../shared/design-system_ab')
  );
  const hubRoot = resolveSourceRoot(
    options['ds-ai-hub-root'],
    process.env.DS_AI_HUB_ROOT || process.env.CODEX_DS_AI_HUB,
    path.resolve(REPOSITORY_ROOT, '../../ds-ai-hub')
  );
  const repository = normalizeGitHubRepository(
    options.repository || process.env.APOLLO_KNOWLEDGE_GITHUB_REPOSITORY || 'Ackedze/design-system_ab'
  );
  const branch = options.branch || process.env.APOLLO_KNOWLEDGE_GITHUB_BRANCH || 'main';
  const output = path.resolve(options.output || path.join(REPOSITORY_ROOT, 'dist/knowledge-publish'));
  const designTopLevel = git(designRoot, ['rev-parse', '--show-toplevel']).stdout.trim();
  if (path.resolve(designTopLevel) !== designRoot) throw new Error('design-system-root must be the Git repository root.');
  if (!options['allow-dirty'] && git(designRoot, ['status', '--porcelain']).stdout.trim()) {
    throw new Error('design-system_ab must be clean before publishing.');
  }
  if (!options['allow-dirty'] && git(hubRoot, ['status', '--porcelain']).stdout.trim()) {
    throw new Error('ds-ai-hub must be clean before publishing.');
  }
  if (git(designRoot, ['branch', '--show-current']).stdout.trim() !== branch) {
    throw new Error(`design-system_ab must be checked out on ${branch}.`);
  }
  if (!options['skip-gates']) runApolloGates(designRoot, hubRoot);

  const designCommit = git(designRoot, ['rev-parse', 'HEAD']).stdout.trim();
  const hubCommit = git(hubRoot, ['rev-parse', 'HEAD']).stdout.trim();
  const provisionalVersion = `ds-${designCommit.slice(0, 12)}.hub-${hubCommit.slice(0, 12)}`;
  const provisionalTag = githubReleaseTag(provisionalVersion);
  let built = await buildReproducibly({
    designRoot,
    hubRoot,
    output,
    baseUrl: githubReleaseBaseUrl(repository, provisionalTag),
    allowDirty: options['allow-dirty'],
  });
  const actualTag = githubReleaseTag(built.manifest.contentVersion);
  if (actualTag !== provisionalTag) {
    built = await buildReproducibly({
      designRoot,
      hubRoot,
      output,
      baseUrl: githubReleaseBaseUrl(repository, actualTag),
      allowDirty: options['allow-dirty'],
    });
  }
  if (options['dry-run']) {
    console.log(JSON.stringify({
      success: true,
      dryRun: true,
      contentVersion: built.manifest.contentVersion,
      tag: githubReleaseTag(built.manifest.contentVersion),
      tarball: built.tarball,
      descriptorUrl: githubRawDescriptorUrl(repository, branch),
    }));
    return;
  }
  const published = await publishGitHubRelease({ designRoot, repository, branch, built });
  console.log(JSON.stringify({ success: true, ...published }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  buildReproducibly,
  githubRawDescriptorUrl,
  githubReleaseBaseUrl,
  githubReleaseTag,
  normalizeGitHubRepository,
  parseArgs,
  parseGitCredential,
  publishGitHubRelease,
  resolveGitHubEnvironment,
  writeDescriptorAtomic,
};
