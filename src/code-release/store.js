'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {sha, idOf, verifyFiles} = require('../data-release');
const {extractSnapshot} = require('../../scripts/git-data-cli');

const SCHEMA = 'apollo.proxy-code-release.v1';
const STORE_SCHEMA = 'apollo.proxy-code-store.v1';
const MANIFEST = 'code-release.json';
const BOOTSTRAP_MODULES=['src/code-release/store.js','src/code-release/git.js','src/code-release/supervisor.js'];
const SCHEMAS=['schemas/apollo-predicate-capabilities.v1.json','schemas/apollo-generation-semantic-plan.schema.json'];
const fail = code => { throw Object.assign(Error(code), {code}); };
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const allowedFile = file => typeof file === 'string' && !/[\\\x00-\x1f]/.test(file)
  && file.split('/').every(p => p && p !== '.' && p !== '..')
  && !BOOTSTRAP_MODULES.includes(file)
  && (['server.js','package.json','recipes/catalog.json','scripts/list-agent-models.js',...SCHEMAS].includes(file)
    || /^src\/.+\.(js|json|md)$/.test(file));
const record = manifest => ({id:manifest.id, version:manifest.version});
function compatibility(home) {
  const deps = json(path.join(home,'package.json')).dependencies || {};
  return {launcher:1, node:process.versions.node, platform:process.platform,
    dependencies:sha(JSON.stringify(Object.fromEntries(Object.entries(deps).sort()))),
    lock:sha(fs.readFileSync(path.join(home,'package-lock.json'))),
    installed:sha(fs.readFileSync(path.join(home,'node_modules/.package-lock.json')))};
}
function validateManifest(m, profile) {
  if (m?.schemaVersion !== SCHEMA || m.id !== idOf(m) || !/^[a-f0-9]{64}$/.test(m.id)
    || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(m.version || '') || m.version.length > 80
    || m.sourceCommit !== null && !/^[a-f0-9]{40}$/.test(m.sourceCommit || '')
    || !Array.isArray(m.files) || !m.files.length || m.files.length > 2000
    || !m.files.some(p => p.file === 'server.js') || !m.files.some(p => p.file === 'package.json')
    || m.files.some(p => !allowedFile(p.file) || !Number.isSafeInteger(p.bytes) || p.bytes<0 || !/^[a-f0-9]{64}$/.test(p.sha256 || ''))
    || new Set(m.files.map(p=>p.file)).size !== m.files.length
    || m.files.reduce((n,p) => n + p.bytes, 0) > 32*1024*1024) fail('CODE_MANIFEST_INVALID');
  if (JSON.stringify(m.compatibility) !== JSON.stringify(profile)) fail('CODE_INCOMPATIBLE');
  return m;
}
function walk(root, prefix = '') {
  return fs.readdirSync(path.join(root,prefix), {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry => {
    const file = prefix ? prefix+'/'+entry.name : entry.name;
    if (entry.isSymbolicLink()) fail('CODE_PAYLOAD_UNSAFE');
    if (entry.isDirectory()) return walk(root,file);
    if (!entry.isFile()) fail('CODE_PAYLOAD_UNSAFE');
    return [file];
  });
}
function readRelease(root, profile) {
  const m = validateManifest(json(path.join(root,MANIFEST)),profile);
  const seen = verifyFiles(root,m.files);
  const deps=json(path.join(root,'package.json')).dependencies || {};
  if(sha(JSON.stringify(Object.fromEntries(Object.entries(deps).sort()))) !== profile.dependencies)fail('CODE_INCOMPATIBLE');
  if (walk(root).some(file => file !== MANIFEST && !seen.has(file))) fail('CODE_PAYLOAD_EXTRA_FILE');
  return m;
}
function versionRoot(store, id) {
  if (!/^[a-f0-9]{64}$/.test(id || '')) fail('CODE_STATE_INVALID');
  return path.join(store,'versions',id);
}
function versionManifest(store,id,profile) {
  const manifest=readRelease(versionRoot(store,id),profile);
  if(manifest.id!==id)fail('CODE_RELEASE_ID_MISMATCH');
  return manifest;
}
function codeFiles(root) {
  const files = ['server.js','package.json'];
  for (const name of ['recipes/catalog.json','scripts/list-agent-models.js']) if (fs.existsSync(path.join(root,name))) files.push(name);
  for(const name of SCHEMAS)if(fs.existsSync(path.join(root,name)))files.push(name);
  if (fs.existsSync(path.join(root,'src'))) files.push(...walk(path.join(root,'src')).map(f=>'src/'+f));
  if (files.some(file => !allowedFile(file) && !BOOTSTRAP_MODULES.includes(file))) fail('CODE_PAYLOAD_UNSAFE');
  return files.filter(allowedFile).sort();
}
async function writeState(store, state) {
  const tmp = path.join(store,'.state-'+crypto.randomUUID());
  const handle = await fsp.open(tmp,'wx',0o600);
  try { await handle.writeFile(JSON.stringify(state,null,2)+'\n'); await handle.sync(); }
  finally { await handle.close(); }
  try { await fsp.rename(tmp,path.join(store,'state.json')); }
  finally { await fsp.rm(tmp,{force:true}); }
}
function readState(store) {
  const state = json(path.join(store,'state.json'));
  if (state.schemaVersion !== STORE_SCHEMA || !state.current ||
      [state.current,state.previous,state.pending].filter(Boolean).some(r => !/^[a-f0-9]{64}$/.test(r.id || '') || typeof r.version !== 'string')) fail('CODE_STATE_INVALID');
  return state;
}
async function withLock(store, action) {
  await fsp.mkdir(store,{recursive:true,mode:0o700});
  if (fs.realpathSync(store) !== path.resolve(store)) fail('CODE_STORE_UNSAFE');
  const file = path.join(store,'.update.lock');
  let lock;
  for (let attempt=0; attempt<2; attempt++) {
    try { lock = await fsp.open(file,'wx',0o600); await lock.writeFile(JSON.stringify({pid:process.pid})); break; }
    catch (error) {
      if (lock) { await lock.close(); await fsp.unlink(file); throw error; }
      if (error.code !== 'EEXIST') throw error;
      const stat = await fsp.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) fail('CODE_STORE_UNSAFE');
      let pid; try { pid = JSON.parse(await fsp.readFile(file,'utf8')).pid; } catch {}
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid,0); fail('CODE_UPDATE_BUSY'); } catch(e) { if(e.code !== 'ESRCH') throw e; }
      } else if (Date.now()-stat.mtimeMs < 60000) fail('CODE_UPDATE_BUSY');
      if ((await fsp.lstat(file)).ino !== stat.ino) fail('CODE_UPDATE_BUSY');
      await fsp.unlink(file);
    }
  }
  if (!lock) fail('CODE_UPDATE_BUSY');
  try { return await action(); } finally { await lock.close(); await fsp.unlink(file); }
}
async function snapshotCode({sourceRoot, destination, version, sourceCommit = null, profile, fileNames = codeFiles(sourceRoot), read = file => fs.readFileSync(path.join(sourceRoot,file))}) {
  await fsp.mkdir(destination,{recursive:true});
  const pins=[];
  for (const file of [...fileNames].sort()) {
    if (!allowedFile(file)) fail('CODE_PAYLOAD_UNSAFE');
    const bytes=read(file),target=path.join(destination,file);
    await fsp.mkdir(path.dirname(target),{recursive:true});
    await fsp.writeFile(target,bytes,{flag:'wx',mode:0o444});
    pins.push({file,sha256:sha(bytes),bytes:bytes.length});
  }
  const m={schemaVersion:SCHEMA,version,sourceCommit,compatibility:profile,files:pins}; m.id=idOf(m);
  validateManifest(m,profile);
  const deps=json(path.join(destination,'package.json')).dependencies || {};
  if (sha(JSON.stringify(Object.fromEntries(Object.entries(deps).sort()))) !== profile.dependencies) fail('CODE_INCOMPATIBLE');
  await fsp.writeFile(path.join(destination,MANIFEST),JSON.stringify(m,null,2)+'\n',{flag:'wx',mode:0o444});
  readRelease(destination,profile); return m;
}
async function putVersion(store, staging, manifest, profile) {
  const versions=path.join(store,'versions'); await fsp.mkdir(versions,{recursive:true});
  if (fs.realpathSync(versions) !== versions) fail('CODE_STORE_UNSAFE');
  const target=versionRoot(store,manifest.id);
  if (fs.existsSync(target)) { versionManifest(store,manifest.id,profile); return; }
  await fsp.rename(staging,target);
}
async function ensureStore({home,store}) {
  return withLock(store,async()=>{
    const profile=compatibility(home);
    if (fs.existsSync(path.join(store,'state.json'))) {
      const state=readState(store);
      try { versionManifest(store,state.current.id,profile); }
      catch(error) {
        if (!state.previous) throw error;
        versionManifest(store,state.previous.id,profile);
        state.lastFailure={id:state.current.id,code:'CODE_CURRENT_INVALID'};
        state.current=state.previous;state.previous=null;state.pending=null; await writeState(store,state);
      }
      return state;
    }
    const staging=await fsp.mkdtemp(path.join(store,'.seed-'));
    try {
      const version=json(path.join(home,'package.json')).version+'-bootstrap';
      const manifest=await snapshotCode({sourceRoot:home,destination:staging,version,profile});
      await putVersion(store,staging,manifest,profile);
      const state={schemaVersion:STORE_SCHEMA,current:record(manifest),previous:null,pending:null};
      await writeState(store,state); return state;
    } finally { await fsp.rm(staging,{recursive:true,force:true}); }
  });
}
async function installArchive({home,store,archive,manifest}) {
  return withLock(store,async()=>{
    const state=readState(store),profile=compatibility(home); validateManifest(manifest,profile);
    if (state.pending) fail('CODE_UPDATE_PENDING');
    const staging=await fsp.mkdtemp(path.join(store,'.stage-'));
    try {
      extractSnapshot(archive,staging);
      const actual=readRelease(staging,profile);
      if (actual.id !== manifest.id) fail('CODE_RELEASE_ID_MISMATCH');
      if (actual.id === state.current.id) return state;
      await putVersion(store,staging,actual,profile);
      state.pending=record(actual); await writeState(store,state); return state;
    } finally { await fsp.rm(staging,{recursive:true,force:true}); }
  });
}
async function rollback({home,store}) {
  return withLock(store,async()=>{
    const state=readState(store);
    if (state.pending) fail('CODE_UPDATE_PENDING');
    if (!state.previous) fail('CODE_ROLLBACK_UNAVAILABLE');
    versionManifest(store,state.previous.id,compatibility(home));
    state.pending=state.previous; await writeState(store,state); return state;
  });
}
async function beginLaunch(options) {
  await ensureStore(options);
  return withLock(options.store,async()=>{
    const state=readState(options.store);
    if (state.pending?.attempted) {
      state.lastFailure={id:state.pending.id,code:'CODE_START_INTERRUPTED'};state.pending=null;
    }
    let selected=state.pending || state.current;
    try { versionManifest(options.store,selected.id,compatibility(options.home)); }
    catch(error) {
      if (!state.pending) throw error;
      state.lastFailure={id:selected.id,code:'CODE_CANDIDATE_INVALID'};state.pending=null;selected=state.current;
      versionManifest(options.store,selected.id,compatibility(options.home));
    }
    if (state.pending) state.pending={...state.pending,attempted:true};
    await writeState(options.store,state);
    return {...selected,path:versionRoot(options.store,selected.id),candidate:Boolean(state.pending)};
  });
}
async function finishLaunch({store}, id, failure) {
  return withLock(store,async()=>{
    const state=readState(store);
    if (state.pending?.id !== id) return state;
    if (failure) state.lastFailure={id,code:failure};
    else { state.previous=state.current;state.current=record(state.pending);delete state.lastFailure; }
    state.pending=null; await writeState(store,state); return state;
  });
}
module.exports={SCHEMA,STORE_SCHEMA,MANIFEST,allowedFile,compatibility,validateManifest,readRelease,codeFiles,
  snapshotCode,versionRoot,readState,ensureStore,installArchive,rollback,beginLaunch,finishLaunch,withLock,sha};
