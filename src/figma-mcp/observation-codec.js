'use strict';
const SCHEMA='apollo.recipe-observation.packed.v1';
// This lossless JSON codec is host-authored. Dictionary entries are data only.
function packObservation(value){
 const strings=[],indexes=new Map(),shapes=[],shapeIndexes=new Map(),objects=[],objectIndexes=new Map();
 const intern=s=>{if(!indexes.has(s)){indexes.set(s,strings.length);strings.push(s);}return indexes.get(s);};
 function encode(v){
  if(typeof v==='string')return [0,intern(v)];
  let row;
  if(Array.isArray(v))row=[1,...v.map(x=>encode(x===undefined?null:x))];
  else if(v&&typeof v==='object'){
   const entries=Object.entries(v).filter(([,x])=>x!==undefined),shape=entries.map(([k])=>intern(k)),key=JSON.stringify(shape);
   if(!shapeIndexes.has(key)){shapeIndexes.set(key,shapes.length);shapes.push(shape);}
   row=[2,shapeIndexes.get(key),...entries.map(([,x])=>encode(x))];
  }
  if(row){const key=JSON.stringify(row);if(!objectIndexes.has(key)){objectIndexes.set(key,objects.length);objects.push(row);}return [3,objectIndexes.get(key)];}
  return v;
 }
 const data=encode(value),json=JSON.stringify({strings,shapes,objects,data});
 const bytes=encodeURIComponent(json).replace(/%([A-F0-9]{2})/g,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
 let dictionary=new Map(),next=257,phrase='';const codes=[];
 const emit=s=>codes.push(s.length===1?s.charCodeAt(0):dictionary.get(s));
 for(const char of bytes){const combined=phrase+char;if(!phrase||dictionary.has(combined)){phrase=combined;continue;}emit(phrase);if(next<=65535)dictionary.set(combined,next++);else{codes.push(256);dictionary=new Map();next=257;}phrase=char;}
 if(phrase)emit(phrase);
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',binary=[];let buffer=0,bits=0,bitNext=257,previous=false;
 for(const code of codes){const width=Math.max(9,Math.ceil(Math.log2(bitNext+1)));buffer=(buffer<<width)|code;bits+=width;while(bits>=8){bits-=8;binary.push((buffer>>>bits)&255);}buffer&=(1<<bits)-1;if(code===256){bitNext=257;previous=false;}else{if(previous&&bitNext<=65535)bitNext++;previous=true;}}
 if(bits)binary.push(buffer<<(8-bits));
 let encoded='';for(let i=0;i<binary.length;i+=3){const a=binary[i],b=binary[i+1],c=binary[i+2];encoded+=alphabet[a>>>2]+alphabet[((a&3)<<4)|((b||0)>>>4)]+(b===undefined?'=':alphabet[((b&15)<<2)|((c||0)>>>6)])+(c===undefined?'=':alphabet[c&63]);}
 return {schemaVersion:'apollo.recipe-observation.packed.v1',compression:'lzw-bits-base64',codeCount:codes.length,data:encoded};
}
function unpackObservation(value){
 const fail=()=>{throw Object.assign(Error('LANDING_ROOT_OBSERVATION_INVALID'),{code:'LANDING_ROOT_OBSERVATION_INVALID'});};
 if(value?.schemaVersion===SCHEMA&&value.compression==='lzw-bits-base64'){
  if(typeof value.data!=='string'||value.data.length>8*1024*1024||!value.data.length||value.data.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(value.data))fail();
  const bytes=Buffer.from(value.data,'base64');if(bytes.toString('base64')!==value.data||!Number.isSafeInteger(value.codeCount)||value.codeCount<1||value.codeCount>bytes.length*8/9)fail();
  let dictionary=new Map(),next=257,previous='',size=0,buffer=0,bits=0,offset=0;const parts=[];
  for(let i=0;i<value.codeCount;i++){const width=Math.max(9,Math.ceil(Math.log2(next+1)));while(bits<width){if(offset>=bytes.length)fail();buffer=(buffer<<8)|bytes[offset++];bits+=8;}bits-=width;const code=(buffer>>>bits)&((1<<width)-1);buffer&=(1<<bits)-1;if(code===256){dictionary=new Map();next=257;previous='';continue;}const entry=code<256?String.fromCharCode(code):dictionary.get(code)||(code===next&&previous?previous+previous[0]:null);if(entry===null||entry===undefined)fail();size+=entry.length;if(size>8*1024*1024)fail();parts.push(entry);if(previous&&next<=65535)dictionary.set(next++,previous+entry[0]);previous=entry;}
  if(offset!==bytes.length||bits>=8||buffer!==0)fail();
  try{value={...JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(parts.join(''),'latin1'))),schemaVersion:SCHEMA};}catch{fail();}
 }
 if(value?.schemaVersion!==SCHEMA||!Array.isArray(value.strings)||value.strings.length>100000||value.strings.some(s=>typeof s!=='string')||!Array.isArray(value.shapes)||value.shapes.length>100000||!Array.isArray(value.objects)||value.objects.length>100000||Buffer.byteLength(JSON.stringify(value))>8*1024*1024)fail();
 let count=0,stringBytes=0;
 const string=i=>{if(!Number.isSafeInteger(i)||i<0||i>=value.strings.length)fail();const result=value.strings[i];stringBytes+=Buffer.byteLength(result);if(stringBytes>8*1024*1024)fail();return result;};
 function decode(v,depth=0){
  if(++count>1000000||depth>96)fail();
  if(!Array.isArray(v)){if(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return v;fail();}
  if(v[0]===0&&v.length===2)return string(v[1]);
  if(v[0]===1)return v.slice(1).map(x=>decode(x,depth+1));
  if(v[0]===2){const shape=value.shapes[v[1]];if(!Number.isSafeInteger(v[1])||!Array.isArray(shape)||shape.length!==v.length-2)fail();const pairs=[],seen=new Set();for(let i=0;i<shape.length;i++){const key=string(shape[i]);if(seen.has(key))fail();seen.add(key);pairs.push([key,decode(v[i+2],depth+1)]);}return Object.fromEntries(pairs);}
  if(v[0]===3&&v.length===2&&Number.isSafeInteger(v[1])&&v[1]>=0&&v[1]<value.objects.length)return decode(value.objects[v[1]],depth+1);
  fail();
 }
 const result=decode(value.data);if(result?.schemaVersion!=='apollo.recipe-observation.v1'||!Array.isArray(result.nodes))fail();return result;
}
module.exports={SCHEMA,packObservation,unpackObservation};
