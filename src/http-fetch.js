'use strict';
const { EnvHttpProxyAgent } = require('undici');
let dispatcher;

function proxyFetch(url, options = {}) {
  const configured = ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY'].some(key => process.env[key]);
  if (!configured) return globalThis.fetch(url, options);
  dispatcher ??= new EnvHttpProxyAgent();
  return globalThis.fetch(url, { ...options, dispatcher: options.dispatcher || dispatcher });
}

async function readBytes(response, maxBytes) {
  const chunks = []; let size = 0;
  // Drain before disk/network writes: Undici #5360 can crash on FIN while its parser is paused.
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(Error('HTTP_BODY_TOO_LARGE'), { code: 'HTTP_BODY_TOO_LARGE' });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}
module.exports = { fetch: proxyFetch, readBytes };
