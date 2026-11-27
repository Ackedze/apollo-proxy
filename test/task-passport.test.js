'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { once } = require('node:events');
const express = require('express');
const { WIRE, KEY, mount, validateInput, validateResult } = require('../src/skills/task-passport');
const { MODEL, createApproval, completeStructured } = require('../src/skills/ux-writer/openrouter');

const controlKey = 'a'.repeat(64), runKey = 'b'.repeat(64);
const input = {
  schemaVersion:WIRE, brief:'Доработка платежей. Цель — сократить количество ошибок.',
  snapshot:{name:'Платёж', notes:[], links:[{from:'s1',to:'s2',signal:'prototype'}], screens:[
    {id:'s1',name:'Сумма',box:[0,0,400,800],texts:['Комиссия 3 ₽'],buttons:['Подписать'],components:[]},
    {id:'s2',name:'Готово',box:[500,0,400,800],texts:[],buttons:[],components:[]},
  ]},
};
const model = {
  status:'draft',
  items:[
    {field:'task_type',source:'brief',screenId:null,quote:'Доработка платежей',value:'Доработка платежей'},
    {field:'required_copy',source:'layout',screenId:'s1',quote:'Комиссия 3 ₽',value:'Комиссия 3 ₽'},
    {field:'required_copy',source:'layout',screenId:'s1',quote:'Комиссия 5 ₽',value:'Комиссия 5 ₽'},
  ],
  links:[{from:'s1',to:'s2',signal:'prototype'},{from:'s2',to:'s1',signal:'connector'}],
  questions:['Уточните, на каком шаге пользователь видит комиссию впервые.'],
};

test('validates evidence and recognised brief fields and preserves a useful partial draft', () => {
  assert.equal(validateInput(input),true);
  assert.equal(validateInput(Object.assign({},input,{secret:'extra'})),false);
  const result = validateResult(model,input);
  assert.equal(result.sections.length,7);
  const output = JSON.stringify(result);
  assert.ok(output.includes('Комиссия 3 ₽'));
  assert.ok(output.includes('Сумма → Готово (прототип)'));
  assert.ok(output.includes('без подтверждённой ссылки: 2'));
  assert.ok(!output.includes('Комиссия 5 ₽'));
  assert.ok(!output.includes('Готово → Сумма'));
  const withoutModelLinks = validateResult(Object.assign({},model,{links:[]}),input);
  assert.ok(JSON.stringify(withoutModelLinks).includes('Сумма → Готово (прототип)'));
});

test('a draft can use the layout alone or a short brief without inventing business context', () => {
  const empty = Object.assign({},input,{brief:''});
  assert.equal(validateInput(empty),true);
  assert.equal(validateInput(Object.assign({},input,{brief:'а'.repeat(8001)})),false);
  assert.equal(validateInput(Object.assign({},input,{brief:null})),false);
  assert.equal(validateInput(Object.assign({},input,{brief:'\0'})),false);
  const fields = result => Object.fromEntries(result.sections.flatMap(section =>
    section.rows.map(row => [row.label,row.items[0]])));
  const noBrief = fields(validateResult(model,empty));
  assert.equal(noBrief['Что тексты обязаны донести'].value,'Комиссия 3 ₽');
  assert.equal(noBrief['Сценарий по экранам'].value,'Сумма → Готово (прототип)');
  for (const name of ['Тип задачи','Цель бизнеса','Откуда приходит пользователь']) {
    assert.equal(noBrief[name].source,'missing');
    assert.equal(noBrief[name].value,'Нужно заполнить');
  }
  const short = Object.assign({},input,{brief:'Доработка платежей'});
  assert.equal(validateInput(short),true);
  assert.equal(fields(validateResult(model,short))['Тип задачи'].source,'brief');
  assert.throws(() => validateResult(Object.assign({},model,{status:'brief_insufficient'}),empty),
    {code:'TASK_PASSPORT_RESPONSE_INVALID'});
});

test('HTTP waits for native approval, isolates the draft by key and cancels without sending data', async t => {
  const approval = createApproval(controlKey,2000), app = express();
  let calls = 0, busy = false;
  app.use(express.json());
  app.post('/ux-writer/openrouter/approval',approval.respond);
  mount(app,{
    approval,enter() { if (busy) return null; busy = true; return () => { busy = false; }; },
    async invoke(options) {
      calls++;
      assert.equal(options.key,'approved-key');
      assert.equal(options.format.name,'task_passport_v1');
      assert.ok(options.prompt.includes('Комиссия 3 ₽'));
      assert.equal(Object.hasOwn(options,'maxTokens'),false);
      return completeStructured(Object.assign({},options,{
        transport(url,request) {
          assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');
          const body = JSON.parse(request.body);
          assert.equal(body.model,MODEL);
          assert.equal(body.response_format.json_schema.name,'task_passport_v1');
          for (const field of ['max_tokens','max_completion_tokens','max_output_tokens']) {
            assert.equal(Object.hasOwn(body,field),false,'Proxy must not cap editorial output: '+field);
          }
          return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(model)}}]});
        },
      }));
    },
  });
  const server = app.listen(0,'127.0.0.1');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  await once(server,'listening');
  const base = 'http://127.0.0.1:'+server.address().port;
  const route = base+'/skills/task-passport/runs';
  const headers = {'Content-Type':'application/json',[KEY]:runKey,Origin:'null'};
  const post = (url,body,extra = headers) => fetch(url,{method:'POST',headers:extra,body:JSON.stringify(body)});
  const start = (brief = input.brief) => post(route,Object.assign({},input,{brief}));
  const read = id => fetch(route+'/'+id,{headers}).then(response => response.json());
  const confirm = (runId, key) => post(base+'/ux-writer/openrouter/approval',{runId,key},{'Content-Type':'application/json','X-Apollo-Code-Key':controlKey});
  assert.equal((await post(route,input,Object.assign({},headers,{Origin:'https://outside.test'}))).status,403);
  assert.equal((await post(route,{schemaVersion:WIRE})).status,400);
  const started = await start('');
  assert.equal(started.status,202);
  const {id,status} = await started.json();
  assert.equal(status,'awaiting_approval');
  assert.deepEqual(approval.current,{runId:id,kind:'task-passport',screens:2});
  assert.equal(calls,0);
  assert.equal((await fetch(route+'/'+id)).status,404);
  assert.equal((await confirm('other-run','approved-key')).status,409);
  assert.equal((await confirm(id,'approved-key')).status,200);
  const done = await read(id);
  assert.equal(done.status,'completed');
  assert.equal(calls,1);
  assert.ok(!JSON.stringify(done).includes('approved-key'));

  const next = await start().then(response => response.json());
  assert.equal((await fetch(route+'/'+next.id+'/cancel',{method:'POST',headers})).status,200);
  assert.equal((await read(next.id)).status,'cancelled');
  assert.equal(approval.current,null);
  assert.equal((await confirm(next.id,'approved-key')).status,409);
  assert.equal(calls,1);
});

test('passport can wait behind another approval and cancel without consuming or dismissing it', async t => {
  const approval = createApproval(controlKey,2000), controller = new AbortController(), app = express();
  const other = approval.wait({runId:'other-text-review',texts:1},controller.signal);
  void other.catch(() => {});
  let busy = false, calls = 0;
  app.use(express.json());app.post('/approval',approval.respond);
  mount(app,{approval,enter() {
    if (busy) return null;busy = true;return () => { busy = false; };
  },async invoke(options) { calls++;assert.equal(options.key,'passport-only');return model; }});
  const server = app.listen(0,'127.0.0.1');
  t.after(() => {controller.abort();server.closeAllConnections();return new Promise(resolve => server.close(resolve));});
  await once(server,'listening');
  const base = 'http://127.0.0.1:'+server.address().port, route = base+'/skills/task-passport/runs';
  const headers = {'Content-Type':'application/json',[KEY]:runKey,Origin:'null'};
  const start = () => fetch(route,{method:'POST',headers,body:JSON.stringify(input)});
  const confirm = (runId,key) => fetch(base+'/approval',{method:'POST',headers:{'Content-Type':'application/json','X-Apollo-Code-Key':controlKey},body:JSON.stringify({runId,key})});
  let response = await start();assert.equal(response.status,202);
  const queued = await response.json();
  assert.equal((await start()).status,429,'one passport run at a time');
  assert.equal(approval.current.runId,'other-text-review');
  assert.equal((await confirm(queued.id,'not-for-this-run')).status,409);
  await fetch(route+'/'+queued.id+'/cancel',{method:'POST',headers});
  assert.equal(approval.current.runId,'other-text-review');assert.equal(calls,0);
  response = await start();assert.equal(response.status,202);
  const next = await response.json();
  assert.equal((await confirm('other-text-review','texts-only')).status,200);
  assert.equal(await other,'texts-only');
  assert.equal(approval.current.runId,next.id);
  assert.equal((await confirm(next.id,'passport-only')).status,200);
  const done = await fetch(route+'/'+next.id,{headers}).then(r => r.json());
  assert.equal(done.status,'completed');assert.equal(calls,1);assert.equal(busy,false);
});
