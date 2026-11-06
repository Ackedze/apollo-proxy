'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), zlib = require('node:zlib');
const releases = require('../src/data-release'), protectedData = require('../src/data-packages/protected'), incremental = require('../src/data-packages/incremental');
async function buildIncrementalData({releaseRoot,runtimeRoot,output,descriptor,key,objectsUrl,packUrl,previousRoot}) {
  const manifest = await releases.validateRelease(releaseRoot,{runtimeRoot});
  const manifestBytes = await fs.readFile(path.join(releaseRoot,'manifest.json'));
  const manifestUrl = new URL('incremental.json.enc',descriptor.npm.tarballUrl).toString();
  const sample = {sha256:'0'.repeat(64),bytes:1,iv:Buffer.alloc(12).toString('base64'),tag:Buffer.alloc(16).toString('base64')};
  if (objectsUrl && packUrl) throw Error('DATA_INCREMENTAL_DESCRIPTOR_INVALID');
  const location = packUrl ? {objectsPack:{url:packUrl,bytes:1}} : {objectsUrl};
  incremental.validateDescriptor({schemaVersion:incremental.SCHEMA,...location,manifest:{...sample,url:manifestUrl}});
  let previous = null;
  if (previousRoot) {
    previousRoot = path.resolve(previousRoot);
    if (await fs.realpath(previousRoot) !== previousRoot) throw Error('DATA_INCREMENTAL_PREVIOUS_INVALID');
    const old = JSON.parse(await fs.readFile(path.join(previousRoot,'current.json'),'utf8'));
    if (old.schemaVersion === 'apollo.git-data-index.v4' && old.activation.keyId === descriptor.activation.keyId) {
      previous = incremental.readIndex(await fs.readFile(path.join(previousRoot,'incremental.json.enc')),key,old.incremental,old.activation.keyId,old.npm.dataId);
    }
  }
  const objectRoot = path.join(output,'objects'); await fs.mkdir(objectRoot);
  const objects = {}; let reusedObjects = 0;
  for (const file of manifest.files) {
    if (objects[file.sha256]) continue;
    const source = path.join(releaseRoot,file.file), bytes = await fs.readFile(source);
    if (bytes.length !== file.bytes || releases.sha(bytes) !== file.sha256) throw Error('DATA_RELEASE_ARTIFACT_CHANGED');
    let pin = previous?.objects[file.sha256], body;
    if (pin) {
      const oldFile = path.join(previousRoot,'objects',pin.sha256 + '.enc');
      if (await fs.realpath(oldFile) !== oldFile || !(await fs.lstat(oldFile)).isFile()) throw Error('DATA_INCREMENTAL_PREVIOUS_INVALID');
      body = await fs.readFile(oldFile);
      const plain = incremental.open(body,key,pin,incremental.objectAad(descriptor.activation.keyId,file.sha256),file.bytes);
      if (!plain.equals(bytes)) throw Error('DATA_INCREMENTAL_PREVIOUS_INVALID');
      reusedObjects++;
    } else {
      const seal = protectedData.encrypt(zlib.gzipSync(bytes),key,incremental.objectAad(descriptor.activation.keyId,file.sha256)); body = seal.body;
      pin = {sha256:releases.sha(body),bytes:body.length,iv:seal.iv,tag:seal.tag};
    }
    pin = Object.fromEntries(Object.entries(pin).filter(([key])=>key!=='offset'));
    objects[file.sha256] = pin;
    await fs.writeFile(path.join(objectRoot,pin.sha256 + '.enc'),body,{flag:'wx',mode:0o600});
  }
  if (packUrl) {
    const pack = await fs.open(path.join(output,'objects.bin'),'wx'); let offset = 0;
    try {
      for (const pin of Object.values(objects)) {
        const body = await fs.readFile(path.join(objectRoot,pin.sha256+'.enc'));
        pin.offset = offset; await pack.writeFile(body); offset += body.length;
      }
    } finally { await pack.close(); }
    location.objectsPack.bytes = offset;
  }
  const data = Buffer.from(JSON.stringify({schemaVersion:incremental.SCHEMA,releaseManifest:manifestBytes.toString('utf8'),objects}));
  const seal = protectedData.encrypt(zlib.gzipSync(data),key,incremental.indexAad(descriptor.activation.keyId,manifest.id));
  const transport = {schemaVersion:incremental.SCHEMA,...location,manifest:{url:manifestUrl,sha256:releases.sha(seal.body),bytes:seal.body.length,iv:seal.iv,tag:seal.tag}};
  incremental.readIndex(seal.body,key,transport,descriptor.activation.keyId,manifest.id);
  await fs.writeFile(path.join(output,'incremental.json.enc'),seal.body,{flag:'wx',mode:0o600});
  await releases.validateRelease(releaseRoot,{runtimeRoot});
  if (!(await fs.readFile(path.join(releaseRoot,'manifest.json'))).equals(manifestBytes)) throw Error('DATA_RELEASE_ARTIFACT_CHANGED');
  return {transport,stats:{objects:Object.keys(objects).length,reusedObjects,newObjects:Object.keys(objects).length-reusedObjects,...(packUrl ? {packBytes:location.objectsPack.bytes} : {})}};
}
module.exports = {buildIncrementalData};
