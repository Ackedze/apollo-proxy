'use strict';
function mountRetiredGenerationRoutes(app){
 app.use(['/generation','/v1/generation','/agent/drafts','/agent/runs','/agent/figma','/agent/mcp','/agent/artifacts'],(_req,res)=>res.status(410).json({success:false,code:'GENERATION_RETIRED',message:'Legacy generation was replaced by /landing. Existing user files and history were preserved.'}));
}
module.exports={mountRetiredGenerationRoutes};
