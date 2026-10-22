'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const SCHEMA = 'apollo.token-operation.v1';
const count = n => Number.isSafeInteger(n) && n >= 0;
let configured = null;

function createTokenJournal(root, { now = Date.now, onError = error => console.warn('[Apollo][tokens]', error.code || 'JOURNAL_UNAVAILABLE') } = {}) {
  const context = new AsyncLocalStorage(), active = new Set(), named = new Map();
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
    let input = 0, output = 0, cached = 0, complete = entry.calls.size > 0;
    for (const call of entry.calls.values()) {
      const turns = call.events.filter(e => e.type === 'turn.completed');
      const started = call.events.filter(e => e.type === 'turn.started').length;
      complete &&= call.done && turns.length > 0 && started <= turns.length && !call.events.some(e => e.type === 'turn.failed');
      for (const event of turns) {
        const u = event.usage || {};
        if (count(u.input_tokens)) input += u.input_tokens; else complete = false;
        if (count(u.output_tokens)) output += u.output_tokens; else complete = false;
        if (count(u.cached_input_tokens)) cached += u.cached_input_tokens;
      }
    }
    if (!count(input) || !count(output) || !count(input + output)) complete = false;
    Object.assign(entry.value, { inputTokens: input, outputTokens: output, cachedInputTokens: cached,
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
  function call({ provider, model, operation = 'Запрос к агенту' } = {}) {
    const parent = context.getStore(), entry = parent || begin(operation, { provider, model });
    const state = { events: [], done: false }; entry.calls.set(crypto.randomUUID(), state);
    entry.value.provider ||= provider || null; entry.value.model ||= model || null;
    update(entry);
    return {
      event(event) {
        if (!['turn.started', 'turn.completed', 'turn.failed'].includes(event?.type)) return;
        // Persist only counters, never model messages, prompts, tool output or credentials.
        state.events.push({ type: event.type, usage: event.type === 'turn.completed' ? {
          input_tokens: event.usage?.input_tokens, output_tokens: event.usage?.output_tokens, cached_input_tokens: event.usage?.cached_input_tokens,
        } : undefined });
        update(entry);
      },
      end(error) {
        if (state.done) return;
        state.done = true;
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
    for (const value of previous?.records || []) if (value.status === 'running') {
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
    close() { for (const entry of active) { finish(entry, 'interrupted'); } },
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
    const b = req.body;
    if (!b || Object.keys(b).sort().join(',') !== 'durationMs,id,operation,startedAt,status' || b.operation !== 'check'
      || typeof b.id !== 'string' || !b.id.length || b.id.length > 150 || typeof b.startedAt !== 'string'
      || !Number.isFinite(Date.parse(b.startedAt)) || !count(b.durationMs) || b.durationMs > 86400000
      || !['completed', 'failed', 'cancelled'].includes(b.status)) {
      res.status(400).json({ success: false, code: 'TOKEN_LOCAL_RECORD_INVALID' }); return;
    }
    const hash = crypto.createHash('sha256').update('local-check:' + b.id).digest('hex');
    const id = [hash.slice(0,8),hash.slice(8,12),hash.slice(12,16),hash.slice(16,20),hash.slice(20,32)].join('-');
    const value = { schemaVersion: SCHEMA, id, operation: 'Проверить', startedAt: new Date(b.startedAt).toISOString(),
      durationMs: b.durationMs, status: b.status, provider: null, model: null, timeSource: 'plugin',
      inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, calls: 0 };
    try {
      fs.mkdirSync(journal.root, { recursive: true, mode: 0o700 });
      if (fs.realpathSync(journal.root) !== journal.root) throw Error('Unsafe token journal');
      const file = path.join(journal.root, id + '.json'), bytes = JSON.stringify(value) + '\n', temp = file + '.' + crypto.randomUUID() + '.tmp';
      try { fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 }); fs.linkSync(temp, file); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384 || fs.readFileSync(file, 'utf8') !== bytes) {
          res.status(409).json({ success: false, code: 'TOKEN_LOCAL_RECORD_REPLAY' }); return;
        }
      } finally { fs.rmSync(temp, { force: true }); }
      res.json({ success: true });
    } catch { res.status(503).json({ success: false, code: 'TOKEN_JOURNAL_UNAVAILABLE' }); }
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
