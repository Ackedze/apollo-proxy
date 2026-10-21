'use strict';
const {VERSION,ReadApiError,canonical}=require('./protocol');
const {createQueryService}=require('./query');
const {VERSION:DISPLAY_VERSION,PERMISSIONS}=require('./display-protocol');
const BASE='/v1/style-token-catalog';
const DISPLAY='/v2/resources/display-names';
function createReadApi(input){
  const get=()=>typeof input==='function'?input():{snapshot:input};
  async function handler(req,res,next){
    const url=new URL(req.url,'http://localhost');
    if(![BASE+'/inventory',BASE+'/query',BASE+'/catalogs',DISPLAY,DISPLAY+'/resolve'].includes(url.pathname)){
      if(next)return next();res.writeHead(404);return res.end();
    }
    const controller=new AbortController();
    const abort=()=>controller.abort(),close=()=>{if(!res.writableEnded)abort();};
    req.once('aborted',abort);res.once('close',close);
    function send(status,payload){
      if(controller.signal.aborted || res.destroyed)return;
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      res.end(canonical(payload));
    }
    try{
      if(url.search)throw new ReadApiError(400,'QUERY_PARAMETERS_UNSUPPORTED');
      const isGet=url.pathname===BASE+'/inventory'||url.pathname===DISPLAY;
      if(req.method!==(isGet?'GET':'POST'))throw new ReadApiError(405,'METHOD_NOT_ALLOWED');
      let value;
      if(!isGet){
        if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw new ReadApiError(415,'JSON_REQUIRED');
        if(Number(req.headers['content-length'])>65536){req.resume();throw new ReadApiError(413,'QUERY_TOO_LARGE');}
        value=req.body;
        if(value===undefined){
          let size=0;const chunks=[];
          for await(const chunk of req){size+=chunk.length;if(size>65536)throw new ReadApiError(413,'QUERY_TOO_LARGE');chunks.push(chunk);}
          try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ReadApiError(400,'INVALID_JSON');}
        }
      }
      const provider=get();
      if(controller.signal.aborted)return;
      if(url.pathname===BASE+'/inventory')send(200,provider.snapshot.inventory());
      else if(url.pathname===BASE+'/query')send(200,createQueryService(provider.snapshot).query(value));
      else if(url.pathname===BASE+'/catalogs')send(200,await provider.catalogs(value,{signal:controller.signal}));
      else if(url.pathname===DISPLAY)send(200,provider.display.inventory());
      else send(200,provider.display.query(value));
    }catch(e){
      const status=e.status||500,code=e.code||'INTERNAL_READ_ERROR';
      send(status,url.pathname.startsWith(DISPLAY)?{protocolVersion:DISPLAY_VERSION,state:'unavailable',resources:[],error:{code},permissions:PERMISSIONS}
        :{protocolVersion:VERSION,ok:false,error:code,bindingPermission:false});
    }finally{req.removeListener('aborted',abort);res.removeListener('close',close);}
  }
  return {handler,query:value=>createQueryService(get().snapshot).query(value),inventory:()=>get().snapshot.inventory()};
}
module.exports={BASE,createReadApi};
