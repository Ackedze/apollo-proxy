#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const safe = file => typeof file === 'string' && file.length > 0 && !path.isAbsolute(file) &&
  !/[\\\x00-\x1f]/.test(file) && file.split('/').every(part => part && part !== '.' && part !== '..');

function sourceOf(value) {
  const url = new URL(value);
  const match = /^\/([\w.-]+)\/([\w.-]+)\/([\w.-]+)\/(.+\.json)$/.exec(url.pathname);
  if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com' || url.port || url.username || url.password || url.search || url.hash || !match || !safe(match[4])) throw Error('Use the Git raw URL of the data index.');
  return { owner: match[1], repo: match[2], ref: match[3], file: match[4] };
}

async function get(url, token, request, raw = false) {
  const response = await request(url, { headers: { Accept: raw ? 'application/octet-stream' : 'application/x-git-upload-pack-advertisement',
    'User-Agent': 'ApolloProxyControl', 'Cache-Control': 'no-cache', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    redirect: 'error', signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error('Git data request failed with HTTP ' + response.status);
  return response;
}

function contentUrl(source, commit, file) {
  return 'https://raw.githubusercontent.com/' + source.owner + '/' + source.repo + '/' + commit + '/' +
    file.split('/').map(encodeURIComponent).join('/');
}

function advertisedCommit(bytes, ref) {
  let found;
  for (let offset = 0; offset < bytes.length;) {
    const header = bytes.subarray(offset, offset + 4).toString();
    if (!/^[a-f0-9]{4}$/i.test(header)) throw Error('Invalid Git reference advertisement.');
    const size = parseInt(header, 16);
    if (size === 0) { offset += 4; continue; }
    if (size < 4 || offset + size > bytes.length) throw Error('Truncated Git reference advertisement.');
    const line = bytes.subarray(offset + 4, offset + size).toString().split('\0')[0].trimEnd();
    const match = /^([a-f0-9]{40}) (.+)$/.exec(line);
    if (match?.[2] === 'refs/heads/' + ref) {
      if (found) throw Error('Ambiguous Git branch identity.');
      found = match[1];
    }
    offset += size;
  }
  if (!found) throw Error('Git branch not found.');
  return found;
}

async function readGitIndex(url, runtimeId, token, request = fetch) {
  const source = sourceOf(url);
  const refs = await get('https://github.com/' + source.owner + '/' + source.repo + '.git/info/refs?service=git-upload-pack', token, request);
  const commit = advertisedCommit(Buffer.from(await refs.arrayBuffer()), source.ref);
  const index = await (await get(contentUrl(source, commit, source.file), token, request, true)).json();
  if (index.schemaVersion !== 'apollo.git-data-index.v1' || index.runtimeId !== runtimeId ||
      !safe(index.snapshot?.path) || !index.snapshot.path.endsWith('.tgz') ||
      !/^[a-f0-9]{64}$/.test(index.snapshot.sha256 || '') || !/^[a-f0-9]{64}$/.test(index.snapshot.dataId || '') ||
      !Number.isSafeInteger(index.snapshot.bytes) || index.snapshot.bytes < 1 || index.snapshot.bytes > 100 * 1024 * 1024) throw Error('Git data index is invalid or incompatible with this runtime.');
  if(index.skills!==undefined && (!index.skills || Object.keys(index.skills).sort().join(',')!=='bytes,path,sha256' || index.skills.path!=='apollo/skills/manifest.json'
    || !/^[a-f0-9]{64}$/.test(index.skills.sha256||'') || !Number.isSafeInteger(index.skills.bytes) || index.skills.bytes<1 || index.skills.bytes>65536))throw Error('Git skill catalog reference is invalid.');
  return { source, commit, index };
}

async function pinnedBytes(selected,pin,token,request){
  const response=await get(contentUrl(selected.source,selected.commit,pin.path),token,request,true);
  const parts=[];let length=0;
  for await(const part of response.body){length+=part.length;if(length>pin.bytes)throw Error('Git asset exceeds its declared size.');parts.push(part);}
  const bytes=Buffer.concat(parts);if(length!==pin.bytes||sha(bytes)!==pin.sha256)throw Error('Git asset checksum/size mismatch.');
  return bytes;
}
async function downloadSkills(selected,temporary,token,request){
  const catalog=require('../src/skills/catalog'),root=path.join(temporary,'skill-source'),ref=selected.index.skills;
  await fs.mkdir(root);
  const body=await pinnedBytes(selected,ref,token,request),entry=catalog.catalogEntry(body);
  const prefix=path.posix.dirname(ref.path);
  const descriptor=await pinnedBytes(selected,{...entry,path:prefix+'/'+entry.path},token,request);
  const files=catalog.packageFiles(descriptor);
  async function save(file,bytes){const target=path.join(root,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{flag:'wx',mode:0o600});}
  await save('manifest.json',body);await save(entry.path,descriptor);
  for(const pin of files)await save(catalog.ID+'/'+pin.path,await pinnedBytes(selected,{...pin,path:prefix+'/'+catalog.ID+'/'+pin.path},token,request));
  const admitted=catalog.readCatalog(root);if(admitted.sha256!==ref.sha256)throw Error('Git skill catalog identity mismatch.');admitted.assertCurrent();
  return root;
}

function tar(args) {
  const result = spawnSync('/usr/bin/tar', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, LC_ALL: 'C.UTF-8', COPYFILE_DISABLE: '1' } });
  if (result.status !== 0) throw Error('Data archive operation failed: ' + (result.stderr || result.error?.message || '').slice(0, 300));
  return result.stdout;
}

function extractSnapshot(archive, destination) {
  for (const name of tar(['-tzf', archive]).split(/\r?\n/).filter(Boolean)) {
    const file = name.replace(/^\.\//, '').replace(/\/$/, '');
    if (file && !safe(file)) throw Error('Unsafe snapshot member.');
  }
  if (tar(['-tvzf', archive]).split(/\r?\n/).filter(Boolean).some(line => !['-', 'd'].includes(line[0]))) throw Error('Snapshot may contain only regular files and directories.');
  tar(['-xzf', archive, '-C', destination, '--no-same-owner', '--exclude=._*',
    ...(process.platform === 'darwin' ? ['--no-mac-metadata'] : [])]);
}

async function updateFromGit({ settings, ensured, url, token, command, producerRoot, request = fetch }) {
  const releases = require(path.join(producerRoot, 'src/data-release'));
  const runtime = releases.readRuntime(settings.runtimeRoot);
  const selected = await readGitIndex(url, runtime.id, token, request);
  const snapshot = selected.index.snapshot;
  const installed=selected.index.skills ? releases.readReleaseFiles(ensured.state.current.path,settings.runtimeRoot) : null;
  const updateAvailable = snapshot.dataId !== ensured.state.current.dataId || Boolean(selected.index.skills && selected.index.skills.sha256!==installed.skillsSourceSha256);
  const extra = { updateAvailable, descriptor: { contentVersion: snapshot.dataId }, sourceCommit: selected.commit };
  if (command === 'check' || !updateAvailable) return releases.publicStatus(ensured.state, extra);
  const temporary = await fs.mkdtemp(path.join(settings.storeRoot, '.git-update-'));
  try {
    console.error(JSON.stringify({ phase: 'downloading' }));
    let data;
    if(snapshot.dataId!==ensured.state.current.dataId){
      const bytes=await pinnedBytes(selected,snapshot,token,request);
      const archive=path.join(temporary,'contracts.tgz');data=path.join(temporary,'contracts');
      await fs.writeFile(archive,bytes,{flag:'wx'});await fs.mkdir(data);extractSnapshot(archive,data);
    }else data=path.join(ensured.state.current.path,'contracts');
    const currentManifest=installed || releases.readReleaseFiles(ensured.state.current.path,settings.runtimeRoot);
    const currentSkills=path.join(ensured.state.current.path,'skills');
    const skillsRoot=selected.index.skills ? await downloadSkills(selected,temporary,token,request)
      : await fs.stat(currentSkills).then(s=>s.isDirectory()?currentSkills:undefined).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
    console.error(JSON.stringify({ phase: 'validating' }));
    const packages = require(path.join(producerRoot, 'src/data-packages'));
    const checked = packages.readGenerationData({ root: data, apolloRoot: settings.runtimeRoot });
    if (checked.index.id !== snapshot.dataId || checked.index.deliveryProfile !== 'checking-ask-figma-mcp') throw Error('Git snapshot identity/profile mismatch.');
    checked.assertCurrent();
    const { buildDataRelease } = require(path.join(producerRoot, 'scripts/build-data-release.js'));
    const old = process.env.COPYFILE_DISABLE; process.env.COPYFILE_DISABLE = '1';
    let built;
    try {
      built = await buildDataRelease({ dataRoot: data, knowledgeRoot: path.join(ensured.state.current.path, 'knowledge'),
        skillsRoot,skillsSourceSha256:selected.index.skills?.sha256 || currentManifest.skillsSourceSha256,
        runtimeRoot: settings.runtimeRoot, output: path.join(temporary, 'release'), profile: 'checking-ask-figma-mcp',
        tarballUrl: 'https://github.com/' + selected.source.owner + '/' + selected.source.repo + '/tree/' + selected.commit + '/{version}' });
    } finally { if (old === undefined) delete process.env.COPYFILE_DISABLE; else process.env.COPYFILE_DISABLE = old; }
    if (built.manifest.dataId !== snapshot.dataId) throw Error('Local packaging changed the Git data identity.');
    if(selected.index.skills && built.manifest.skillsSourceSha256!==selected.index.skills.sha256)throw Error('Local packaging changed the Git skill identity.');
    if ((await releases.readState(settings.storeRoot)).current.contentVersion !== ensured.state.current.contentVersion) throw Error('Installed data changed during Git download; check again.');
    const state = await releases.installTarball({ ...settings, tarballPath: built.tarballPath,
      expectedIntegrity: built.descriptor.tarballIntegrity, expectedContentVersion: built.manifest.id });
    return releases.publicStatus(state, { ...extra, updateAvailable: false, updated: true });
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

async function runCommand(command, options) {
  const producerRoot = path.resolve(process.env.APOLLO_DATA_PRODUCER_ROOT || path.join(__dirname, '..'));
  const releases = require(path.join(producerRoot, 'src/data-release'));
  const settings = { storeRoot: path.resolve(options.store), seedRoot: path.resolve(options.seed), runtimeRoot: path.resolve(options.runtime) };
  const ensured = await releases.ensureStore(settings);
  if (['ensure', 'status', 'run'].includes(command)) return releases.publicStatus(ensured.state, { recovered: ensured.recovered });
  if (command === 'rollback') return releases.publicStatus(await releases.rollbackStore(settings), { rolledBack: true });
  const url = options.descriptor || process.env.APOLLO_DATA_DESCRIPTOR_URL || require(path.join(producerRoot, 'src/portable-runtime')).readSettings().dataDescriptorUrl;
  if (!url) throw Error('Configure the Git raw URL of the data index.');
  const token = process.env.APOLLO_DATA_TOKEN;
  if (new URL(url).hostname === 'raw.githubusercontent.com' && new URL(url).pathname.endsWith('/data-packages/current.json')) return updateFromGit({ settings, ensured, url, token, command, producerRoot });
  // Preserve the existing full-release updater for previously configured installations.
  const knowledge = require(path.join(producerRoot, 'src/knowledge-package'));
  const descriptor = releases.validateDescriptor(await knowledge.fetchJson(url, token), releases.readRuntime(settings.runtimeRoot));
  const updateAvailable = descriptor.contentVersion !== ensured.state.current.contentVersion;
  if (command === 'check' || !updateAvailable) return releases.publicStatus(ensured.state, { updateAvailable, descriptor });
  const temporary = path.join(settings.storeRoot, '.download-' + crypto.randomUUID() + '.tgz');
  try {
    console.error(JSON.stringify({ phase: 'downloading' }));
    await knowledge.downloadFile(descriptor.tarballUrl, temporary, token);
    console.error(JSON.stringify({ phase: 'validating' }));
    const state = await releases.installTarball({ ...settings, tarballPath: temporary, expectedIntegrity: descriptor.tarballIntegrity, expectedContentVersion: descriptor.contentVersion });
    return releases.publicStatus(state, { updateAvailable: false, updated: true, descriptor });
  } finally { await fs.rm(temporary, { force: true }); }
}

async function main(argv) {
  const [command, ...args] = argv, options = {};
  if (!['ensure', 'status', 'check', 'update', 'rollback', 'run'].includes(command)) throw Error('Unknown data command.');
  for (let i = 0; i < args.length; i += 2) {
    if (!['--store', '--seed', '--runtime', '--descriptor', '--engine'].includes(args[i]) || !args[i + 1]) throw Error('Invalid data argument.');
    options[args[i].slice(2)] = args[i + 1];
  }
  for (const key of ['store', 'seed', 'runtime']) if (!options[key]) throw Error('--' + key + ' is required.');
  const status = await runCommand(command, options);
  if (command !== 'run') { console.log(JSON.stringify(status)); return; }
  const root = path.resolve(__dirname, '..');
  const env = { ...process.env, APOLLO_PROJECT_ROOT: path.resolve(options.runtime), APOLLO_DATA_ROOT: status.dataRoot,
    APOLLO_RELEASE_ROOT: status.releaseRoot, CODEX_DESIGN_SYSTEM: status.designSystemRoot, CODEX_DS_AI_HUB: status.dsAiHubRoot,
    APOLLO_KNOWLEDGE_CONTENT_VERSION: status.current.knowledgeVersion,
    APOLLO_KNOWLEDGE_DESIGN_SYSTEM_COMMIT: status.current.sourceCommits['design-system_ab'],
    APOLLO_KNOWLEDGE_DS_AI_HUB_COMMIT: status.current.sourceCommits['ds-ai-hub'] };
  const child = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, env, stdio: 'inherit' });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.log(JSON.stringify({ success: false, code: error.code || 'GIT_DATA_UPDATE_FAILED', error: error.message })); process.exitCode = 1; });
module.exports = { sourceOf, contentUrl, advertisedCommit, readGitIndex, extractSnapshot, updateFromGit, runCommand };
