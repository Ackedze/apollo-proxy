'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const SCHEMA = 'apollo.token-operation.v1';
const count = n => Number.isSafeInteger(n) && n >= 0;
const usageFields = ['input_tokens', 'output_tokens', 'cached_input_tokens', 'reasoning_output_tokens'];
let configured = null;

function createTokenJournal(root, { now = Date.now, onError = error => console.warn('[Apollo][tokens]', error.code || 'JOURNAL_UNAVAILABLE') } = {}) {
  const context = new AsyncLocalStorage(), active = new Set(), named = new Map(), sessions = new Map();
  function safe(action) { try { return action(); } catch (error) { onError(error); return null; } }
  function write(entry) {
    return safe(() => {
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      if (!path.isAbsolute(root) || fs.realpathSync(root) !== root) throw Error('Unsafe token journal');
      const target = path.join(root, entry.value.id + '.json'), temp = target + '.' + crypto.randomUUID() + '.tmp';
      try {
        fs.writeFileSync(temp, JSON.stringify(entry.value) + '\n', { flag: 'wx', mode: 0o600 });
        fs.renameSync(temp, target);
      } finally { fs.rmSync(temp, { force: true }); }
      return true;
    });
  }
  function update(entry) {
    let input = 0, output = 0, cached = 0, reasoning = 0, cachedKnown = true, reasoningKnown = true, complete = entry.calls.size > 0;
    for (const call of entry.calls.values()) {
      const turns = call.events.filter(e => e.type === 'turn.completed');
      const started = call.events.filter(e => e.type === 'turn.started').length;
      complete &&= call.done && turns.length > 0 && started <= turns.length && !call.events.some(e => e.type === 'turn.failed');
      cachedKnown &&= turns.length > 0; reasoningKnown &&= turns.length > 0;
      for (const event of turns) {
        const u = event.usage || {};
        if (count(u.input_tokens)) input += u.input_tokens; else complete = false;
        if (count(u.output_tokens)) output += u.output_tokens; else complete = false;
        if (count(u.cached_input_tokens) && u.cached_input_tokens <= u.input_tokens) cached += u.cached_input_tokens; else cachedKnown = false;
        if (count(u.reasoning_output_tokens) && u.reasoning_output_tokens <= u.output_tokens) reasoning += u.reasoning_output_tokens; else reasoningKnown = false;
      }
    }
    if (!count(input) || !count(output) || !count(input + output)) complete = false;
    Object.assign(entry.value, { inputTokens: input, outputTokens: output, cachedInputTokens: cachedKnown && count(cached) ? cached : null,
      reasoningOutputTokens: reasoningKnown && count(reasoning) ? reasoning : null,
      calls: entry.calls.size, totalTokens: complete ? input + output : entry.calls.size === 0 && entry.value.status !== 'running' ? 0 : null,
      updatedAt: new Date(now()).toISOString() });
    write(entry);
  }
  function begin(operation, { provider = null, model = null } = {}) {
    const entry = { start: now(), calls: new Map(), value: { schemaVersion: SCHEMA, id: crypto.randomUUID(), operation,
      startedAt: new Date(now()).toISOString(), durationMs: null, status: 'running', provider, model,
      inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: null, calls: 0 } };
    active.add(entry); write(entry); return entry;
  }
  function finish(entry, status = 'completed') {
    if (!entry || entry.value.status !== 'running') return;
    entry.value.status = status; entry.value.durationMs = Math.max(0, now() - entry.start);
    active.delete(entry); update(entry);
  }
  function call({ provider, model, operation = 'Запрос к агенту', cumulativeUsage = false, resumeSessionId = null } = {}) {
    const parent = context.getStore(), entry = parent || begin(operation, { provider, model });
    const state = { events: [], done: false }; entry.calls.set(crypto.randomUUID(), state);
    const cumulative = provider === 'codex' && cumulativeUsage;
    let sessionId = null, identified = false, previous = resumeSessionId ? sessions.get(resumeSessionId) : Object.fromEntries(usageFields.map(key => [key, 0]));
    let lastUsage = null;
    entry.value.provider ||= provider || null; entry.value.model ||= model || null;
    update(entry);
    return {
      event(event) {
        if (state.done) return;
        if (cumulative && event?.type === 'thread.started') {
          if (sessionId === null) {
            sessionId = event.thread_id;
            identified = typeof sessionId === 'string' && /^[a-f0-9-]{36}$/i.test(sessionId)
              && (resumeSessionId ? sessionId === resumeSessionId : !sessions.has(sessionId));
          } else if (sessionId !== event.thread_id) identified = false;
          return;
        }
        if (!['turn.started', 'turn.completed', 'turn.failed'].includes(event?.type)) return;
        // Persist only counters, never model messages, prompts, tool output or credentials.
        let usage;
        if (event.type === 'turn.completed') {
          usage = Object.fromEntries(usageFields.map(key => [key, event.usage?.[key]]));
          if (cumulative) {
            const raw = usage;
            // Each CLI completion is a session counter, including all internal model iterations.
            usage = Object.fromEntries(usageFields.map(key => [key, identified && count(raw[key]) && count(previous?.[key]) && raw[key] >= previous[key] ? raw[key] - previous[key] : undefined]));
            lastUsage = raw; previous = raw;
          }
        }
        state.events.push({ type: event.type, usage });
        update(entry);
      },
      end(error) {
        if (state.done) return;
        state.done = true;
        if (cumulative) {
          const key = resumeSessionId || sessionId;
          // Missing final usage leaves an unmeasured gap; do not charge it to the next batch.
          if (identified && state.events.at(-1)?.type === 'turn.completed' && count(lastUsage?.input_tokens) && count(lastUsage?.output_tokens)) sessions.set(sessionId, lastUsage);
          else if (key) sessions.delete(key);
        }
        if (!parent) finish(entry, error ? 'failed' : 'completed'); else update(entry);
      },
    };
  }
  function read() {
    const records = [], errors = [];
    if (!fs.existsSync(root)) return { records, errors };
    for (const file of fs.readdirSync(root)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue;
      try {
        const target = path.join(root, file), stat = fs.lstatSync(target);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw Error('Invalid journal entry');
        const value = JSON.parse(fs.readFileSync(target, 'utf8'));
        if (value.schemaVersion !== SCHEMA || value.id + '.json' !== file || !Number.isFinite(Date.parse(value.startedAt))
          || typeof value.operation !== 'string' || value.operation.length > 120 || !['running', 'completed', 'failed', 'cancelled', 'interrupted'].includes(value.status)
          || !count(value.inputTokens) || !count(value.outputTokens) || value.totalTokens !== null && !count(value.totalTokens)) throw Error('Invalid journal entry');
        records.push(value);
      } catch { errors.push(file); }
    }
    records.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
    return { records, errors };
  }
  function recover() {
    const previous = safe(read);
    for (const value of previous?.records || []) if (value.status === 'running' && value.timeSource !== 'plugin') {
      value.status = 'interrupted'; value.durationMs = null; value.totalTokens = null;
      write({ value });
    }
  }
  recover();
  return {
    root, begin, finish, call, read,
    within: (entry, fn) => context.run(entry, fn),
    async operation(label, fn) {
      const entry = begin(label);
      try { const result = await context.run(entry, fn); finish(entry); return result; }
      catch (error) { finish(entry, 'failed'); throw error; }
    },
    startNamed(key, label) { if (!named.has(key)) named.set(key, begin(label)); },
    withinNamed(key, fn) { const entry = named.get(key); return entry ? context.run(entry, fn) : fn(); },
    finishNamed(key, status) { finish(named.get(key), status); named.delete(key); },
    close() { for (const entry of active) { finish(entry, 'interrupted'); } sessions.clear(); },
    middleware(req, res, next) {
      const labels = { '/v1/validate/codex': 'Проверить · AI', '/v1/validate/predicates': 'Проверить · локально',
        '/v1/generation/plan': 'Генерация · план', '/v2/contracts/explain': 'Объяснить проверку',
        '/skills/layer-names/plan': 'Навык · Переименовать слои', '/generation/plan': 'Генерация · план',
        '/generation/frontend/execute': 'Генерация · frontend' };
      const label = req.path === '/analyze' ? req.body?.report ? 'Проверить · AI' : 'Спросить' : labels[req.path];
      if (req.method !== 'POST' || !label) return next();
      const entry = begin(label);
      res.once('finish', () => finish(entry, res.statusCode >= 400 ? 'failed' : 'completed'));
      res.once('close', () => finish(entry, 'cancelled'));
      return context.run(entry, next);
    },
  };
}

function mountJournalRoutes(app, journal) {
  app.get('/usage', (req, res) => {
    try {
      const value = journal.read();
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, records: value.records, unreadableRecords: value.errors.length });
    } catch { res.status(503).json({ success: false, code: 'TOKEN_JOURNAL_UNAVAILABLE' }); }
  });
  app.post('/usage/local', (req, res) => {
    const labels = {check:'Проверить',recheck:'Перепроверить область','reglyph-scan':'Навык · Обновить иконки · проверка',
      'reglyph-replace':'Навык · Обновить иконки · замена','layer-names-run':'Навык · Переименовать слои · итог запуска',
      'layer-names-apply':'Навык · Переименовать слои · применение','layer-names-undo':'Навык · Переименовать слои · отмена замен',
      'pattern-check':'Проверка паттернов · итог запуска'};
    const b = req.body, keys = b && Object.keys(b).sort().join(','), mode = b?.usageMode === undefined ? 'none' : b.usageMode;
    if (!b || !['durationMs,id,operation,startedAt,status','durationMs,id,operation,startedAt,status,usageMode'].includes(keys)
      || !Object.hasOwn(labels,b.operation) || typeof b.id !== 'string' || !/^[a-zA-Z0-9:_-]{1,150}$/.test(b.id)
      || typeof b.startedAt !== 'string' || b.startedAt.length>40 || !Number.isFinite(Date.parse(b.startedAt))
      || !['running','completed','failed','cancelled','interrupted'].includes(b.status)
      || (b.durationMs===null ? !['running','interrupted'].includes(b.status) : !count(b.durationMs) || b.durationMs>86400000)
      || !(mode==='none' || mode==='separate' && ['layer-names-run','pattern-check'].includes(b.operation))) {
      res.status(400).json({ success: false, code: 'TOKEN_LOCAL_RECORD_INVALID' }); return;
    }
    const hash = crypto.createHash('sha256').update((b.operation==='check'?'local-check:':'local-'+b.operation+':')+b.id).digest('hex');
    const id = [hash.slice(0,8),hash.slice(8,12),hash.slice(12,16),hash.slice(16,20),hash.slice(20,32)].join('-');
    const value = {schemaVersion:SCHEMA,id,operation:labels[b.operation],startedAt:new Date(b.startedAt).toISOString(),durationMs:b.durationMs,
      status:b.status,provider:null,model:null,timeSource:'plugin',inputTokens:0,outputTokens:0,cachedInputTokens:0,totalTokens:mode==='separate'?null:0,calls:0};
    // Preserve the old check record bytes for compatible, idempotent retries.
    if (mode==='separate') value.usageMode=mode;
    try {
      fs.mkdirSync(journal.root,{recursive:true,mode:0o700});
      if(fs.realpathSync(journal.root)!==journal.root)throw Error('Unsafe token journal');
      const file=path.join(journal.root,id+'.json'),bytes=JSON.stringify(value)+'\n',temp=file+'.'+crypto.randomUUID()+'.tmp';
      let existing=null;
      try {
        const stat=fs.lstatSync(file);
        if(!stat.isFile() || stat.isSymbolicLink() || stat.size>16384)throw Error('Unsafe token record');
        existing=fs.readFileSync(file,'utf8');
      }catch(error){if(error.code!=='ENOENT')throw error;}
      if(existing && existing!==bytes){
        const old=JSON.parse(existing);
        if(old.schemaVersion!==SCHEMA || old.id!==id || old.operation!==value.operation || old.startedAt!==value.startedAt || old.timeSource!=='plugin'
          || old.provider!==null || old.model!==null || old.inputTokens!==0 || old.outputTokens!==0 || old.calls!==0
          || !['running','interrupted'].includes(old.status) || old.usageMode==='separate' && mode!=='separate') {
          res.status(409).json({success:false,code:'TOKEN_LOCAL_RECORD_REPLAY'});return;
        }
      }
      if(existing!==bytes){
        try{fs.writeFileSync(temp,bytes,{flag:'wx',mode:0o600});if(existing)fs.renameSync(temp,file);else fs.linkSync(temp,file);}
        finally{fs.rmSync(temp,{force:true});}
      }
      res.json({success:true,id:b.id,status:b.status});
    }catch{res.status(503).json({success:false,code:'TOKEN_JOURNAL_UNAVAILABLE'});}
  });
}

function wrapAgentService(service, label) {
  const journal = configured;
  if (!journal) return service;
  const started = new Map();
  return { ...service, async start(body) {
    const identity = body?.identity || body, id = identity?.runId;
    const existing = started.get(id), entry = existing || journal.begin(label);
    try {
      const value = await journal.within(entry, () => service.start(body));
      if (!existing) {
        started.set(id, entry);
        Promise.resolve(service.whenSettled(identity)).then(async () => {
          const terminal = await service.poll({ ...identity, afterSequence: 0 });
          journal.finish(entry, terminal.status === 'cancelled' ? 'cancelled' : ['completed', 'question'].includes(terminal.status) ? 'completed' : 'failed');
        }).catch(() => journal.finish(entry, 'failed'));
      }
      return value;
    } catch (error) { if (!existing) journal.finish(entry, 'failed'); throw error; }
  } };
}
module.exports = { SCHEMA, createTokenJournal, wrapAgentService, mountJournalRoutes, configure: journal => { configured = journal; }, current: () => configured,
  trackCall: options => configured?.call(options) };
