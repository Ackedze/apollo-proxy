#!/usr/bin/env node
'use strict';
const path=require('node:path');
const home=path.resolve(__dirname,'..');
const store=path.join(home,'..','code-releases');
require('../src/data-release').retainRelease(process.env.APOLLO_RELEASE_ROOT)
 .then(()=>require('../src/code-release/supervisor').supervise({home,store})).then(code=>{process.exitCode=code;}).catch(error=>{
  console.error('[Apollo code] '+(error.code || error.message));process.exitCode=1;
});
