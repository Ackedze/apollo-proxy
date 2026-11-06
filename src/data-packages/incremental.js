'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), zlib = require('node:zlib');
const releases = require('../data-release'), protectedData = require('./protected');
const SCHEMA = 'apollo.incremental-data.v1';
const fail = code => { throw Object.assign(Error(code), {code}); };
const exact = (value, keys) => value && Object.keys(value).sort().join(',') === keys.slice().sort().join(',');
function https(value) {
  let url; try { url = new URL(value); } catch { fail('DATA_INCREMENTAL_DESCRIPTOR_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail('DATA_INCREMENTAL_DESCRIPTOR_INVALID');
  return url;
}
function validatePin(pin, withUrl = false, withOffset = false) {
  if (!exact(pin, ['sha256','bytes','iv','tag', ...(withUrl ? ['url'] : []), ...(withOffset ? ['offset'] : [])]) || !/^[a-f0-9]{64}$/.test(pin.sha256 || '') ||
      !Number.isSafeInteger(pin.bytes) || pin.bytes < 1 || pin.bytes > releases.MAX_ARCHIVE_BYTES ||
      !/^[A-Za-z0-9+/]{16}$/.test(pin.iv || '') || !/^[A-Za-z0-9+/]{22}==$/.test(pin.tag || '')) fail('DATA_INCREMENTAL_DESCRIPTOR_INVALID');
  if (withUrl) https(pin.url);
  if (withOffset && (!Number.isSafeInteger(pin.offset) || pin.offset < 0)) fail('DATA_INCREMENTAL_DESCRIPTOR_INVALID');
  return pin;
}
function validateDescriptor(value) {
  const packed = value && Object.hasOwn(value,'objectsPack');
  if (!exact(value, ['schemaVersion','manifest',packed ? 'objectsPack' : 'objectsUrl']) || value.schemaVersion !== SCHEMA) fail('DATA_INCREMENTAL_DESCRIPTOR_INVALID');
  if (packed) {
    if (!exact(value.objectsPack,['url','bytes']) || !Number.isSafeInteger(value.objectsPack.bytes) || value.objectsPack.bytes < 1 || value.objectsPack.bytes > releases.MAX_ARCHIVE_BYTES) fail('DATA_INCREMENTAL_DESCRIPTOR_INVALID');
    https(value.objectsPack.url);
  } else if (!https(value.objectsUrl).pathname.endsWith('/')) fail('DATA_INCREMENTAL_DESCRIPTOR_INVALID');
  validatePin(value.manifest, true); return value;
}
const objectAad = (keyId, sha) => 'apollo.data-object.v1:' + keyId + ':' + sha;
const indexAad = (keyId, id) => 'apollo.data-index.v1:' + keyId + ':' + id;
function open(bytes, key, pin, aad, maxBytes) {
  if (bytes.length !== pin.bytes || releases.sha(bytes) !== pin.sha256) fail('DATA_INCREMENTAL_INTEGRITY_INVALID');
  let result;
  try { result = zlib.gunzipSync(protectedData.decrypt(bytes, key, pin, aad), {maxOutputLength:Math.max(1, maxBytes)}); }
  catch (error) { if (error.code?.startsWith('DATA_')) throw error; fail('DATA_INCREMENTAL_PAYLOAD_INVALID'); }
  return result;
}
function readIndex(bytes, key, descriptor, keyId, contentVersion) {
  validateDescriptor(descriptor);
  let value; try { value = JSON.parse(open(bytes,key,descriptor.manifest,indexAad(keyId,contentVersion),releases.MAX_ARCHIVE_BYTES)); }
  catch (error) { if (error.code?.startsWith('DATA_')) throw error; fail('DATA_INCREMENTAL_INDEX_INVALID'); }
  if (!exact(value,['schemaVersion','releaseManifest','objects']) || value.schemaVersion !== SCHEMA || typeof value.releaseManifest !== 'string' || !value.objects || Array.isArray(value.objects)) fail('DATA_INCREMENTAL_INDEX_INVALID');
  let manifest; try { manifest = JSON.parse(value.releaseManifest); } catch { fail('DATA_INCREMENTAL_INDEX_INVALID'); }
  if (manifest.schemaVersion !== releases.RELEASE_SCHEMA || manifest.id !== contentVersion || releases.idOf(manifest) !== contentVersion) fail('DATA_INCREMENTAL_INDEX_INVALID');
  releases.inventorySize(manifest.files);
  const hashes = new Set(manifest.files.map(file => file.sha256));
  if (Object.keys(value.objects).length !== hashes.size || Object.keys(value.objects).some(hash => !hashes.has(hash))) fail('DATA_INCREMENTAL_INDEX_INVALID');
  for (const pin of Object.values(value.objects)) {
    validatePin(pin,false,Boolean(descriptor.objectsPack));
    if (descriptor.objectsPack && (!Number.isSafeInteger(pin.offset+pin.bytes) || pin.offset+pin.bytes > descriptor.objectsPack.bytes)) fail('DATA_INCREMENTAL_INDEX_INVALID');
  }
  return {manifest, manifestBytes:Buffer.from(value.releaseManifest), objects:value.objects};
}
async function regular(file) {
  try { const stat = await fs.lstat(file); return stat.isFile() && !stat.isSymbolicLink() && await fs.realpath(file) === file; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function download(pin, url, cache, request, pack = null) {
  validatePin(pin,false,Boolean(pack)); https(url);
  const file = path.join(cache, pin.sha256 + '.enc');
  if (await regular(file)) {
    const bytes = await fs.readFile(file);
    if (bytes.length === pin.bytes && releases.sha(bytes) === pin.sha256) return {bytes, downloaded:false};
    await fs.unlink(file);
  } else {
    try { await fs.lstat(file); fail('DATA_INCREMENTAL_CACHE_INVALID'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  let response, target = url;
  for (let redirects = 0; redirects <= 5; redirects++) {
    response = await request(target, {headers:{Accept:'application/octet-stream',...(pack ? {Range:'bytes='+pin.offset+'-'+(pin.offset+pin.bytes-1)} : {})},redirect:'manual',signal:AbortSignal.timeout(60000)});
    if (![301,302,303,307,308].includes(response.status)) break;
    const next = new URL(response.headers.get('location'), target); await response.body?.cancel();
    if (redirects === 5 || next.protocol !== 'https:' || next.username || next.password) fail('DATA_INCREMENTAL_REDIRECT_INVALID');
    target = next.toString();
  }
  if (!response.ok) fail('DATA_INCREMENTAL_HTTP_' + response.status);
  // A server ignoring Range must never turn a small delta into a full-pack download.
  if (pack && (response.status !== 206 || response.headers.get('content-range') !== 'bytes '+pin.offset+'-'+(pin.offset+pin.bytes-1)+'/'+pack.bytes)) {
    await response.body?.cancel(); fail('DATA_INCREMENTAL_RANGE_INVALID');
  }
  const bytes = await require('../http-fetch').readBytes(response,pin.bytes);
  if (bytes.length !== pin.bytes || releases.sha(bytes) !== pin.sha256) fail('DATA_INCREMENTAL_INTEGRITY_INVALID');
  await fs.writeFile(file, bytes, {flag:'wx',mode:0o600});
  return {bytes, downloaded:true};
}
async function ownedCache(root, id) {
  if (!/^[a-f0-9]{64}$/.test(id)) return false;
  const directory = path.join(root,id);
  if (await fs.realpath(directory) !== directory) return false;
  const marker = path.join(directory,'cache.json');
  if (!await regular(marker)) return false;
  const value = JSON.parse(await fs.readFile(marker,'utf8'));
  if (!exact(value,['schemaVersion','contentVersion']) || value.schemaVersion !== SCHEMA || value.contentVersion !== id) return false;
  for (const name of await fs.readdir(directory)) if (name !== 'cache.json' && !/^[a-f0-9]{64}\.enc$/.test(name) || !await regular(path.join(directory,name))) return false;
  return true;
}
async function install({settings, current, index, key, request, releaseApi = releases}) {
  const descriptor = validateDescriptor(index.incremental), cacheRoot = path.join(settings.storeRoot,'.incremental');
  // This lock serializes updates/cache cleanup, not audits or their release leases.
  return releaseApi.withLock(cacheRoot, async () => {
    console.error(JSON.stringify({phase:'downloading'}));
    for (const name of await fs.readdir(cacheRoot)) if (name !== index.npm.dataId && await ownedCache(cacheRoot,name)) await fs.rm(path.join(cacheRoot,name),{recursive:true});
    const cache = path.join(cacheRoot,index.npm.dataId);
    await fs.mkdir(cache,{recursive:true,mode:0o700});
    if (await fs.realpath(cache) !== cache) fail('DATA_INCREMENTAL_CACHE_INVALID');
    try { await fs.writeFile(path.join(cache,'cache.json'),JSON.stringify({schemaVersion:SCHEMA,contentVersion:index.npm.dataId}),{flag:'wx',mode:0o600}); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (!await ownedCache(cacheRoot,index.npm.dataId)) fail('DATA_INCREMENTAL_CACHE_INVALID');
    const transfer = {downloadedFiles:0,downloadedBytes:0,reusedFiles:0,cachedObjects:0};
    const manifestPin = descriptor.manifest;
    const downloaded = await download(Object.fromEntries(Object.entries(manifestPin).filter(([k])=>k!=='url')),manifestPin.url,cache,request);
    if (downloaded.downloaded) transfer.downloadedBytes += downloaded.bytes.length;
    const target = readIndex(downloaded.bytes,key,descriptor,index.activation.keyId,index.npm.dataId);
    if (target.manifest.runtimeId !== releaseApi.readRuntime(settings.runtimeRoot).id) fail('DATA_RELEASE_RUNTIME_INCOMPATIBLE');
    const releaseBase = await releaseApi.retainRelease(current.path);
    const staging = await fs.mkdtemp(path.join(settings.storeRoot,'.incremental-stage-'));
    try {
      const root = path.join(staging,'package'); await fs.mkdir(root);
      const old = JSON.parse(await fs.readFile(path.join(current.path,'manifest.json'),'utf8'));
      const reusable = new Map();
      for (const pin of old.files || []) reusable.set(pin.sha256 + ':' + pin.bytes,path.join(current.path,pin.file));
      for (const pin of target.manifest.files) {
        const destination = path.join(root,pin.file); await fs.mkdir(path.dirname(destination),{recursive:true});
        const source = reusable.get(pin.sha256 + ':' + pin.bytes);
        if (source && await regular(source)) {
          await fs.copyFile(source,destination);
          const bytes = await fs.readFile(destination);
          if (bytes.length === pin.bytes && releaseApi.sha(bytes) === pin.sha256) { transfer.reusedFiles++; continue; }
          await fs.unlink(destination);
        }
        const object = target.objects[pin.sha256], url = descriptor.objectsPack?.url || new URL(object.sha256 + '.enc',descriptor.objectsUrl).toString();
        const body = await download(object,url,cache,request,descriptor.objectsPack);
        const bytes = open(body.bytes,key,object,objectAad(index.activation.keyId,pin.sha256),pin.bytes);
        if (bytes.length !== pin.bytes || releaseApi.sha(bytes) !== pin.sha256) fail('DATA_INCREMENTAL_INTEGRITY_INVALID');
        await fs.writeFile(destination,bytes,{flag:'wx',mode:0o600});
        if (body.downloaded) { transfer.downloadedFiles++; transfer.downloadedBytes += body.bytes.length; } else transfer.cachedObjects++;
      }
      await fs.writeFile(path.join(root,'manifest.json'),target.manifestBytes,{flag:'wx',mode:0o600});
      console.error(JSON.stringify({phase:'validating'}));
      const state = await releaseApi.installDirectory({...settings,directory:root,expectedContentVersion:index.npm.dataId,expectedCurrentVersion:current.contentVersion,packageVersion:index.npm.version});
      await fs.rm(cache,{recursive:true}).catch(error=>console.error('[Apollo data] Download cache cleanup deferred: ' + error.code));
      return {state, transfer};
    } finally { releaseBase(); await fs.rm(staging,{recursive:true,force:true}); }
  });
}
module.exports = {SCHEMA,validateDescriptor,validatePin,readIndex,open,objectAad,indexAad,install};
