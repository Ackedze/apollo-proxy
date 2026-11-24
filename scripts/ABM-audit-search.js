#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {auditAbmPatterns}=require('../src/reports/ABM-audit');
function main(args) {
 const allowed=new Set(['--patterns','--output']);
 const options={};
 for(let i=0;i<args.length;i+=2) {
  if(!allowed.has(args[i])||!args[i+1])throw Error('Usage: node scripts/ABM-audit-search.js --patterns <folder> [--output <report.json>]');
  options[args[i]]=args[i+1];
 }
 if(!options['--patterns'])throw Error('--patterns is required');
 const report=auditAbmPatterns(path.resolve(options['--patterns']));
 const json=JSON.stringify(report,null,2)+'\n';
 if(options['--output'])fs.writeFileSync(path.resolve(options['--output']),json);
 process.stdout.write(JSON.stringify({patternCount:report.patternCount,ruleCount:report.ruleCount,exampleCount:report.exampleCount,errors:report.errors,warnings:report.warnings,
  findingCounts:Object.fromEntries([...new Set(report.findings.map(f=>f.code))].map(code=>[code,report.findings.filter(f=>f.code===code).length]))})+'\n');
 if(!options['--output'])process.stdout.write(json);
 return report.errors?1:0;
}
if(require.main===module){try{process.exitCode=main(process.argv.slice(2));}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}}
module.exports={main};
