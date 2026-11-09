const fs = require('node:fs'), path = require('node:path');
const release = require('../../../src/data-release');
const managed = require('../../../src/data-release/managed-command');
const [command, ...args] = process.argv.slice(2), store = args[args.indexOf('--store') + 1];
(async () => {
  const input = await managed.readPrivateInput();
  if (input.fixture !== 'private-input') throw Error('FIXTURE_INPUT_MISSING');
  const result = await release.withLock(store, async () => {
    if (command === 'success') return { current: null, previous: null };
    fs.writeFileSync(path.join(path.dirname(store), 'held.json'), JSON.stringify({ pid: process.pid, lock: JSON.parse(fs.readFileSync(path.join(store, '.update.lock'))) }));
    await new Promise(() => setInterval(() => {}, 1000));
  });
  console.log(JSON.stringify(result));
})().catch(error => { console.log(JSON.stringify({ error: error.message })); process.exitCode = 1; });
