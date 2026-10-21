'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const adapter=require('./layer-names/run-protocol');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const adapterFile=require.resolve('./layer-names/run-protocol'),adapterBytes=fs.readFileSync(adapterFile),adapterHash=sha(adapterBytes);
const fail=()=>{throw Object.assign(Error('LAYER_NAMES_RUN_PROFILE_INCOMPATIBLE'),{code:'LAYER_NAMES_RUN_PROFILE_INCOMPATIBLE',status:503});};
const closed=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys.slice().sort().join(',');
const BUNDLED=path.join(__dirname,'figma-layer-name-hygiene-run');
const RELEASE_FOLDER='skills/figma-layer-name-hygiene-run';
function readRunProfile(folder) {
  const pins=[];
  function read(file){try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(file)!==file||stat.size>65536)fail();return fs.readFileSync(file);}catch{fail();}}
  const profilePath=path.join(path.resolve(folder),'profile.json'),bytes=read(profilePath);let profile;
  try{profile=JSON.parse(bytes);}catch{fail();}
  if(!closed(profile,['schemaVersion','version','wire','adapter','instructions'])||profile.schemaVersion!=='apollo.layer-names-run-profile.v1'||!/^\d+\.\d+\.\d+$/.test(profile.version)
    ||!closed(profile.wire,['version','sha256'])||profile.wire.version!==adapter.wire.version||profile.wire.sha256!==adapter.wire.sha256
    ||!closed(profile.adapter,['sha256','bytes'])||profile.adapter.sha256!==adapterHash||profile.adapter.bytes!==adapterBytes.length
    ||!closed(profile.instructions,['sha256','bytes']))fail();
  const instructionsPath=path.join(path.dirname(profilePath),'SKILL.md'),instructions=read(instructionsPath);
  if(sha(instructions)!==profile.instructions.sha256||instructions.length!==profile.instructions.bytes||sha(read(adapterFile))!==adapterHash)fail();
  pins.push({file:profilePath,hash:sha(bytes)},{file:instructionsPath,hash:sha(instructions)},{file:adapterFile,hash:adapterHash});
  return {instructions:instructions.toString('utf8'),version:profile.version,sha256:sha(bytes),wire:profile.wire,
    assertCurrent(){for(const pin of pins)if(sha(read(pin.file))!==pin.hash)fail();}};
}
function loadRunSkill(apolloRoot,{releaseRoot}={}) {
  const base=require('./layer-names').loadSkill(apolloRoot,{releaseRoot});let folder=BUNDLED;
  if(releaseRoot){const manifest=require('../data-release').readReleaseFiles(releaseRoot,apolloRoot);if(manifest.files.some(p=>p.file.startsWith(RELEASE_FOLDER+'/')))folder=path.join(releaseRoot,RELEASE_FOLDER);}
  const skill=readRunProfile(folder);
  return Object.assign({},skill,{protocol:adapter(base.protocol),assertCurrent(){base.assertCurrent();skill.assertCurrent();}});
}
module.exports={loadRunSkill,readRunProfile,BUNDLED,RELEASE_FOLDER};
