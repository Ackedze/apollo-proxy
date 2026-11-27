'use strict';

const p = require('./profile');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const openRouter = require('../ux-writer/openrouter');
const WIRE = 'apollo.task-passport.v1';
const ROUTE = '/skills/task-passport/runs';
const KEY = 'X-Apollo-Task-Passport-Key';
const MAX_BYTES = 160 * 1024;
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const array = (value, max, test) => Array.isArray(value) && value.length <= max && value.every(test);
const keyValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const clean = value => value.replace(/\s+/g, ' ').trim();
const error = code => Object.assign(new Error(code), { code });
const invalid = () => { throw error('TASK_PASSPORT_RESPONSE_INVALID'); };
const fieldIds = new Set(p.FIELDS.map(([id]) => id));

function validateInput(body) {
  if (!exact(body, ['schemaVersion','brief','snapshot']) || body.schemaVersion !== WIRE ||
      typeof body.brief !== 'string' || body.brief.length > 8000 || body.brief.includes('\0') ||
      Buffer.byteLength(JSON.stringify(body)) > MAX_BYTES) return false;
  const facts = body.snapshot;
  if (!exact(facts, ['name','screens','links','notes']) || !text(facts.name, 240) ||
      !array(facts.notes, 40, note => text(note, 400)) ||
      !array(facts.screens, 24, screen => exact(screen, ['id','name','box','texts','buttons','components']) &&
        typeof screen.id === 'string' && /^s(?:[1-9]|1[0-9]|2[0-4])$/.test(screen.id) && text(screen.name, 240) &&
        Array.isArray(screen.box) && screen.box.length === 4 && screen.box.every(n => Number.isFinite(n) && Math.abs(n) < 1e8) &&
        screen.box[2] > 0 && screen.box[3] > 0 && array(screen.texts, 160, t => text(t, 400)) &&
        array(screen.buttons, 40, t => text(t, 400)) && array(screen.components, 40, t => text(t, 120)))) return false;
  const ids = new Set(facts.screens.map(screen => screen.id));
  return ids.size > 0 && ids.size === facts.screens.length && array(facts.links, 160, link =>
    exact(link, ['from','to','signal']) && link.from !== link.to && ['connector','prototype'].includes(link.signal) &&
    (ids.has(link.from) && ids.has(link.to) ||
      link.signal === 'connector' && (link.from === null && ids.has(link.to) || link.to === null && ids.has(link.from))));
}

function validateResult(raw, { brief, snapshot }) {
  if (!exact(raw,['status','items','links','questions']) ||
      raw.status !== 'draft' || !array(raw.questions, 32, value => text(value, 500)) ||
      !array(raw.links, 80, link => exact(link,['from','to','signal']) &&
        text(link.from, 4) && text(link.to, 4) && p.SIGNALS.includes(link.signal)) ||
      !array(raw.items, 100, item => exact(item,['field','value','source','screenId','quote']) &&
        fieldIds.has(item.field) && text(item.value, 1200) && ['brief','layout','hypothesis'].includes(item.source) &&
        (item.screenId === null || text(item.screenId, 4)) && (item.quote === null || text(item.quote, 400)))) invalid();
  const questions = [...new Set(raw.questions.map(q => q.trim()))];
  const briefText = clean(brief);
  const screens = new Map(snapshot.screens.map(s => [s.id, s]));
  const items = new Map();
  let omitted = 0;
  for (const item of raw.items) {
    const screen = screens.get(item.screenId);
    const quotes = screen && [screen.name, ...screen.texts, ...screen.buttons, ...screen.components];
    const quote = item.quote === null ? '' : clean(item.quote);
    const literal = ['required_copy','action'].includes(item.field);
    let supported = item.screenId === null || !!screen;
    if (p.BRIEF_ONLY.has(item.field)) supported &&= item.source === 'brief';
    if (['job','mechanics'].includes(item.field)) supported &&= item.source === 'hypothesis';
    if (item.source === 'brief') supported &&= item.screenId === null && !!quote && briefText.includes(quote);
    if (item.source === 'layout') {
      supported &&= !!quote && !!quotes?.some(s => clean(s).includes(quote));
      if (literal) supported &&= clean(item.value) === quote && quotes?.some(s => clean(s) === quote);
    }
    if (!supported) { omitted++; continue; }
    if (!items.has(item.field)) items.set(item.field, []);
    const row = { value:p.BRIEF_ONLY.has(item.field) ? quote : item.value.trim(), source:item.source, screen:screen?.name ?? null, quote:quote || null };
    const existing = items.get(item.field);
    if (!existing.some(value => JSON.stringify(value) === JSON.stringify(row))) existing.push(row);
  }
  const links = new Map();
  const observedLinks = snapshot.links.filter(link => screens.has(link.from) && screens.has(link.to));
  for (const link of observedLinks.concat(raw.links)) {
    const from = screens.get(link.from), to = screens.get(link.to);
    const observed = ['connector','prototype'].includes(link.signal);
    if (!from || !to || from === to || observed && !snapshot.links.some(e => e.from === link.from && e.to === link.to && e.signal === link.signal)) { omitted++; continue; }
    const key = link.from + '>' + link.to;
    const rank = p.SIGNALS.indexOf(link.signal);
    if (links.has(key) && links.get(key).rank <= rank) continue;
    links.set(key, { rank, source:observed ? 'layout' : 'hypothesis',
      value:from.name + ' → ' + to.name + ' (' + p.SIGNAL_LABELS[rank] + (link.signal === 'geometry' ? ' — проверьте' : '') + ')' });
  }
  const paths = Array.from(links.values(), ({source,value}) => ({source,value,screen:null,quote:null}));
  const steps = items.get('scenario') || [];
  const includedSteps = steps.slice(0,Math.max(0,180-paths.length));
  items.set('scenario', includedSteps.concat(paths.slice(0,180)));
  const row = (value, source = 'none') => ({ value, source, screen:null, quote:null });
  const observed = Array.from(links.values()).filter(link => link.source === 'layout').length;
  const coverage = [
    'Экранов в выделении: ' + snapshot.screens.length + '. Подтверждённых переходов: ' + observed + '. Предположений о переходах: ' + (links.size - observed) + '.',
    'Чувствительных мест в паспорте: ' + (items.get('sensitivity')?.length || 0) + '.',
  ];
  if (steps.length + paths.length > 180) coverage.push('Сценарий ограничен 180 пунктами. Все подтверждённые переходы сохранены.');
  if (omitted) coverage.push('Утверждений и переходов без подтверждённой ссылки: ' + omitted + '.');
  items.set('flow',[row(snapshot.name,'layout')]);
  items.set('status',[row('Черновик: дизайнер дополняет и подтверждает')]);
  items.set('assessment',coverage.map(value => row(value)));
  items.set('questions',questions.map(value => row(value)));
  const sections = p.SECTIONS.map(([title, fields]) => ({ title, rows: fields.map(([id, label]) => ({
    label, items:items.get(id)?.length ? items.get(id) :
      p.OPTIONAL.has(id) || id === 'questions' ? [row('Не указано')] : [row('Нужно заполнить','missing')],
  })) }));
  return { status: 'draft', sections };
}

function mount(app, { approval, invoke = openRouter.completeStructured, journal, enter, onFailure = () => {} }) {
  const runs = new Map();
  function send(res, status, value) {
    res.set('Cache-Control','no-store').status(status).json(value);
  }
  function get(req) {
    const key = req.get(KEY), run = runs.get(req.params.id);
    return run && keyValid(key) && openRouter.allowsLocalRequest(req) &&
      timingSafeEqual(Buffer.from(key), Buffer.from(run.key)) ? run : null;
  }
  app.post(ROUTE, (req,res) => {
    const key = req.get(KEY);
    if (!openRouter.allowsLocalRequest(req)) return send(res,403,{error:'OPENROUTER_LOCAL_REQUEST_REQUIRED'});
    if (!approval) return send(res,503,{error:'OPENROUTER_DISABLED'});
    if (!keyValid(key) || !validateInput(req.body)) return send(res,400,{error:'TASK_PASSPORT_INPUT_INVALID'});
    const leave = enter();
    if (!leave) return send(res,429,{error:'TASK_PASSPORT_BUSY'});
    if (runs.size >= 16) runs.delete(runs.keys().next().value);

    const input = req.body, controller = new AbortController();
    const id = 'run_' + randomUUID();
    const run = { key, controller, view:{ schemaVersion:WIRE, skillVersion:p.VERSION, id, status:'awaiting_approval' } };
    runs.set(id,run);
    send(res,202,run.view);
    const entry = journal?.begin('Паспорт задачи');
    const work = async () => {
      const signal = controller.signal;
      try {
        const apiKey = await approval.wait({runId:id,kind:'task-passport',screens:input.snapshot.screens.length}, signal);
        signal.throwIfAborted();
        run.view.status = 'analyzing';
        const tracked = journal?.call({provider:'openrouter', model:openRouter.MODEL});
        try {
          const raw = await invoke({
            key:apiKey, prompt:p.promptFor(input), cancellation:signal,
            format:{name:'task_passport_v1',schema:p.schema,invalidCode:'TASK_PASSPORT_RESPONSE_INVALID'},
            onUsage:usage => tracked?.event({type:'turn.completed',usage}),
          });
          signal.throwIfAborted();
          run.view.result = validateResult(raw,input);
          run.view.status = 'completed';
        } finally { tracked?.end(); }
      } catch (e) {
        if (signal.aborted) { run.view.status = 'cancelled'; return; }
        const code = /^(OPENROUTER_[A-Z_]+|TASK_PASSPORT_RESPONSE_INVALID)$/.test(e?.code || '') ? e.code : 'OPENROUTER_UNAVAILABLE';
        run.view.status = 'failed';
        run.view.error = code;
        onFailure({runId:id,code});
      } finally {
        leave();
        if (entry) journal.finish(entry,run.view.status);
        const timer = setTimeout(() => runs.delete(id), 5 * 60_000);
        timer.unref?.();
      }
    };
    void (entry ? journal.within(entry,work) : work());
  });
  app.get(ROUTE + '/:id', (req,res) => {
    const run = get(req);
    return run ? send(res,200,run.view) : send(res,404,{error:'TASK_PASSPORT_RUN_UNAVAILABLE'});
  });
  app.post(ROUTE + '/:id/cancel', (req,res) => {
    const run = get(req);
    if (!run) return send(res,404,{error:'TASK_PASSPORT_RUN_UNAVAILABLE'});
    if (['awaiting_approval','analyzing'].includes(run.view.status)) {
      run.controller.abort();
      run.view.status = 'cancelled';
    }
    return send(res,200,run.view);
  });
}

module.exports = { WIRE, KEY, mount, validateInput, validateResult };
