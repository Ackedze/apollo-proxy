'use strict';
const path=require('node:path');
const {mountConfiguredAuditRoutes}=require('../figma-audit/runtime');
const {openPatternKnowledge}=require('./knowledge');
function mountConfiguredPatternRoutes(app,options={}){
 const environment=options.environment||process.env;
 return mountConfiguredAuditRoutes(app,Object.assign({},options,{
  root:options.root||path.join(require('../portable-runtime').stateRoot(environment),'pattern-audit'),
  prefix:'/skills/pattern-audit',openKnowledge:openPatternKnowledge,
  journalLabel:'Навык · Проверка паттернов',journalKey:'pattern-audit',exportInput:true
 }));
}
module.exports={mountConfiguredPatternRoutes};
