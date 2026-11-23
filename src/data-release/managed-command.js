'use strict';

let privateInput;

// A managed command shares stdin for one private JSON line and parent lifetime.
// Keeping the writer in Swift makes EOF reliable even after a forced app exit.
if (process.env.APOLLO_DATA_MANAGED === '1') {
  const timeout = Number(process.env.APOLLO_DATA_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 900000) throw Error('DATA_COMMAND_DEADLINE_INVALID');
  const stop = () => process.exit(1);
  process.stdin.once('end', stop);
  process.stdin.once('error', stop);
  privateInput = readPrivateInput();
  // Lifetime observation must not keep a completed command alive by itself.
  const unref = () => process.stdin.unref?.();
  privateInput.then(unref, unref);
  const timer = setTimeout(() => {
    setTimeout(stop, 100);
    process.stdout.write(JSON.stringify({ success: false, code: 'DATA_RELEASE_TIMEOUT', error: 'DATA_RELEASE_TIMEOUT' }) + '\n', stop);
  }, timeout);
  timer.unref();
}

function readPrivateInput(input = process.stdin) {
  if (input === process.stdin && privateInput) return privateInput;
  return new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0);
    const cleanup = () => { input.removeListener('data', data); input.removeListener('error', failed); input.removeListener('end', ended); };
    const failed = () => { cleanup(); reject(Error('DATA_ACTIVATION_INPUT_INVALID')); };
    const ended = () => failed();
    const data = chunk => {
      if (bytes.length + chunk.length > 4097) { failed(); return; }
      bytes = Buffer.concat([bytes, chunk]);
      const end = bytes.indexOf(10);
      if (end < 0) { if (bytes.length > 4096) failed(); return; }
      cleanup();
      if (end > 4096 || end !== bytes.length - 1) { reject(Error('DATA_ACTIVATION_INPUT_INVALID')); return; }
      try { resolve(JSON.parse(bytes.subarray(0, end).toString('utf8') || '{}')); }
      catch { reject(Error('DATA_ACTIVATION_INPUT_INVALID')); }
    };
    input.on('data', data); input.once('error', failed); input.once('end', ended);
  });
}

module.exports = { readPrivateInput };
