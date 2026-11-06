'use strict';
const fs = require('node:fs/promises'), sync = require('node:fs'), path = require('node:path');
const crypto = require('node:crypto'), { spawn } = require('node:child_process');
const fail = (code, detail) => { throw Object.assign(Error(code), { code, detail }); };
const check = (value, code, detail) => { if (!value) fail(code, detail); };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const overlaps = (a, b) => a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
async function json(file, value) {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const next = file + '.next-' + crypto.randomUUID();
    await fs.writeFile(next, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await fs.rename(next, file);
}
async function pin(file) {
    check((await fs.lstat(file)).isFile() && await fs.realpath(file) === file, 'RELEASE_PIN_PATH_UNSAFE');
    const bytes = await fs.readFile(file); return { path: file, bytes: bytes.length, sha256: sha(bytes) };
}
async function tree(root) {
    const stat = await fs.lstat(root);
    // Package-manager executable links are not shipped or executed by the builder.
    if (stat.isSymbolicLink()) return [];
    if (stat.isFile()) return [await pin(root)];
    check(stat.isDirectory(), 'RELEASE_INPUT_PATH_UNSAFE');
    const rows = [];
    for (const name of (await fs.readdir(root)).sort()) rows.push(...await tree(path.join(root, name)));
    return rows;
}
async function verifyPins(rows) {
    for (const row of rows) {
        const actual = await pin(row.path).catch(() => fail('RELEASE_PIN_CHANGED', row.path));
        check(actual.bytes === row.bytes && actual.sha256 === row.sha256, 'RELEASE_PIN_CHANGED', row.path);
    }
}

async function command(bin, args, { env = process.env, cwd, signal, timeout = 90000, log, allowFailure = false } = {}) {
    check(!signal?.aborted, 'RELEASE_CANCELLED');
    const fd = log ? sync.openSync(log, 'a', 0o600) : null;
    const child = spawn(bin, args, { env, cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', failure, finished = false;
    const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    const stop = code => { failure ||= code; try { process.kill(-child.pid, 'SIGTERM'); } catch {} };
    const abort = () => stop('RELEASE_CANCELLED'); signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop('RELEASE_COMMAND_TIMEOUT'), timeout);
    const kill = setInterval(() => { if (failure && !finished) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } }, 2000);
    for (const [stream, field] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) stream.on('data', chunk => {
        if (fd !== null) sync.writeSync(fd, chunk);
        if (field === 'stdout') stdout += chunk; else stderr += chunk;
        if (stdout.length + stderr.length > 16 * 1024 * 1024) stop('RELEASE_COMMAND_OUTPUT_LIMIT');
    });
    try {
        const code = await done;
        finished = true;
        if (failure) fail(failure);
        if (code !== 0 && !allowFailure) fail('RELEASE_COMMAND_FAILED', path.basename(bin));
        return { code, stdout, stderr };
    } finally { finished = true; clearTimeout(timer); clearInterval(kill); signal?.removeEventListener('abort', abort); if (fd !== null) sync.closeSync(fd); }
}

const plistProgram = 'import plistlib,json,sys;print(json.dumps(plistlib.load(open(sys.argv[1]+"/Contents/Info.plist","rb"))))';
async function plist(app, run) { return JSON.parse((await run('python3', ['-c', plistProgram, app])).stdout); }
function signature(publicKey, bytes, encoded) {
    const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'base64')]), format: 'der', type: 'spki' });
    check(crypto.verify(null, bytes, key, Buffer.from(encoded, 'base64')), 'RELEASE_SIGNATURE_INVALID');
}
async function environmentProbe({ c, l, run, password, old }) {
    const probe = path.join(c.outputRoot, 'signing-probe'); await fs.writeFile(probe, 'Apollo release preflight\n', { mode: 0o600 });
    const tool = path.join(c.sparkleTools, 'sign_update'); await fs.access(tool, sync.constants.X_OK);
    const account = c.sparkleAccount || 'apollo-proxy';
    const sig = (await run(tool, ['--account', account, '-p', probe])).stdout.trim();
    signature(old.SUPublicEDKey, await fs.readFile(probe), sig);
    const executable = path.join(c.outputRoot, 'codesign-probe'); await fs.copyFile('/usr/bin/true', executable);
    await run('codesign', ['--force', '--sign', c.signingIdentity, '--timestamp=none', executable]);
    await run('codesign', ['--verify', '--strict', executable]);
    await run('swift', ['-e', 'import Foundation; print("Apollo release environment ready")'], { timeout: 90000 });
    const secure = require(path.join(l.source, 'src/data-packages/protected'));
    const key = secure.accessKey(await read(path.join(c.outputRoot, 'activation.json')), { password: await password() }); key.fill(0);
    await run('gh', ['auth', 'status']);
    await fs.rm(probe); await fs.rm(executable);
}

async function appVerification({ c, l, run }) {
    const current = await plist(l.app, run), previous = await plist(c.previousApp, run);
    check(current.CFBundleShortVersionString === c.version && current.CFBundleVersion === c.buildNumber && BigInt(current.CFBundleVersion) > BigInt(previous.CFBundleVersion), 'RELEASE_APP_VERSION_INVALID');
    check(current.SUPublicEDKey === previous.SUPublicEDKey && current.SUPublicEDKey === c.sparklePublicKey && current.SUFeedURL === previous.SUFeedURL, 'RELEASE_SIGNING_CHANGED');
    check(current.ApolloDataActivationRequired === true && current.ApolloDataDescriptorURL === l.descriptor, 'RELEASE_APP_CHANNEL_INVALID');
    await run('codesign', ['--verify', '--deep', '--strict', l.app]);
    const designated = async app => { const r = await run('codesign', ['-d', '-r-', app]); return (r.stdout + r.stderr).split('\n').find(x => x.startsWith('designated =>')); };
    const requirement = await designated(l.app);
    check(requirement && requirement === await designated(c.previousApp) && requirement.toLowerCase().includes(c.signingIdentity.toLowerCase()), 'RELEASE_SIGNING_CHANGED');
    const arches = (await run('lipo', ['-archs', path.join(l.app, 'Contents/MacOS/ApolloProxyControl')])).stdout.trim().split(/\s+/);
    check(arches.includes('arm64') && arches.includes('x86_64'), 'RELEASE_ARCHITECTURE_INVALID');
    const release = await read(path.join(l.signed, 'release.json')), bytes = await fs.readFile(path.join(l.signed, release.archive));
    check(release.version === c.version && release.build === c.buildNumber && release.bytes === bytes.length && release.sha256 === sha(bytes) && release.feedURL === current.SUFeedURL && release.publicKey === current.SUPublicEDKey, 'RELEASE_ARCHIVE_INVALID');
    const xml = await fs.readFile(path.join(l.signed, 'appcast.xml'), 'utf8');
    const appcast = JSON.parse((await run('python3', ['-c', 'import xml.etree.ElementTree as E,json,sys;print(json.dumps(E.parse(sys.argv[1]).find(".//enclosure").attrib))', path.join(l.signed, 'appcast.xml')])).stdout);
    check(appcast.url === l.appBase + '/' + release.archive && Number(appcast.length) === bytes.length, 'RELEASE_APPCAST_INVALID');
    signature(current.SUPublicEDKey, bytes, appcast['{http://www.andymatuschak.org/xml-namespaces/sparkle}edSignature']);
    const entries = JSON.parse((await run('python3', ['-c', 'import zipfile,json,sys;print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))', path.join(l.signed, release.archive)])).stdout);
    const seeds = entries.filter(n => n.includes('/runtime/seed/') && !n.endsWith('/'));
    check(seeds.length === 1 && seeds[0].endsWith('/.activation-required'), 'RELEASE_EMBEDDED_DATA_FORBIDDEN');
    check(!entries.some(n => /(^|\/)(\.env(?!\.example$)(\.|$)|arui-private)(\/|$)/.test(n) || n.includes('/codex-workspace/debug-runs/')), 'RELEASE_PRIVATE_FILES_FORBIDDEN');
    return { release, xml, requirement, architectures: arches };
}

function selectProbe(manifest, descriptor) {
    check(descriptor?.generation?.workflow === 'direct-cli-mcp-v1', 'RELEASE_GENERATION_INVALID');
    const file = manifest.files.find(x => x.file === `skills/${descriptor.id}/manifest.json`);
    check(file, 'RELEASE_PROBE_FILE_MISSING'); return file;
}

async function testWorkspace({ c, l }) {
    const root = path.join(c.outputRoot, 'packaged-test-workspace');
    const proxy = path.join(root, 'services/apollo-proxy');
    const tests = ['landing-direct.test.js', 'landing-direct-cli.test.js', 'landing-knowledge-mcp.test.js'];
    const files = tests.map(n => [path.join(c.proxyRoot, 'test', n), path.join(proxy, 'test', n)]);
    files.push([path.join(c.apolloRoot, 'tests/landing-retry-facts.test.js'), path.join(root, 'projects/Apollo/tests/landing-retry-facts.test.js')]);
    for (const [from, to] of files) {
        await fs.mkdir(path.dirname(to), { recursive: true });
        if (sync.existsSync(to)) check((await fs.readFile(from)).equals(await fs.readFile(to)), 'RELEASE_TEST_COPY_CHANGED');
        else await fs.copyFile(from, to, sync.constants.COPYFILE_EXCL);
    }
    const source = path.join(l.app, 'Contents/Resources/embedded-proxy/src');
    const link = path.join(proxy, 'src');
    try { await fs.symlink(source, link, 'dir'); }
    catch (e) { if (e.code !== 'EEXIST') throw e; check(await fs.realpath(link) === await fs.realpath(source), 'RELEASE_TEST_COPY_CHANGED'); }
    const skills = path.join(root, 'shared/design-system_ab/apollo/skills');
    await fs.mkdir(skills, { recursive: true });
    for (const row of await tree(c.skillsRoot)) {
        const to = path.join(skills, path.relative(c.skillsRoot, row.path));
        await fs.mkdir(path.dirname(to), { recursive: true });
        if (!sync.existsSync(to)) await fs.copyFile(row.path, to, sync.constants.COPYFILE_EXCL);
        const actual = await pin(to); check(actual.sha256 === row.sha256, 'RELEASE_TEST_COPY_CHANGED');
    }
    return files.map(([, to]) => to);
}

async function consumers({ c, l }, releaseRoot, runtimeRoot) {
    const p = path.join(l.app, 'Contents/Resources/embedded-proxy');
    const catalog = require(path.join(p, 'src/skills/catalog')), api = require(path.join(p, 'src/data-release'));
    const manifest = await api.validateRelease(releaseRoot, { runtimeRoot });
    const entries = [...catalog.generationPackages(releaseRoot, manifest), ...catalog.auditPackages(releaseRoot, manifest)];
    let projected = 0;
    for (const entry of entries) {
        const d = entry.descriptor;
        check(c.expected.skills[d.id] === d.version, 'RELEASE_SKILL_VERSION_INVALID');
        for (const name of ['manifest.json', ...d.files.map(x => x.path)]) {
            const bytes = await fs.readFile(path.join(releaseRoot, 'skills', d.id, name));
            check(bytes.equals(await fs.readFile(path.join(c.skillsRoot, d.id, name))) && bytes.equals(await fs.readFile(path.join(releaseRoot, 'knowledge/data/design-system_ab/apollo/skills', d.id, name))), 'RELEASE_SKILL_SHADOW_MISMATCH'); projected++;
        }
    }
    const naming = require(path.join(p, 'src/skills/run-skill')).loadRunSkill(runtimeRoot, { releaseRoot }); naming.assertCurrent();
    check(naming.version === c.expected.skills['figma-layer-name-hygiene'], 'RELEASE_SKILL_VERSION_INVALID');
    const source = require(path.join(p, 'src/landing/knowledge')).openKnowledge({ releaseRoot, runtimeRoot }); source.assertCurrent();
    check(source.skill.version === c.expected.skills[source.skill.id] && source.skill.generation.workflow === c.expected.workflow, 'RELEASE_GENERATION_INVALID');
    const audit = require(path.join(p, 'src/figma-audit/knowledge')).openAuditKnowledge({ releaseRoot, runtimeRoot }); audit.assertCurrent();
    const handler = require(path.join(p, 'src/landing/knowledge-mcp')).createKnowledgeHandler(source, source.resumePin);
    const call = id => handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_source', arguments: { id } } });
    const result = call('knowledge/data/ds-ai-hub/AGENTS.md');
    check(!result.result.isError && JSON.parse(result.result.content[0].text).sourcePin === source.resumePin, 'RELEASE_SOURCE_READER_FAILED');
    for (const id of ['../../secret', '/Users/author/file', 'knowledge/data/design-system_ab/contract.manual.json']) check(call(id).result.isError, 'RELEASE_SOURCE_BOUNDARY_FAILED');
    for (const entry of entries) {
        const initial = entry.descriptor.id === source.skill.id ? source.initial.norms : audit.initial;
        const profile = entry.descriptor.generation || entry.descriptor.audit;
        for (const id of profile.requiredResources) check(initial.some(f => f.id === id), 'RELEASE_RESOURCE_MISSING');
    }
    const auditData = await require(path.join(p, 'src/audit-data/reader')).createAuditDataReader({ knowledgeRoot: path.join(releaseRoot, 'knowledge') }).manifest();
    check(auditData.dataId === c.expected.auditDataId, 'RELEASE_AUDIT_DATA_CHANGED');
    const gen = entries.find(x => x.descriptor.id === source.skill.id).descriptor;
    check(!Object.hasOwn(gen.generation, 'recipeOperations') && !Object.hasOwn(gen.generation, 'skeletonExecutor'), 'RELEASE_LEGACY_FLOW_PRESENT');
    const routes = new Map(), app = { get: (url, fn) => routes.set('GET ' + url, fn), post: (url, fn) => routes.set('POST ' + url, fn) };
    const configured = require(path.join(p, 'src/landing/runtime')).mountConfiguredLandingRoutes(app, { releaseRoot, runtimeRoot,
        root: path.join(c.outputRoot, 'reader-chat-probe'), provider: 'codex', binary: '/no-cli-is-called' });
    configured.loadService();
    for (const name of ['canvas', 'native', 'observation', 'failure']) {
        let status, body;
        routes.get('POST /landing/chats/:id/' + name)({}, { status: value => { status = value; return { json: value => body = value }; } });
        check(status === 410 && body.code === 'LANDING_LEGACY_FLOW_RETIRED', 'RELEASE_LEGACY_ROUTE_ENABLED');
    }
    return { projectedDeclaredFiles: projected, dataId: manifest.id, probeFile: selectProbe(manifest, gen), generationVersion: gen.version, namingVersion: naming.version };
}

async function localVerification(o) {
    const { c, l, run, password } = o, p = path.join(l.app, 'Contents/Resources/embedded-proxy');
    const app = await appVerification(o), api = require(path.join(p, 'src/data-release')), secure = require(path.join(p, 'src/data-packages/protected'));
    const runtimeRoot = path.join(p, 'runtime/apollo'), index = await read(path.join(l.data, 'current.json'));
    check(api.readRuntime(runtimeRoot).id === api.readRuntime(c.runtimeRoot).id && index.runtimeId === api.readRuntime(runtimeRoot).id, 'RELEASE_RUNTIME_INVALID');
    check(JSON.stringify((await fs.readdir(path.join(p, 'runtime/seed'))).sort()) === '[".activation-required"]', 'RELEASE_EMBEDDED_DATA_FORBIDDEN');
    for (const row of await tree(path.join(l.source, 'src'))) {
        const emitted = await pin(path.join(p, path.relative(l.source, row.path)));
        check(emitted.sha256 === row.sha256 && emitted.bytes === row.bytes, 'RELEASE_SOURCE_DELIVERY_MISMATCH');
    }
    const old = await read(path.join(c.previousData, 'current.json'));
    check(JSON.stringify(index.activation) === JSON.stringify(old.activation), 'RELEASE_ACTIVATION_CHANGED');
    const store = path.join(c.outputRoot, 'bootstrap-store');
    const settings = { storeRoot: store, seedRoot: path.join(p, 'runtime/seed'), runtimeRoot };
    const installed = await bootstrap(settings, index, api, async () => secure.installProtected({ settings, ensured: { state: { current: null, previous: null } }, selected: { index, commit: null }, command: 'update', access: { password: await password() }, request: async url => {
        check(url === index.npm.tarballUrl, 'RELEASE_VERIFICATION_URL_INVALID');
        return new Response(await fs.readFile(path.join(l.data, path.basename(url))));
    }, releases: api }));
    const result = await consumers(o, installed.current.path, runtimeRoot);
    check(installed.current.contentVersion === index.npm.dataId, 'RELEASE_DATA_ID_INVALID');
    if (index.runtimeId !== old.runtimeId) {
        for (const [root, rt] of [[installed.current.path, c.baseRuntimeRoot], [c.baseRelease, runtimeRoot]]) {
            let code; try { api.readReleaseFiles(root, rt); } catch (e) { code = e.code; }
            check(code === 'DATA_RELEASE_RUNTIME_INCOMPATIBLE', 'RELEASE_MISMATCH_ACCEPTED');
        }
    }
    const tests = await testWorkspace(o);
    const testLog = path.join(c.outputRoot, 'packaged-tests.log');
    const env = { ...process.env, TMPDIR: sync.realpathSync(require('node:os').tmpdir()) };
    const tested = await run(c.nodeSource, ['--test', ...tests], { env, timeout: 120000, log: testLog });
    check(/# fail 0\b/.test(tested.stdout) && /# skipped 0\b/.test(tested.stdout) && Number(/# pass (\d+)/.exec(tested.stdout)?.[1]) >= 27, 'RELEASE_PACKAGED_TESTS_FAILED');
    const value = { ...result, appVersion: app.release.version, runtimeId: index.runtimeId, fullEncryptedBootstrap: true, packagedTests: Number(/# pass (\d+)/.exec(tested.stdout)[1]), releaseRoot: installed.current.path };
    const file = path.join(c.outputRoot, 'local-verification.json'); await json(file, value);
    return { value, outputs: [file, testLog, path.join(store, 'bootstrap-receipt.json'), ...tests], tree: [path.join(c.outputRoot, 'packaged-test-workspace/shared')] };
}

async function bootstrap(settings, index, api, install) {
    await fs.mkdir(settings.storeRoot, { recursive: true });
    const receipt = path.join(settings.storeRoot, 'bootstrap-receipt.json');
    const state = await api.readState(settings.storeRoot), saved = await read(receipt).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    if (state) {
        check(saved?.dataId === index.npm.dataId && saved.runtimeId === index.runtimeId && state.current?.contentVersion === saved.dataId, 'RELEASE_BOOTSTRAP_REQUIRES_RECONCILIATION');
        await api.validateRelease(state.current.path, { runtimeRoot: settings.runtimeRoot });
        return state;
    }
    check(!saved, 'RELEASE_BOOTSTRAP_REQUIRES_RECONCILIATION');
    const result = await install();
    check(result.current?.contentVersion === index.npm.dataId, 'RELEASE_DATA_ID_INVALID');
    await json(receipt, { dataId: index.npm.dataId, runtimeId: index.runtimeId, fullEncryptedBootstrap: true });
    return result;
}

function observe(request, rows) {
    return async (url, options = {}) => {
        check(!new Headers(options.headers).has('authorization'), 'RELEASE_ANONYMOUS_AUTH_FORBIDDEN');
        const parsed = new URL(url), row = { url: parsed.origin + parsed.pathname, range: options.headers?.Range || null };
        check(parsed.protocol === 'https:' && !parsed.username && !parsed.password, 'RELEASE_ANONYMOUS_AUTH_FORBIDDEN');
        rows.push(row); const response = await request(url, options);
        Object.assign(row, { status: response.status, contentRange: response.headers.get('content-range') }); return response;
    };
}
function wireAccounting(rows, target, indexBytes) {
    const pins = Object.values(target.objects), terminal = rows.filter(r => r.status === 206);
    let cipherBytes = 0;
    for (const row of terminal) {
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(row.contentRange || '');
        check(match && row.range === `bytes=${match[1]}-${match[2]}`, 'RELEASE_RANGE_INVALID');
        const size = Number(match[2]) - Number(match[1]) + 1;
        check(pins.some(p => p.offset === Number(match[1]) && p.bytes === size), 'RELEASE_RANGE_INVALID'); cipherBytes += size;
    }
    return { objectResponses: terminal.length, cipherBytes, indexBytes, payloadBytes: cipherBytes + indexBytes, redirects: rows.filter(r => r.status === 302 || r.status === 301 || r.status === 307 || r.status === 308).length };
}
function transport(o) {
    const p = path.join(o.l.app, 'Contents/Resources/embedded-proxy'), http = require(path.join(p, 'src/http-fetch')), rows = [];
    return { p, http, rows, request: observe((url, options) => http.fetch(url, { ...options, redirect: options.redirect || 'manual',
        signal: AbortSignal.any([options.signal, o.signal, AbortSignal.timeout(55000)].filter(Boolean)) }), rows) };
}
async function anonymousBytes(t, url, limit) {
    check((t.redirects || 0) <= 5, 'RELEASE_REDIRECT_INVALID');
    const response = await t.request(url); // Production http-fetch deliberately exposes redirects to its caller.
    if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = new URL(response.headers.get('location'), url);
        check(next.protocol === 'https:' && ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'raw.githubusercontent.com'].includes(next.hostname), 'RELEASE_REDIRECT_INVALID');
        return anonymousBytes({ ...t, redirects: (t.redirects || 0) + 1 }, next.href, limit);
    }
    check((t.redirects || 0) <= 5 && response.status === 200, 'RELEASE_DOWNLOAD_FAILED');
    return t.http.readBytes(response, limit);
}
async function publicData(o) {
    const { c, l, password } = o, t = transport(o), index = await read(path.join(l.data, 'current.json'));
    const api = require(path.join(t.p, 'src/data-release')), secure = require(path.join(t.p, 'src/data-packages/protected')), inc = require(path.join(t.p, 'src/data-packages/incremental'));
    const reference = require(path.join(t.p, 'src/data-packages/npm'));
    const dir = path.join(c.outputRoot, 'public'); await fs.mkdir(dir, { recursive: true });
    const archive = path.join(dir, crypto.randomUUID() + '.tgz');
    await reference.download(index.npm, archive, t.request);
    check((await pin(archive)).sha256 === (await pin(path.join(l.data, path.basename(index.npm.tarballUrl)))).sha256, 'RELEASE_PUBLIC_ARCHIVE_MISMATCH');
    const descriptor = await anonymousBytes(t, l.dataBase + '/current.json', 1024 * 1024);
    check(descriptor.equals(await fs.readFile(path.join(l.data, 'current.json'))), 'RELEASE_PUBLIC_DESCRIPTOR_MISMATCH');
    const sums = await anonymousBytes(t, l.dataBase + '/DATA-SHA256SUMS', 1024 * 1024);
    check(sums.equals(await fs.readFile(path.join(c.outputRoot, 'DATA-SHA256SUMS'))), 'RELEASE_PUBLIC_CHECKSUMS_MISMATCH');
    const encrypted = await anonymousBytes(t, index.incremental.manifest.url, index.incremental.manifest.bytes);
    const key = secure.accessKey(index.activation, { password: await password() });
    try {
        const target = inc.readIndex(encrypted, key, index.incremental, index.activation.keyId, index.npm.dataId);
        const local = await read(path.join(c.outputRoot, 'local-verification.json'));
        const file = target.manifest.files.find(p => p.file === local.probeFile.file); check(file, 'RELEASE_PROBE_FILE_MISSING');
        const object = target.objects[file.sha256], range = `bytes=${object.offset}-${object.offset + object.bytes - 1}`;
        let response = await t.request(index.incremental.objectsPack.url, { headers: { Range: range } }), hops = 0;
        while ([301, 302, 303, 307, 308].includes(response.status)) {
            check(++hops <= 5, 'RELEASE_REDIRECT_INVALID');
            const next = new URL(response.headers.get('location')); check(next.protocol === 'https:' && next.hostname === 'release-assets.githubusercontent.com', 'RELEASE_REDIRECT_INVALID');
            response = await t.request(next.href, { headers: { Range: range } });
        }
        check(response.status === 206 && response.headers.get('content-range') === range.replace('=', ' ') + '/' + index.incremental.objectsPack.bytes, 'RELEASE_RANGE_INVALID');
        const plain = inc.open(await t.http.readBytes(response, object.bytes), key, object, inc.objectAad(index.activation.keyId, file.sha256), file.bytes);
        check(plain.equals(await fs.readFile(path.join(c.skillsRoot, path.relative('skills', file.file)))), 'RELEASE_PUBLIC_PROBE_MISMATCH');
        const value = { version: c.dataVersion, runtimeId: index.runtimeId, dataId: index.npm.dataId, anonymous: true, probe: file.file, probeSha256: api.sha(plain), requests: t.rows };
        const out = path.join(c.outputRoot, 'public-data.json'); await json(out, value); return { value, outputs: [archive, out] };
    } finally { key.fill(0); }
}

async function migration(o) {
    const { c, l, password } = o, t = transport(o), api = require(path.join(t.p, 'src/data-release'));
    const cli = require(path.join(t.p, 'scripts/data-release-cli')), secure = require(path.join(t.p, 'src/data-packages/protected')), inc = require(path.join(t.p, 'src/data-packages/incremental'));
    const index = await read(path.join(l.data, 'current.json')), old = await read(path.join(c.previousData, 'current.json'));
    const storeRoot = path.join(c.outputRoot, 'migration-store'), runtimeRoot = path.join(t.p, 'runtime/apollo'), seedRoot = path.join(t.p, 'runtime/seed');
    let state = await api.readState(storeRoot);
    if (!state) state = (await api.ensureStore({ storeRoot, seedRoot: c.baseRelease, runtimeRoot: c.baseRuntimeRoot })).state;
    const forwardFile = path.join(c.outputRoot, 'migration-forward.json'), intentFile = path.join(c.outputRoot, 'migration-intent.json');
    const saved = await read(forwardFile).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    if (saved) {
        check(saved.current === index.npm.dataId && saved.previous === old.npm.dataId &&
            state.current?.contentVersion === saved.current && state.previous?.contentVersion === saved.previous, 'RELEASE_MIGRATION_STATE_CHANGED');
        await consumers(o, state.current.path, runtimeRoot);
        const file = path.join(c.outputRoot, 'migration.json'); await json(file, { ...saved, ownerStoreTouched: false });
        return { value: { ...saved, ownerStoreTouched: false }, outputs: [file, forwardFile, intentFile] };
    }
    check(!sync.existsSync(intentFile), 'RELEASE_MIGRATION_OUTCOME_UNKNOWN');
    check(state.current?.contentVersion === old.npm.dataId && index.npm.dataId !== old.npm.dataId, 'RELEASE_MIGRATION_STATE_CHANGED');
    const key = secure.accessKey(index.activation, { password: await password() });
    const options = { store: storeRoot, seed: seedRoot, runtime: runtimeRoot, descriptor: l.descriptor, access: { keyId: index.activation.keyId, key: key.toString('hex') } };
    try {
        const before = await fs.readFile(path.join(storeRoot, 'state.json'));
        const status = await cli.runCommand('status', options, t.request), checked = await cli.runCommand('check', options, t.request);
        if (state.current.contentVersion === old.npm.dataId && index.runtimeId !== old.runtimeId) {
            check(status.current === null && status.runtimeMigrationRequired && checked.runtimeMigrationRequired, 'RELEASE_MIGRATION_GATE_FAILED');
        }
        check(before.equals(await fs.readFile(path.join(storeRoot, 'state.json'))), 'RELEASE_CHECK_MUTATED_STORE');
        await json(intentFile, { oldId: old.npm.dataId, newId: index.npm.dataId, startedAt: Date.now() });
        const startedAt = Date.now(), updated = await cli.runCommand('update', options, t.request), durationMs = Date.now() - startedAt;
        check(updated.current.contentVersion === index.npm.dataId && updated.previous.contentVersion === old.npm.dataId && !updated.activationKey, 'RELEASE_MIGRATION_FAILED');
        const encrypted = await fs.readFile(path.join(l.data, 'incremental.json.enc'));
        const target = inc.readIndex(encrypted, key, index.incremental, index.activation.keyId, index.npm.dataId);
        const wire = wireAccounting(t.rows, target, encrypted.length);
        const forward = { transfer: updated.transfer, wire, durationMs, current: updated.current.contentVersion, previous: updated.previous.contentVersion, requests: t.rows };
        // Persist the successful public transfer before any subsequent local assertion can fail.
        await json(forwardFile, forward);
        await consumers(o, updated.current.path, runtimeRoot);
        const value = { ...forward, ownerStoreTouched: false };
        const file = path.join(c.outputRoot, 'migration.json'); await json(file, value); return { value, outputs: [file, forwardFile, intentFile] };
    } finally { key.fill(0); }
}
async function recovery(o) {
    const { c, l } = o, p = path.join(l.app, 'Contents/Resources/embedded-proxy');
    const api = require(path.join(p, 'src/data-release')), cli = require(path.join(p, 'scripts/data-release-cli'));
    const index = await read(path.join(l.data, 'current.json')), old = await read(path.join(c.previousData, 'current.json'));
    const runtimeRoot = path.join(p, 'runtime/apollo'), seedRoot = path.join(p, 'runtime/seed'), storeRoot = path.join(c.outputRoot, 'migration-store');
    await verifyRollback({ api, cli, options: { store: storeRoot, seed: seedRoot, runtime: runtimeRoot }, storeRoot, seedRoot,
        oldRuntime: c.baseRuntimeRoot, newRuntime: runtimeRoot, oldId: old.npm.dataId, newId: index.npm.dataId, runtimeChanged: index.runtimeId !== old.runtimeId });
    const value = { rollbackVerified: true, runtimeChanged: index.runtimeId !== old.runtimeId, compatibleRecoveryVerified: true };
    const file = path.join(c.outputRoot, 'recovery.json'); await json(file, value); return { value, outputs: [file] };
}
async function verifyRollback({ api, cli, options, storeRoot, seedRoot, oldRuntime, newRuntime, oldId, newId, runtimeChanged }) {
    let rolled = await api.readState(storeRoot);
    if (rolled?.current?.contentVersion === newId && rolled.previous?.contentVersion === oldId)
        rolled = await api.rollbackStore({ storeRoot, seedRoot, runtimeRoot: oldRuntime });
    check(rolled?.current?.contentVersion === oldId && rolled.previous?.contentVersion === newId, 'RELEASE_ROLLBACK_STATE_CHANGED');
    check(rolled.current.contentVersion === oldId, 'RELEASE_ROLLBACK_FAILED'); await api.validateRelease(rolled.current.path, { runtimeRoot: oldRuntime });
    const oldStatus = await cli.runCommand('status', { ...options, runtime: oldRuntime, seed: rolled.current.path });
    check(oldStatus.current.contentVersion === oldId, 'RELEASE_ROLLBACK_FAILED');
    const recovered = await cli.runCommand('status', { ...options, runtime: newRuntime });
    check(recovered.current.contentVersion === (runtimeChanged ? newId : oldId) && (!runtimeChanged || recovered.recovered === true), 'RELEASE_RECOVERY_FAILED');
    await api.validateRelease(recovered.current.path, { runtimeRoot: newRuntime });
}
async function publicApp(o) {
    const { c, l } = o, t = transport(o), release = await read(path.join(l.signed, 'release.json'));
    const feed = await anonymousBytes(t, release.feedURL, 1024 * 1024);
    check(feed.equals(await fs.readFile(path.join(l.signed, 'appcast.xml'))), 'RELEASE_PUBLIC_APPCAST_MISMATCH');
    const archive = await anonymousBytes(t, l.appBase + '/' + release.archive, release.bytes);
    check(archive.length === release.bytes && sha(archive) === release.sha256, 'RELEASE_PUBLIC_ARCHIVE_MISMATCH');
    const signatureMatch = /sparkle:edSignature="([^"]+)"/.exec(feed.toString()); check(signatureMatch, 'RELEASE_APPCAST_INVALID');
    signature(c.sparklePublicKey, archive, signatureMatch[1]);
    const value = { version: c.version, bytes: archive.length, sha256: release.sha256, signatureVerified: true, anonymous: true, requests: t.rows };
    const file = path.join(c.outputRoot, 'public-app.json'); await json(file, value); return { value, outputs: [file] };
}

module.exports = { fail, check, sha, read, json, pin, tree, verifyPins, overlaps, command, plist, signature, environmentProbe,
    appVerification, consumers, selectProbe, testWorkspace, bootstrap, localVerification, observe, wireAccounting, anonymousBytes, publicData, migration, recovery, verifyRollback, publicApp };
