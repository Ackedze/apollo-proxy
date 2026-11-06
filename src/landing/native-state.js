'use strict';
const equal=require('node:util').isDeepStrictEqual,crypto=require('node:crypto');
const LEGACY_BYTES=262144,SNAPSHOT_BYTES=2*1024*1024,STORE_BYTES=8*1024*1024,MAX_NODES=5000;
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)??'undefined').digest('hex');
const isV2=native=>native?.schemaVersion==='apollo.landing-native.v2';
function sameNode(before,after,beforeNative,afterNative){
 if(!before||!after||!sameDefaults(beforeNative,afterNative))return false;
 const a={...before},b={...after};for(const k of ['x','y','width','height']){delete a[k];delete b[k];}
 if(!equal(a.resolvedVariableModes,b.resolvedVariableModes)){
  const old=a.resolvedVariableModes,next=b.resolvedVariableModes,defaults=afterNative?.modeDefaults;
  if(!isV2(afterNative)||!old||!next||!defaults||Array.isArray(old)||Array.isArray(next)||Object.entries(old).some(([k,v])=>next[k]!==v)||Object.entries(next).some(([k,v])=>!Object.hasOwn(old,k)&&(!Object.hasOwn(defaults,k)||typeof v!=='string'||!v||defaults[k]!==v)))return false;
  // Collection imports add inherited defaults; they do not change prior assignments.
  b.resolvedVariableModes=old;
 }
 return equal(a,b);
}
function sameDefaults(before,after){
 if(!isV2(before))return true;
 return isV2(after)&&Object.entries(before.modeDefaults||{}).every(([id,value])=>Object.hasOwn(after.modeDefaults||{},id)&&after.modeDefaults[id]===value);
}
function sameReadback(before,after){
 const a={...before},b={...after};delete a.leaseNonce;delete b.leaseNonce;delete a.native;delete b.native;
 if(!equal(a,b)||Boolean(before.native)!==Boolean(after.native))return false;
 if(!before.native)return true;
 return sameDefaults(before.native,after.native)&&before.native.nodes.length===after.native.nodes.length&&before.native.nodes.every((old,i)=>{
  const next=after.native.nodes[i];return sameNode(old,next,before.native,after.native)&&['x','y','width','height'].every(k=>equal(old[k],next?.[k]));
 });
}
function diff(before,after){
 const rows=value=>Array.isArray(value?.native?.nodes)?value.native.nodes.filter(n=>n&&typeof n==='object'):[];
 const old=new Map(rows(before).map(n=>[n.id,n])),next=new Map(rows(after).map(n=>[n.id,n])),changes=[];
 const brief=v=>({sha256:sha(v),preview:(JSON.stringify(v)??'undefined').slice(0,160)});
 if(!equal(before.native?.modeDefaults,after.native?.modeDefaults))changes.push({kind:'changed',field:'native.modeDefaults',before:brief(before.native?.modeDefaults),after:brief(after.native?.modeDefaults)});
 for(const id of new Set([...old.keys(),...next.keys()])){
  const a=old.get(id),b=next.get(id);
  if(!a||!b)changes.push({id,kind:a?'removed':'added'});
  else for(const key of new Set([...Object.keys(a),...Object.keys(b)]))if(!equal(a[key],b[key]))changes.push({id,kind:'changed',field:key,before:brief(a[key]),after:brief(b[key])});
  if(changes.length>=24)break;
 }
 return {beforeHash:sha(before),afterHash:sha(after),outsideChanged:before.outsideHash!==after.outsideHash,changes:changes.slice(0,24),bounded:true};
}
module.exports={LEGACY_BYTES,SNAPSHOT_BYTES,STORE_BYTES,MAX_NODES,isV2,sameNode,sameDefaults,sameReadback,diff};
