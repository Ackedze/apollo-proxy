'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const { fetch, readBytes } = require('../src/http-fetch');

function releaseURL(value, repository) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.hash ||
      !url.pathname.startsWith(repository + '/releases/')) throw Error('APP_UPDATE_ORIGIN_INVALID');
  return url;
}

async function startTransport({ feedURL, request = fetch }) {
  const feed = new URL(feedURL);
  const parts = feed.pathname.split('/');
  const repository = '/' + parts[1] + '/' + parts[2];
  releaseURL(feedURL, repository);
  if (!/^\/[\w.-]+\/[\w.-]+\/releases\/(latest\/download|download\/[^/]+)\/appcast\.xml$/.test(feed.pathname) || feed.search) throw Error('APP_UPDATE_FEED_INVALID');
  const nonce = crypto.randomBytes(24).toString('hex');
  const pending = new Set();
  const server = http.createServer(async (req, res) => {
    const local = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET' || !['/' + nonce + '/feed', '/' + nonce + '/archive'].includes(local.pathname)) { res.writeHead(404).end(); return; }
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 180000);
    pending.add(abort);
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    try {
      const isFeed = local.pathname.endsWith('/feed');
      let url = isFeed ? new URL(feed) : releaseURL(local.searchParams.get('url'), repository);
      const filename = isFeed ? null : url.pathname.split('/').pop();
      if (!isFeed && !/^[A-Za-z0-9._+-]+\.zip$/.test(filename)) throw Error('APP_UPDATE_ARCHIVE_NAME_INVALID');
      let response;
      for (let redirects = 0; redirects <= 6; redirects++) {
        response = await request(url, { redirect: 'manual', signal: abort.signal, headers: { 'User-Agent': 'ApolloProxyControl', 'Cache-Control': 'no-cache' } });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const next = new URL(response.headers.get('location'), url);
        await response.body?.cancel();
        if (redirects === 6 || next.protocol !== 'https:' || next.username || next.password || next.port ||
            !(next.hostname === 'github.com' && next.pathname.startsWith(repository + '/releases/') ||
              ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(next.hostname))) throw Error('APP_UPDATE_REDIRECT_INVALID');
        url = next;
      }
      if (!response.ok || !response.body) { await response.body?.cancel(); res.writeHead(response.status).end(); return; }
      const body = await readBytes(response, local.pathname.endsWith('/feed') ? 4 * 1024 * 1024 : 512 * 1024 * 1024);
      const headers = { 'Content-Type': isFeed ? 'application/xml' : 'application/zip', 'Content-Length': body.length, 'Cache-Control': 'no-store' };
      // Sparkle chooses its unarchiver from the downloaded filename, not the appcast URL.
      if (filename) headers['Content-Disposition'] = 'attachment; filename="' + filename + '"';
      res.writeHead(200, headers);
      res.end(body);
    } catch (error) {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' }).end(error.cause?.code || 'APP_UPDATE_TRANSPORT_FAILED');
      else res.destroy();
    } finally { clearTimeout(timeout); pending.delete(abort); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { baseURL: 'http://127.0.0.1:' + server.address().port + '/' + nonce,
    close() { for (const abort of pending) abort.abort(); server.closeAllConnections(); server.close(); } };
}

if (require.main === module) {
  startTransport({ feedURL: process.argv[2] }).then(transport => {
    process.stdout.write(JSON.stringify({ baseURL: transport.baseURL }) + '\n');
    const stop = () => { transport.close(); process.exit(0); };
    process.stdin.resume(); process.stdin.once('end', stop); process.once('SIGTERM', stop);
  }).catch(() => { console.error('APP_UPDATE_TRANSPORT_START_FAILED'); process.exitCode = 1; });
}
module.exports = { startTransport, releaseURL };
