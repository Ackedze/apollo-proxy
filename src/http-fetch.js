'use strict';
const { EnvHttpProxyAgent } = require('undici');
let dispatcher;

function proxyFetch(url, options = {}) {
  const configured = ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY'].some(key => process.env[key]);
  if (!configured) return globalThis.fetch(url, options);
  dispatcher ??= new EnvHttpProxyAgent();
  return globalThis.fetch(url, { ...options, dispatcher: options.dispatcher || dispatcher });
}

module.exports = { fetch: proxyFetch };
