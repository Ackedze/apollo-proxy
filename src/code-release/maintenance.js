'use strict';
const crypto=require('node:crypto');
function createMaintenance({key,busy,now=Date.now,launchId}) {
  let lease=null;
  let starting=Boolean(launchId);
  if(starting) {
    const confirm=message=>{if(message?.type==='apollo-code-confirmed' && message.id===launchId){starting=false;process.removeListener('message',confirm);}};
    process.on('message',confirm);
  }
  const current=()=>{if(lease && now()>lease.until)lease=null;return lease;};
  const authorized=req=>{
    const value=req.get('x-apollo-code-key') || '';
    return Boolean(/^[a-f0-9]{64}$/.test(key || '') && /^[a-f0-9]{64}$/.test(value) && crypto.timingSafeEqual(Buffer.from(value),Buffer.from(key)));
  };
  function mount(app) {
    app.post('/code-update/prepare',async(req,res)=>{
      if(!authorized(req))return res.status(403).json({success:false,code:'CODE_UPDATE_UNAUTHORIZED'});
      if(starting)return res.status(503).json({success:false,code:'CODE_PROXY_NOT_READY'});
      const id=req.get('x-apollo-code-lease');
      if(!/^[a-f0-9-]{36}$/.test(id || ''))return res.status(400).json({success:false,code:'CODE_LEASE_INVALID'});
      if(current())return res.status(409).json({success:false,code:'CODE_UPDATE_BUSY'});
      lease={id,until:now()+120000};
      try {
        if(await busy()) {lease=null;return res.status(409).json({success:false,code:'CODE_PROXY_BUSY'});}
        return res.json({success:true});
      } catch {lease=null;return res.status(503).json({success:false,code:'CODE_PROXY_NOT_READY'});}
    });
    app.post('/code-update/release',(req,res)=>{
      if(!authorized(req))return res.status(403).json({success:false});
      if(current()?.id===req.get('x-apollo-code-lease'))lease=null;
      res.json({success:true});
    });
    app.use((req,res,next)=>{
      if((starting || current()) && req.path!=='/health')return res.status(503).json({success:false,code:'CODE_UPDATE_IN_PROGRESS',error:'Прокси обновляется. Повторите действие после запуска.'});
      next();
    });
  }
  return {mount};
}
module.exports={createMaintenance};
