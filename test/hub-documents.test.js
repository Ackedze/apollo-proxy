'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {selectHubDocuments}=require('../src/knowledge-routing/hub-documents');
const BASE='knowledge/data/ds-ai-hub/';
const unit=(id,path,extra={})=>({id,path,platforms:['web'],targets:['figma'],...extra});
function fixture(){
 const units=[unit('Button','core/web/components/button/guidelines.md',{targets:[]}),unit('Button.adapter.figma','core/web/components/button/figma/adapter.md'),unit('Button.cookbook','core/web/components/button/figma/cookbook.md'),unit('Button.bridge','core/web/components/button/bridge.md',{targets:['figma','code']}),unit('Button.adapter.code','core/web/components/button/code/adapter.md',{targets:['code']}),unit('TitleView.instructions','products/ab/components/title-view/instructions.md'),unit('TitleView.adapter.figma','products/ab/components/title-view/adapter.figma.md'),unit('ptrn:controls.buttons-and-button-groups','products/ab/patterns/buttons-and-buttons-group.md',{targets:[]})];
 return {units,graph:{edges:[]},availableIds:units.map(u=>BASE+u.path),componentIds:['Button'],patternIds:['ptrn:controls.buttons-and-button-groups'],product:'ab',platform:'web',target:'figma'};
}
test('joins exact component and explicit pattern IDs while keeping cookbook/bridge as candidates',()=>{
 const f=fixture(),r=selectHubDocuments(f);
 assert.deepEqual(r.requiredSources.map(s=>s.id).sort(),['core/web/components/button/guidelines.md','core/web/components/button/figma/adapter.md','products/ab/patterns/buttons-and-buttons-group.md'].map(p=>BASE+p).sort());
 assert.deepEqual(r.candidateSources.map(s=>s.id).sort(),['core/web/components/button/figma/cookbook.md','core/web/components/button/bridge.md'].map(p=>BASE+p).sort());
 assert.deepEqual(r.gaps,[]);assert(!JSON.stringify(r).includes('/code/'));
});
test('filters product/platform/target before joining identity and never guesses a near name',()=>{
 const f=fixture();f.units.push(unit('Button','products/abm/components/button/guidelines.md'),unit('Button','core/ios/components/button/guidelines.md',{platforms:['ios']}),unit('Button','core/web/components/button/code.md',{targets:['code']}));f.availableIds.push(...f.units.map(u=>BASE+u.path));
 assert.deepEqual(selectHubDocuments(f).gaps,[]);
 const unknown=selectHubDocuments({...f,componentIds:['ButtonLike'],patternIds:[]});assert.deepEqual(unknown.requiredSources,[]);assert(unknown.gaps.some(g=>g.code==='HUB_COMPONENT_OVERVIEW_MISSING'));
});
test('ambiguous, unregistered and missing packaged sources stay explicit gaps',()=>{
 const f=fixture();f.units.push({...f.units[0],path:'core/web/components/button/other.md'});f.availableIds=f.availableIds.filter(id=>!id.endsWith('/figma/adapter.md'));
 const r=selectHubDocuments({...f,patternIds:['ptrn:missing']});assert(r.gaps.some(g=>g.code==='HUB_UNIT_AMBIGUOUS'));assert(r.gaps.some(g=>g.code==='HUB_SOURCE_NOT_PACKAGED'));assert(r.gaps.some(g=>g.code==='HUB_PATTERN_UNRESOLVED'));assert(!r.requiredSources.some(s=>s.id.includes('/button/')));
});
test('untrusted paths and contract/raw namespaces can never become selected Hub resources',()=>{
 const f=fixture();f.units=[unit('Button','../../secret.md'),unit('Button.adapter.figma','contracts/components/button/source.json'),unit('ptrn:controls.buttons-and-button-groups','knowledge/data/design-system_ab/patterns/buttons.md'),unit('Button.bridge','products/ab/../abm/foreign.md')];f.availableIds=f.units.map(u=>BASE+u.path);
 const r=selectHubDocuments(f);assert.deepEqual(r.requiredSources,[]);assert.deepEqual(r.candidateSources,[]);assert(r.gaps.length);
});
test('dependencies are candidates without transitive inflation; selected children become required normally',()=>{
 const f=fixture();f.componentIds=['TitleView'];f.patternIds=[];f.graph.edges=[{from:'TitleView',kind:'composes',targetType:'core-unit',target:'Button',targetPath:'core/web/components/button/meta.json'},{from:'Button',kind:'composes',targetType:'knowledge-unit',target:'UnobservedTable'},{from:'TitleView',kind:'composes',targetType:'source-internal',target:'Status'},{from:'TitleView',kind:'composes',targetType:'core-unit',target:'Button'}];f.availableIds.push(BASE+'core/web/components/button/meta.json');
 const r=selectHubDocuments(f);assert(r.requiredSources.every(s=>s.id.includes('/title-view/')));assert(r.candidateSources.some(s=>s.id===BASE+'core/web/components/button/guidelines.md'));assert(r.candidateSources.some(s=>!s.id&&s.subject==='Status'));assert(!JSON.stringify(r).includes('UnobservedTable'));
 const promoted=selectHubDocuments({...f,componentIds:['TitleView','Button'],graph:{edges:[]}});assert(promoted.requiredSources.some(s=>s.id===BASE+'core/web/components/button/guidelines.md'));
});
test('duplicate inputs and cyclic metadata produce deterministic deduplicated results',()=>{
 const f=fixture();f.graph.edges=[{from:'Button',kind:'related',target:'Button',targetType:'core-unit'},{from:'Button',kind:'related',target:'TitleView',targetType:'knowledge-unit'},{from:'TitleView',kind:'related',target:'Button',targetType:'core-unit'}];
 const r=selectHubDocuments(f),again=selectHubDocuments({...f,units:f.units.slice().reverse(),availableIds:f.availableIds.slice().reverse(),componentIds:['Button','Button'],patternIds:['ptrn:controls.buttons-and-button-groups','ptrn:controls.buttons-and-button-groups'],graph:{edges:f.graph.edges.slice().reverse()}});
 assert.deepEqual(r,again);assert.equal(new Set(r.requiredSources.map(s=>s.id)).size,r.requiredSources.length);assert(r.candidateSources.every(c=>!r.requiredSources.some(s=>s.id===c.id)));
});
test('missing applicability is a gap rather than an implicit platform approval',()=>{
 const f=fixture();delete f.units[0].platforms;const r=selectHubDocuments(f);assert(r.gaps.some(g=>g.code==='HUB_APPLICABILITY_MISSING'));assert(!r.requiredSources.some(s=>s.id.endsWith('/guidelines.md')));
 assert.equal(selectHubDocuments({...f,units:null}).gaps[0].code,'HUB_ROUTING_METADATA_INVALID');
 assert.equal(selectHubDocuments({...f,availableIds:null}).gaps[0].code,'HUB_ROUTING_METADATA_INVALID');
});
