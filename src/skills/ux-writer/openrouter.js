'use strict';

const { fetch, readBytes } = require('../../http-fetch');
const { timingSafeEqual } = require('node:crypto');
const schema = require('./result.schema.json');

const MODEL = 'openai/gpt-4.1-mini';
const API = 'https://openrouter.ai/api/v1';

function allowsLocalRequest({ headers, hostname, socket }) {
  // Figma plugin iframes have an opaque origin, serialized as "null".
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
    && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(socket.remoteAddress)
    && (headers.origin === 'null' || headers.origin === undefined);
}

function failure(code, message, status = 502) {
  return Object.assign(new Error(message), { code, status });
}

function createApproval(controlKey, timeoutMs = 60000) {
  const pending = [];
  const hexKey = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  return {
    get current() { return pending[0]?.review ?? null; },
    async wait(review, signal) {
      signal?.throwIfAborted();
      if (!hexKey(controlKey)) throw failure('OPENROUTER_PROXY_REQUIRED', 'Запустите прокси из миниаппа.', 503);
      const key = await new Promise(resolve => {
        const cancel = () => entry.finish(null);
        const timer = setTimeout(cancel, timeoutMs);
        const entry = { review, finish(value) {
          const index = pending.indexOf(entry);
          if (index < 0) return;
          pending.splice(index, 1);
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancel);
          resolve(value);
        } };
        pending.push(entry);
        signal?.addEventListener('abort', cancel, { once: true });
      });
      signal?.throwIfAborted();
      if (!key) throw failure('OPENROUTER_APPROVAL_REQUIRED', 'Отправка текстов в OpenRouter не подтверждена.', 403);
      return key;
    },
    respond(req, res) {
      const token = req.get('X-Apollo-Code-Key');
      if (!allowsLocalRequest(req) || req.headers.origin !== undefined || !hexKey(token) || !hexKey(controlKey) ||
          !timingSafeEqual(Buffer.from(token), Buffer.from(controlKey))) {
        return res.status(403).json({ success: false });
      }
      const { runId, key } = req.body ?? {};
      if (!pending.length || runId !== pending[0].review.runId) return res.status(409).json({ success: false });
      if (key !== null && (typeof key !== 'string' || !/^[!-~]{1,512}$/.test(key))) {
        return res.status(400).json({ success: false });
      }
      pending[0].finish(key);
      return res.json({ success: true });
    },
  };
}

async function request(endpoint, { key, body, timeout, transport, cancellation }) {
  if (typeof key !== 'string' || !/^[!-~]{1,512}$/.test(key)) {
    throw failure('OPENROUTER_KEY_REQUIRED', 'Подключите API-ключ OpenRouter в настройках прокси.', 503);
  }
  const deadline = AbortSignal.timeout(timeout);
  const signal = cancellation ? AbortSignal.any([deadline, cancellation]) : deadline;
  const headers = { Authorization: 'Bearer ' + key, Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  try {
    const response = await transport(API + endpoint, {
      method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined,
      redirect: 'error', signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const status = response.status;
      if (status === 401 || status === 403) {
        throw failure('OPENROUTER_KEY_REJECTED', 'OpenRouter отклонил ключ. Проверьте или замените его в настройках прокси.', status);
      }
      if (status === 402) throw failure('OPENROUTER_CREDITS_REQUIRED', 'Недостаточно средств или исчерпан лимит ключа OpenRouter.', 402);
      if (status === 429) throw failure('OPENROUTER_RATE_LIMIT', 'Слишком много запросов к OpenRouter. Повторите позже.', 429);
      throw failure('OPENROUTER_UNAVAILABLE', 'OpenRouter не смог обработать запрос. Повторите позже.');
    }
    return JSON.parse((await readBytes(response, 1024 * 1024)).toString('utf8'));
  } catch (error) {
    cancellation?.throwIfAborted();
    if (error.code?.startsWith?.('OPENROUTER_')) throw error;
    if (signal.aborted) throw failure('OPENROUTER_TIMEOUT', 'OpenRouter не ответил вовремя. Повторите запрос.', 504);
    throw failure('OPENROUTER_UNAVAILABLE', 'Не удалось получить ответ OpenRouter. Проверьте подключение.');
  }
}

async function checkKey(key, transport = fetch) {
  const response = await request('/key', { key, timeout: 12000, transport });
  if (!response?.data || response.data.is_management_key === true || response.data.is_provisioning_key === true) {
    throw failure('OPENROUTER_KEY_REJECTED', 'Используйте обычный API-ключ OpenRouter для вызова моделей.', 403);
  }
}

async function completeStructured({ key, prompt, onUsage, transport = fetch, cancellation, format }) {
  const response = await request('/chat/completions', {
    key, transport, timeout: 120000, cancellation,
    body: {
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_schema', json_schema: { name: format.name, strict: true, schema: format.schema } },
      provider: { require_parameters: true, data_collection: 'deny', zdr: true },
    },
  });
  const usage = response?.usage;
  if (usage) onUsage?.({
    input_tokens: usage.prompt_tokens,
    output_tokens: usage.completion_tokens,
    cached_input_tokens: usage.prompt_tokens_details?.cached_tokens,
    reasoning_output_tokens: usage.completion_tokens_details?.reasoning_tokens,
  });
  const choice = response?.choices?.[0];
  if (choice?.finish_reason === 'stop' && typeof choice.message?.content === 'string') {
    try { return JSON.parse(choice.message.content); } catch {}
  }
  throw failure(format.invalidCode, 'OpenRouter вернул неполный или некорректный ответ.');
}

function complete(options) {
  return completeStructured(Object.assign({}, options, {
    format: { name: 'ux_writer_findings', schema, invalidCode: 'UX_WRITER_RESPONSE_INVALID' },
  }));
}

if (require.main === module) {
  (async () => {
    let key = '';
    for await (const chunk of process.stdin.setEncoding('utf8')) {
      key += chunk;
      if (key.length > 512) break;
    }
    await checkKey(key);
    process.stdout.write('OK');
  })().catch(error => {
    process.stdout.write(error.code || 'OPENROUTER_UNAVAILABLE');
    process.exitCode = 1;
  });
}

module.exports = { MODEL, allowsLocalRequest, createApproval, checkKey, complete, completeStructured };
