'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const npmData = require('./npm');
const fail = code => { throw Object.assign(Error(code), { code }); };
const CHECK = Buffer.from('Apollo data access v1');
const KEY_SCHEMA = 'apollo.data-activation.v1';
const PACKAGE_SCHEMA = 'apollo.encrypted-data.v1';
function base64(value, length) {
  return typeof value === 'string' && Buffer.from(value, 'base64').length === length && Buffer.from(value, 'base64').toString('base64') === value;
}
function validateActivation(value) {
  if (value?.schemaVersion !== KEY_SCHEMA || !/^[a-f0-9-]{36}$/.test(value.keyId || '') ||
      value.kdf?.algorithm !== 'scrypt' || value.kdf.N !== 131072 || value.kdf.r !== 8 || value.kdf.p !== 1 || !base64(value.kdf.salt,16) ||
      !base64(value.check?.iv,12) || !base64(value.check?.tag,16) || !base64(value.check?.body,CHECK.length)) fail('DATA_ACTIVATION_DESCRIPTOR_INVALID');
  return value;
}
function deriveKey(password, activation) {
  validateActivation(activation);
  if (typeof password !== 'string' || !password.length || Buffer.byteLength(password) > 1024) fail('DATA_ACTIVATION_PASSWORD_INVALID');
  return crypto.scryptSync(password, Buffer.from(activation.kdf.salt,'base64'),32,{ N:131072,r:8,p:1,maxmem:256*1024*1024 });
}
function encrypt(bytes, key, aad) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(bytes),cipher.final()]);
  return { iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),body };
}
function decrypt(body, key, seal, aad, failureCode = 'DATA_PACKAGE_DECRYPTION_FAILED') {
  if (!base64(seal?.iv,12) || !base64(seal?.tag,16)) fail('DATA_PACKAGE_ENCRYPTION_INVALID');
  try {
    const cipher = crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(seal.iv,'base64'));
    cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(Buffer.from(seal.tag,'base64'));
    return Buffer.concat([cipher.update(body),cipher.final()]);
  } catch { fail(failureCode); }
}
function createActivation(password) {
  const activation = { schemaVersion:KEY_SCHEMA,keyId:crypto.randomUUID(),
    kdf:{algorithm:'scrypt',salt:crypto.randomBytes(16).toString('base64'),N:131072,r:8,p:1} };
  const key = crypto.scryptSync(password,Buffer.from(activation.kdf.salt,'base64'),32,{N:131072,r:8,p:1,maxmem:256*1024*1024});
  const seal = encrypt(CHECK,key,activation.keyId);
  activation.check = {...seal,body:seal.body.toString('base64')};
  validateActivation(activation);
  return activation;
}
function accessKey(activation, access = {}) {
  validateActivation(activation);
  const key = access.password !== undefined ? deriveKey(access.password,activation)
    : access.keyId === activation.keyId && /^[a-f0-9]{64}$/.test(access.key || '') ? Buffer.from(access.key,'hex') : null;
  if (!key) fail('DATA_ACTIVATION_REQUIRED');
  if (!decrypt(Buffer.from(activation.check.body,'base64'),key,activation.check,activation.keyId,'DATA_ACTIVATION_PASSWORD_INVALID').equals(CHECK)) fail('DATA_ACTIVATION_PASSWORD_INVALID');
  return key;
}

async function installProtected({ settings, ensured, selected, command, access, request, releases }) {
  const { index } = selected, current = ensured.state?.current || null;
  const updateAvailable = index.npm.dataId !== current?.contentVersion;
  const extra = { updateAvailable, descriptor:{contentVersion:index.npm.dataId},sourceCommit:selected.commit,activationKeyID:index.activation.keyId };
  const keyPresent = access?.keyId === index.activation.keyId && /^[a-f0-9]{64}$/.test(access.key || '');
  const status = state => state?.current ? releases.publicStatus(state) : {current:null,previous:null};
  if (command === 'check') return {...status(ensured.state),...extra,activationRequired:!keyPresent};
  const key = accessKey(index.activation,access);
  const activated = command === 'activate' ? {activationKey:key.toString('hex')} : {};
  if (!updateAvailable) return {...status(ensured.state),...extra,activationRequired:false,...activated};
  const temporary = await fs.mkdtemp(path.join(settings.storeRoot,'.protected-update-'));
  try {
    console.error(JSON.stringify({phase:'downloading'}));
    const outer = path.join(temporary,'download.tgz'), unpacked = path.join(temporary,'outer');
    await npmData.download(index.npm,outer,request);
    require('../knowledge-package').validateArchiveEntries(outer);
    await fs.mkdir(unpacked);
    require('../../scripts/git-data-cli').extractSnapshot(outer,unpacked);
    const root = path.join(unpacked,'package');
    const files = await require('../knowledge-package').listPackageFiles(root);
    if (files.join(',') !== 'encryption.json,package.json,payload.enc') fail('DATA_PACKAGE_ENCRYPTION_INVALID');
    const pkg = JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
    if (pkg.name !== index.npm.name || pkg.version !== index.npm.version ||
        ['scripts','dependencies','optionalDependencies','peerDependencies','bundledDependencies','bundleDependencies','bin','main'].some(k=>pkg[k]!==undefined)) fail('NPM_DATA_PACKAGE_INVALID');
    const header = JSON.parse(await fs.readFile(path.join(root,'encryption.json'),'utf8'));
    if (header.schemaVersion !== PACKAGE_SCHEMA || header.keyId !== index.activation.keyId || header.contentVersion !== index.npm.dataId) fail('DATA_PACKAGE_ENCRYPTION_INVALID');
    const payload = decrypt(await fs.readFile(path.join(root,'payload.enc')),key,header,header.keyId+':'+header.contentVersion);
    const archive = path.join(temporary,'data.tgz');
    await fs.writeFile(archive,payload,{flag:'wx',mode:0o600});
    console.error(JSON.stringify({phase:'validating'}));
    if ((await releases.readState(settings.storeRoot))?.current?.contentVersion !== current?.contentVersion) fail('DATA_RELEASE_STATE_CHANGED');
    const state = await releases.installTarball({...settings,tarballPath:archive,
      expectedIntegrity:'sha256-'+crypto.createHash('sha256').update(payload).digest('base64'),expectedContentVersion:index.npm.dataId});
    return {...status(state),...extra,updateAvailable:false,updated:true,activationRequired:false,...activated};
  } finally { await fs.rm(temporary,{recursive:true,force:true}); }
}
module.exports = { KEY_SCHEMA,PACKAGE_SCHEMA,validateActivation,createActivation,accessKey,encrypt,installProtected };
