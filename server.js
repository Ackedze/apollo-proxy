require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = process.env.PORT || 3001;
const APOLLO_AGENT_URL =
  process.env.APOLLO_AGENT_URL || process.env.LANGFLOW_URL;
const APOLLO_AGENT_KEY =
  process.env.APOLLO_AGENT_KEY || process.env.LANGFLOW_KEY;
const APOLLO_AGENT_INSECURE_TLS =
  process.env.APOLLO_AGENT_INSECURE_TLS === '1' ||
  process.env.LANGFLOW_INSECURE_TLS === '1';
const APOLLO_AGENT_MAX_ATTEMPTS = Math.max(
  Number.parseInt(process.env.APOLLO_AGENT_MAX_ATTEMPTS || '2', 10) || 2,
  1
);
let dispatcher;

if (APOLLO_AGENT_INSECURE_TLS) {
  try {
    const { Agent } = require('undici');
    dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  } catch (error) {
    console.warn('undici not available, fallback to NODE_TLS_REJECT_UNAUTHORIZED=0');
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }
}

if (!APOLLO_AGENT_URL) {
  console.error('Missing APOLLO_AGENT_URL in .env');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb', strict: false }));

function sanitizeSessionId(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.normalize('NFKC').trim();
  if (!normalized) {
    return null;
  }

  const sanitized = normalized
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '');

  return sanitized || null;
}

function normalizeInput(payload) {
  if (typeof payload === 'string') {
    return {
      text: payload,
      component: 'apollo',
      action: 'audit-report',
      session_id: null,
    };
  }

  if (payload && typeof payload === 'object') {
    const text =
      typeof payload.text === 'string'
        ? payload.text
        : typeof payload.input_value === 'string'
          ? payload.input_value
          : typeof payload.message === 'string'
            ? payload.message
            : payload.report && typeof payload.report === 'object'
              ? JSON.stringify(payload.report)
            : '';
    const component =
      typeof payload.component === 'string' && payload.component.trim()
        ? payload.component.trim()
        : 'apollo';
    const action =
      typeof payload.action === 'string' && payload.action.trim()
        ? payload.action.trim()
        : 'audit-report';
    const session_id =
      typeof payload.session_id === 'string'
        ? sanitizeSessionId(payload.session_id)
        : null;

    if (text) {
      return { text, component, action, session_id };
    }
  }

  return null;
}

function extractLangflowText(data) {
  if (!data) return '';

  const explicitCandidates = [
    data.output,
    data.result,
    data.text,
    data.message,
    data?.outputs?.[0]?.outputs?.[0]?.results?.message?.text,
    data?.outputs?.[0]?.outputs?.[0]?.results?.text?.text,
    data?.outputs?.[0]?.outputs?.[0]?.results?.text,
    data?.outputs?.[0]?.results?.message?.text,
    data?.outputs?.[0]?.results?.text,
    data?.outputs?.[0]?.message?.text,
    data?.outputs?.[0]?.text
  ].filter(Boolean);

  const recursiveCandidates = collectTextCandidates(data);
  const candidates = explicitCandidates.concat(recursiveCandidates);
  const usableCandidate = candidates.find((candidate) =>
    isUsableAgentText(candidate)
  );

  if (usableCandidate) {
    return stripToolCallBlocks(usableCandidate);
  }

  if (candidates.length > 0) {
    return String(candidates[0]);
  }

  return JSON.stringify(data);
}

function collectTextCandidates(data) {
  const visited = new Set();
  const stack = [data];
  const candidates = [];

  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (visited.has(node)) continue;
    visited.add(node);

    for (const value of Object.values(node)) {
      if (typeof value === 'string' && value.trim()) {
        candidates.push(value);
      }
      if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }

  return candidates;
}

function isUsableAgentText(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const text = value.trim();
  if (!text) {
    return false;
  }

  return !looksLikeToolCallOnly(text);
}

function looksLikeToolCallOnly(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const text = value.trim();
  if (!text || !/<tool_call\b/i.test(text)) {
    return false;
  }

  const withoutToolCalls = stripToolCallBlocks(text).trim();

  return !withoutToolCalls;
}

function stripToolCallBlocks(value) {
  return String(value || '')
    .replace(/```(?:json)?\s*<tool_call\b[\s\S]*?<\/tool_call>\s*```/gi, '')
    .replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, '')
    .trim();
}

function buildToolCallRetryPayload(payload, previousResult) {
  const originalText =
    payload && typeof payload.text === 'string' ? payload.text : String(payload || '');
  const recoveryText = [
    'Системная поправка Apollo proxy.',
    'В предыдущей попытке агент вернул служебный <tool_call> вместо финального ответа пользователю.',
    'Не печатай XML/JSON tool-call и служебные ключи. Если нужен инструмент, вызови его внутри сценария, дождись результата и верни только финальный русский Markdown-ответ.',
    '',
    'Исходный пользовательский запрос:',
    originalText,
    '',
    'Предыдущий незавершённый ответ агента:',
    String(previousResult || '').slice(0, 4000),
  ].join('\n');

  return {
    text: recoveryText,
    component: payload.component,
    action: payload.action,
    session_id: payload.session_id,
  };
}

function buildToolCallResponseError(result, attempts) {
  const err = new Error(
    'Apollo agent returned an internal tool call instead of a final answer.'
  );
  err.status = 502;
  err.details = {
    attempts,
    preview: typeof result === 'string' ? result.slice(0, 500) : null,
  };
  return err;
}

function looksLikeHtml(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const sample = value.trim().slice(0, 1024);
  if (!sample) {
    return false;
  }

  return /^<!doctype\s+html/i.test(sample) ||
    /^<html[\s>]/i.test(sample) ||
    /<head[\s>]/i.test(sample) ||
    /<body[\s>]/i.test(sample);
}

function buildHtmlResponseError(contentType, text) {
  const err = new Error(
    'Apollo agent returned HTML instead of JSON. Check APOLLO_AGENT_URL and authorization.'
  );
  err.details = {
    contentType: contentType || null,
    preview: typeof text === 'string' ? text.slice(0, 240) : null
  };
  return err;
}

async function callApolloAgent(payload) {
  const inputValuePayload =
    typeof payload === 'string'
      ? payload
      : payload.text;
  const inputValue =
    typeof inputValuePayload === 'string'
      ? inputValuePayload
      : JSON.stringify(inputValuePayload);
  const sessionId =
    payload && typeof payload.session_id === 'string' && payload.session_id
      ? payload.session_id
      : crypto.randomUUID();
  const body = {
    input_value: inputValue,
    input_type: 'chat',
    output_type: 'chat',
    session_id: sessionId
  };

  const headers = {
    'Content-Type': 'application/json'
  };

  if (APOLLO_AGENT_KEY) {
    headers.Authorization = `Bearer ${APOLLO_AGENT_KEY}`;
    headers['x-api-key'] = APOLLO_AGENT_KEY;
  }

  let response;
  try {
    response = await fetch(APOLLO_AGENT_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      ...(dispatcher ? { dispatcher } : {}),
    });
  } catch (error) {
    const err = new Error('Apollo agent fetch failed');
    err.details = {
      message: error?.message || null,
      cause: error?.cause?.message || null,
      code: error?.cause?.code || null,
    };
    throw err;
  }

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (!response.ok) {
    let details;
    try {
      details = text ? JSON.parse(text) : null;
    } catch {
      details = { raw: text };
    }

    const err = new Error(`Apollo agent HTTP ${response.status}`);
    err.status = response.status;
    err.details = details;
    throw err;
  }

  if (looksLikeHtml(text) || /\btext\/html\b/i.test(contentType)) {
    throw buildHtmlResponseError(contentType, text);
  }

  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    const err = new Error(
      'Apollo agent returned non-JSON response. Check APOLLO_AGENT_URL and API compatibility.'
    );
    err.details = {
      contentType: contentType || null,
      preview: text.slice(0, 240)
    };
    throw err;
  }

  return json;
}

async function callApolloAgentForFinalText(payload) {
  let currentPayload = payload;
  let lastResult = '';

  for (let attempt = 1; attempt <= APOLLO_AGENT_MAX_ATTEMPTS; attempt += 1) {
    const data = await callApolloAgent(currentPayload);
    const result = extractLangflowText(data);

    if (!looksLikeToolCallOnly(result)) {
      return result;
    }

    lastResult = result;
    if (attempt < APOLLO_AGENT_MAX_ATTEMPTS) {
      currentPayload = buildToolCallRetryPayload(payload, result);
    }
  }

  throw buildToolCallResponseError(lastResult, APOLLO_AGENT_MAX_ATTEMPTS);
}

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/analyze', async (req, res) => {
  try {
    const payload = req.body ?? {};
    const inputValue = normalizeInput(payload);

    if (!inputValue || !inputValue.text) {
      res.status(400).json({
        success: false,
        error: 'Empty input. Send a string, { text: "..." }, or { report: {...} }.',
      });
      return;
    }

    const result = await callApolloAgentForFinalText(inputValue);

    if (looksLikeHtml(result)) {
      throw buildHtmlResponseError('text/html', result);
    }

    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message || 'Apollo agent error',
      details: err.details || null,
      status: err.status || null
    });
  }
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Apollo proxy running on http://${HOST}:${PORT}`);
});

server.on('error', (error) => {
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use on ${HOST}`);
      process.exit(1);
    }

    if (error.code === 'EPERM') {
      console.error(`Cannot listen on ${HOST}:${PORT} (${error.code})`);
      process.exit(1);
    }
  }

  console.error('Failed to start Apollo proxy:', error);
  process.exit(1);
});
