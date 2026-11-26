'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {verifyContent}=require('../src/landing/content-verification');
const inventory={families:{'10:1':'BentoGrid'},slots:[]};
const proof=()=>({imageSlots:[],groups:[{id:'10:1',family:'BentoGrid',capacity:1,cards:[{id:'10:2',width:300,height:200,areaWidth:300,areaHeight:200,verticalSizing:'FILL'}]}]});

test('content shape failures identify the exact field and never return null or pass',()=>{
 const cases=[
  ['contentReadback.imageSlots',r=>{r.imageSlots=null;}],
  ['contentReadback.groups',r=>{r.groups=null;}],
  ['contentReadback.groups[0].capacity',r=>{r.groups[0].capacity='1';}],
  ['contentReadback.groups[0].cards[0].width',r=>{r.groups[0].cards[0].width='300';}],
  ['contentReadback.groups[0].cards[0].areaHeight',r=>{r.groups[0].cards[0].areaHeight=null;}],
 ];
 for(const [field,mutate] of cases){
  const r=proof();mutate(r);const checks=verifyContent(r,inventory,[]);
  assert.equal(checks[0].status,'unknown');assert.equal(checks[0].details[0].path,field);assert(checks[0].evidence.includes(field));
 }
 assert(verifyContent(proof(),inventory,[]).every(c=>c.status==='passed'));
 assert.equal(verifyContent(proof(),null,[])[0].details[0].code,'CONTENT_INVENTORY_REQUIRED');
});

test('unsupported PromoCards group is an explicit coverage gap, not accepted as BentoGrid',()=>{
 const r=proof();r.groups[0].family='PromoCards';
 const check=verifyContent(r,inventory,[])[0];
 assert.equal(check.status,'unknown');assert.equal(check.details[0].code,'CONTENT_GROUP_UNSUPPORTED');
 assert.equal(check.details[0].path,'contentReadback.groups[0].family');assert.match(check.evidence,/PromoCard/);
});

test('icon diagnostics distinguish the glyph catalog marker and numeric mounted size',()=>{
 const icon={variantKey:'a'.repeat(40),expectedVariantKey:'a'.repeat(40),set:'shopping-bag',size:'m',expectedSize:'24',gridVisible:false};
 const r={imageSlots:[],groups:[{id:'20:1',family:'Benefits',capacity:1,cards:[{id:'20:2',width:300,height:200,graphicId:'20:3',graphicKind:'icon',graphicBottom:32,verticalSizing:'FILL',stopperSizing:'FILL',icon}]}]};
 const check=verifyContent(r,{families:{'20:1':'Benefits'},slots:[]},[]).find(c=>c.name==='Иконки Benefits');
 assert.equal(check.status,'failed');assert.match(check.evidence,/groups\[0\]\.cards\[0\]/);
 assert.match(check.evidence,/icon\.set/);assert.match(check.evidence,/icon\.size\/expectedSize/);
 icon.set='glyph-26';icon.size=24;icon.expectedSize=24;
 assert(verifyContent(r,{families:{'20:1':'Benefits'},slots:[]},[]).every(c=>c.status==='passed'));
});
