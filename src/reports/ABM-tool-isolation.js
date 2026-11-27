'use strict';
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const failure=()=>Object.assign(new Error('Не удалось отключить внешние инструменты Codex для ответа в чате. Запрос не запущен.'),{code:'ABM_TOOL_ISOLATION_FAILED',status:503});

// Disable only active inherited entries. Touching an already disabled legacy entry
// can make Codex validate an otherwise ignored, obsolete transport configuration.
async function isolateAbmTools(binary,args,environment,cwd) {
 const settings=[];
 for(let i=0;i<args.length;i++)if(['-c','--config'].includes(args[i]))settings.push('-c',args[++i]);
 const inventory=async overrides=>{
  try {
   const {stdout}=await run(binary,[...settings,...overrides,'mcp','list','--json'],
    {env:environment,cwd,timeout:10000,maxBuffer:262144,windowsHide:true});
   const rows=JSON.parse(stdout);
   if(!Array.isArray(rows)||rows.length>128||rows.some(row=>!row||!/^[-\w]{1,128}$/.test(row.name)||typeof row.enabled!=='boolean'))throw failure();
   return rows;
  }catch{throw failure();}
 };
 const active=(await inventory([])).filter(row=>row.enabled);
 const disabled=active.flatMap(row=>['-c','mcp_servers.'+row.name+'.enabled=false']);
 if((await inventory(disabled)).some(row=>row.enabled))throw failure();
 // exec ignores the transport definitions that mcp list loaded from user config.
 const overrides=args.includes('--ignore-user-config')
  ? active.flatMap(row=>['-c','mcp_servers.'+row.name+'={command="false",enabled=false}'])
  : disabled;
 return [...args.slice(0,-1),...overrides,args.at(-1)];
}
module.exports={isolateAbmTools};
