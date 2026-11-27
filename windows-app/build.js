'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Error(code); };
function safe(file) { return typeof file === 'string' && !/[\\:\x00-\x1f]/.test(file) && file.split('/').every(p => p && p !== '.' && p !== '..'); }
function readPin(pin) {
  const stat = fs.lstatSync(pin.path), bytes = fs.readFileSync(pin.path);
  if (!stat.isFile() || stat.isSymbolicLink() || bytes.length !== pin.bytes || hash(bytes) !== pin.sha256) fail('WINDOWS_BUILD_INPUT_CHANGED');
  return bytes;
}
function walk(root, prefix = '') {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const file = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink()) fail('WINDOWS_BUILD_LINK_FORBIDDEN');
    if (entry.isDirectory()) return walk(root, file);
    if (!entry.isFile()) fail('WINDOWS_BUILD_FILE_INVALID');
    return [file];
  });
}
function portability(file, body) {
  let before, after;
  if (file === 'proxy/src/knowledge-package/index.js') {
    before = "const TAR_EXECUTABLE = '/usr/bin/tar';";
    after = "const TAR_EXECUTABLE = require('../archive-tool').tarExecutable();";
  } else if (file === 'proxy/src/data-release/index.js') {
    before = "spawnSync('/usr/bin/tar',"; after = "spawnSync(require('../archive-tool').tarExecutable(),";
  } else if (file === 'proxy/scripts/git-data-cli.js') {
    before = "spawnSync('/usr/bin/tar',"; after = "spawnSync(require('../src/archive-tool').tarExecutable(),";
  } else if (file === 'proxy/src/skills/ux-writer/index.js') {
    before = "['-I', path.join(__dirname, 'checker.py')]"; after = "['-I', '-X', 'utf8', path.join(__dirname, 'checker.py')]";
  } else return body;
  const text = body.toString('utf8');
  if (text.split(before).length !== 2) fail('WINDOWS_PORTABILITY_PREIMAGE_CHANGED');
  return Buffer.from(text.replace(before, after));
}
function build(config) {
  if (process.platform !== 'darwin') fail('WINDOWS_BUILD_HOST_UNSUPPORTED');
  if (!/^[a-zA-Z0-9.-]+$/.test(config.version)) fail('WINDOWS_BUILD_CONFIG_INVALID');
  const output = path.resolve(config.output);
  if (fs.existsSync(output)) fail('WINDOWS_BUILD_OUTPUT_EXISTS');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const work = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'apollo-win-build-'));
  const root = path.join(work, 'ApolloProxy-Windows'); fs.mkdirSync(root);
  const overlays = [], sourcePins = [];
  try {
    const save = (file, bytes) => {
      if (!safe(file) || fs.existsSync(path.join(root, file))) fail('WINDOWS_BUILD_TARGET_CONFLICT');
      const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
    };
    for (const pin of config.inputs) {
      if (!safe(pin.file) || /(^|\/)(?:\.env(?:\.|$)|credentials\.dpapi|history|debug-runs|\.git)(\/|$)/.test(pin.file)) fail('WINDOWS_BUILD_PRIVATE_INPUT');
      const before = readPin(pin), after = portability(pin.file, before);
      save(pin.file, after); sourcePins.push(pin);
      if (!before.equals(after)) overlays.push({ file: pin.file, before: hash(before), after: hash(after) });
    }
    for (const file of ['controller.js', 'frozen-data.js', 'ApolloProxy.ps1', 'Start.cmd']) {
      let body = fs.readFileSync(path.join(__dirname, file));
      if (file.endsWith('.ps1')) body = Buffer.concat([Buffer.from([0xef,0xbb,0xbf]), body]); // Windows PowerShell 5.1 otherwise treats UTF-8 Russian copy as ANSI.
      save(file, body);
    }
    save('README.txt', fs.readFileSync(path.join(__dirname, 'README.md')));
    save('proxy/src/archive-tool.js', fs.readFileSync(path.join(__dirname, 'archive-tool.js')));
    save('proxy/scripts/data-release-cli.js', fs.readFileSync(path.join(root, 'proxy/scripts/git-data-cli.js')));
    save('proxy/runtime/seed/.activation-required', Buffer.alloc(0));
    const node = readPin(config.node);
    if (node.subarray(0,2).toString() !== 'MZ') fail('WINDOWS_NODE_BINARY_INVALID');
    save('runtime/node.exe', node);
    readPin(config.python);
    const extraction = spawnSync('/usr/bin/ditto', ['-x', '-k', config.python.path, path.join(root, 'runtime/python')], { encoding: 'utf8' });
    if (extraction.status !== 0 || !fs.existsSync(path.join(root, 'runtime/python/python.exe'))) fail('WINDOWS_PYTHON_UNPACK_FAILED');
    const files = walk(root).map(file => { const b = fs.readFileSync(path.join(root, file)); return { file, bytes: b.length, sha256: hash(b) }; });
    const manifest = { schemaVersion: 'apollo.windows-texts.v1', version: config.version, target: 'win32-x64',
      dataMode: 'bundled-protected', base: config.base, overlays, files };
    manifest.id = hash(JSON.stringify(manifest)); save('bundle.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
    // Refuse a source drift across copy, including the exact fixed preimages.
    for (const pin of sourcePins) readPin(pin);
    const archive = spawnSync('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--noextattr', '--keepParent', root, output], { encoding: 'utf8' });
    if (archive.status !== 0) fail('WINDOWS_ZIP_FAILED');
    return { version: config.version, id: manifest.id, files: files.length, overlays, archive: { path: output, bytes: fs.statSync(output).size, sha256: hash(fs.readFileSync(output)) },
      validation: { windowsExecuted: false, figma: false, modelCalls: 0 } };
  } catch (e) { fs.rmSync(output, { force: true }); throw e; }
  finally { fs.rmSync(work, { recursive: true, force: true }); }
}
if (require.main === module) {
  try { console.log(JSON.stringify(build(JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))), null, 2)); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { safe, readPin, portability, build };
