const http = require('node:http');
const { bindManagedProxyLifetime } = require('../../../src/proxy-lifecycle');

const server = http.createServer((request, response) => {
  if (request.url === '/stall') {
    response.writeHead(200);
    response.write('waiting');
    return;
  }
  response.end('ok');
});
server.listen(0, '127.0.0.1', () => {
  console.log(JSON.stringify({ pid: process.pid, port: server.address().port }));
});
if (process.env.TEST_IGNORE_SHUTDOWN === '1') {
  process.on('SIGTERM', () => {});
} else if (process.env.APOLLO_PROXY_MANAGED === '1') {
  bindManagedProxyLifetime(server);
}
