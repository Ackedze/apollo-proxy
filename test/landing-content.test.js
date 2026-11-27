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

const benefitsInventory={families:{'20:1':'Benefits'},slots:[]};
function verticalProof(position='Right') {
 const icon={variantKey:'a'.repeat(40),expectedVariantKey:'a'.repeat(40),set:'glyph-26',size:24,expectedSize:24,gridVisible:false};
 return {imageSlots:[],groups:[{id:'20:1',family:'Benefits',capacity:3,platform:'D',sizingMode:'vertical-content-wrapper',cards:[54,78,54].map((height,index)=>({
  id:'20:'+String(index*4+2),x:index*316,y:100,width:300,height:186,
  verticalSizing:index===1?'HUG':'FILL',stopperSizing:'FIXED',graphicBottom:266,
  graphicId:'20:'+String(index*4+3),graphicKind:'icon',icon:{...icon},
  preset:{componentKey:'c'.repeat(40),cardAxis:'Vertical',graphicPosition:position,compact:'True',background:'True'},
  wrapper:{id:'20:'+String(index*4+4),x:index*316+16,y:116,width:268,height:78,verticalSizing:index===1?'HUG':'FILL'},
  content:{id:'20:'+String(index*4+5),x:index*316+16,y:116,width:268,height,verticalSizing:'HUG'},
  graphicBounds:{x:index*316+16,y:218,width:48,height:48},
  stopper:{height:28,presetHeight:28,minHeight:24},
 }))}]};
}
const sizingCheck = r => verifyContent(r,benefitsInventory,[]).find(check=>check.name==='Размеры карточек');

test('vertical Benefits accepts measured wrapper anchors for either uniform graphic position',()=>{
 for(const position of ['Left','Right'])assert(verifyContent(verticalProof(position),benefitsInventory,[]).every(check=>check.status==='passed'));
 const ties=verticalProof();
 const first=ties.groups[0].cards[0];first.content.height=78;first.verticalSizing='HUG';first.wrapper.verticalSizing='HUG';
 assert.equal(sizingCheck(ties).status,'passed');
 const native=verticalProof();
 for(const card of native.groups[0].cards)card.stopper={height:37,presetHeight:37,minHeight:31};
 assert.equal(sizingCheck(native).status,'passed','native height/minimum are measurements, not example constants');
});

test('vertical Benefits rejects unequal roots or wrappers and requires a maximum-content HUG anchor',async t=>{
 const cases={
  allHug:r=>r.groups[0].cards.forEach((card,index)=>{card.verticalSizing='HUG';card.wrapper.verticalSizing='HUG';card.height=[162,186,208][index];}),
  allFillWithUnequalWrappers:r=>r.groups[0].cards.forEach((card,index)=>{card.verticalSizing='FILL';card.wrapper.verticalSizing='FILL';card.wrapper.height=[54,78,54][index];}),
  allFillWithEqualWrappers:r=>r.groups[0].cards.forEach(card=>{card.verticalSizing='FILL';card.wrapper.verticalSizing='FILL';}),
  equalRootsUnequalWrappers:r=>{r.groups[0].cards[0].wrapper.height=54;},
  shortAnchor:r=>{const [first,second]=r.groups[0].cards;first.verticalSizing='HUG';first.wrapper.verticalSizing='HUG';second.verticalSizing='FILL';second.wrapper.verticalSizing='FILL';},
  rootOnlyHug:r=>{r.groups[0].cards[0].verticalSizing='HUG';},
  wrapperOnlyHug:r=>{r.groups[0].cards[0].wrapper.verticalSizing='HUG';},
  contentFill:r=>{r.groups[0].cards[0].content.verticalSizing='FILL';},
  stopperFill:r=>{r.groups[0].cards[0].stopperSizing='FILL';},
  changedStopperHeight:r=>{r.groups[0].cards[0].stopper.height=32;},
  belowNativeMinimum:r=>{for(const card of r.groups[0].cards)card.stopper.minHeight=29;},
  mixedNativePresetHeight:r=>{r.groups[0].cards[0].stopper={height:30,presetHeight:30,minHeight:24};},
  contentOverflowsHeight:r=>{r.groups[0].cards[0].content.height=80;},
  contentOverflowsWidth:r=>{r.groups[0].cards[0].content.width=270;},
  contentShiftedOutsideWrapper:r=>{r.groups[0].cards[0].content.x+=4;},
  wrapperOutsideRoot:r=>{r.groups[0].cards[0].wrapper.y=90;},
  graphicOutsideRoot:r=>{r.groups[0].cards[0].graphicBounds.x=-20;},
  unequalGraphicBaseline:r=>{r.groups[0].cards[0].graphicBottom-=3;r.groups[0].cards[0].graphicBounds.y-=3;},
  reportedBaselineDisagreesWithBounds:r=>{r.groups[0].cards[0].graphicBounds.y-=3;},
 };
 for(const [name,mutate] of Object.entries(cases))await t.test(name,()=>{
  const r=verticalProof();mutate(r);assert.equal(sizingCheck(r).status,'failed');
 });
});

test('vertical Benefits missing or incorrectly typed native facts stay unknown at their exact field',async t=>{
 const cases=[
  ['preset.componentKey',card=>{delete card.preset;}],
  ['preset.componentKey',card=>{card.preset.componentKey='not-a-key';}],
  ['x',card=>{delete card.x;}],
  ['graphicBottom',card=>{card.graphicBottom='266';}],
  ['wrapper.id',card=>{delete card.wrapper.id;}],
  ['wrapper.id',card=>{card.wrapper.id=card.id;}],
  ['wrapper.height',card=>{card.wrapper.height='78';}],
  ['wrapper.verticalSizing',card=>{delete card.wrapper.verticalSizing;}],
  ['content.x',card=>{delete card.content;}],
  ['content.width',card=>{card.content.width=0;}],
  ['graphicBounds.x',card=>{delete card.graphicBounds;}],
  ['graphicBounds.height',card=>{card.graphicBounds.height=Infinity;}],
  ['stopper.height',card=>{delete card.stopper;}],
  ['stopper.presetHeight',card=>{card.stopper.presetHeight='28';}],
  ['stopper.minHeight',card=>{card.stopper.minHeight=null;}],
  ['stopper.minHeight',card=>{card.stopper.minHeight=-1;}],
  ['verticalSizing',card=>{delete card.verticalSizing;}],
 ];
 for(const [field,mutate] of cases)await t.test(field,()=>{
  const r=verticalProof();mutate(r.groups[0].cards[0]);
  const check=verifyContent(r,benefitsInventory,[])[0];
  assert.equal(check.status,'unknown');assert.equal(check.details[0].path,'contentReadback.groups[0].cards[0].'+field);
 });
});

test('vertical Benefits mode has a narrow applicability boundary instead of a legacy fallback',async t=>{
 const cases=[
  ['sizingMode',group=>{group.sizingMode='vertical';}],
  ['platform',group=>{group.platform='M';}],
  ['capacity',group=>{group.capacity=4;}],
  ['cards[0].preset.cardAxis',group=>{group.cards[0].preset.cardAxis='Horizontal';}],
  ['cards[0].preset.compact',group=>{group.cards[0].preset.compact='False';}],
  ['cards[0].preset.compact',group=>{group.cards[0].preset.compact=true;}],
  ['cards[0].preset.background',group=>{group.cards[0].preset.background='False';}],
  ['cards[0].preset.graphicPosition',group=>{group.cards[0].preset.graphicPosition='Top';}],
  ['cards[1].preset.graphicPosition',group=>{group.cards[1].preset.graphicPosition='Left';}],
  ['cards[1].preset.componentKey',group=>{group.cards[1].preset.componentKey='d'.repeat(40);}],
 ];
 for(const [field,mutate] of cases)await t.test(field,()=>{
  const r=verticalProof();mutate(r.groups[0]);const check=verifyContent(r,benefitsInventory,[])[0];
  assert.equal(check.status,'unknown');assert.equal(check.details[0].code,'CONTENT_SIZING_MODE_UNSUPPORTED');
  assert.equal(check.details[0].path,'contentReadback.groups[0].'+field);
 });
 const bento=proof();bento.groups[0].sizingMode='vertical-content-wrapper';
 assert.equal(verifyContent(bento,inventory,[])[0].details[0].path,'contentReadback.groups[0].sizingMode');
});

test('legacy Benefits, BentoGrid and asset checks are retained with the new optional mode',()=>{
 const legacy=verticalProof();delete legacy.groups[0].sizingMode;
 for(const card of legacy.groups[0].cards){
  card.verticalSizing='FILL';card.stopperSizing='FILL';
  delete card.preset;delete card.wrapper;delete card.content;delete card.stopper;delete card.graphicBounds;
 }
 assert(verifyContent(legacy,benefitsInventory,[]).every(check=>check.status==='passed'));
 assert(verifyContent(proof(),inventory,[]).every(check=>check.status==='passed'));
 const icon=verticalProof();icon.groups[0].cards[0].icon.set='other';
 assert.equal(verifyContent(icon,benefitsInventory,[]).find(check=>check.name==='Иконки Benefits').status,'failed');
 const image=verticalProof();image.groups[0].cards[0].graphicKind='image';image.groups[0].cards[0].icon=null;
 assert.equal(verifyContent(image,benefitsInventory,[]).find(check=>check.name==='Иконки Benefits').status,'failed');
});
