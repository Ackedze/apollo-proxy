'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), sync = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const runner = require('../scripts/release-pair'), v = require('../scripts/release-pair-verify');
const { createPublisher } = require('../scripts/release-pair-github');

async function fixture(t) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'release-pair-')));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const input = path.join(root, 'input'); await fs.writeFile(input, 'accepted');
    const c = { outputRoot: path.join(root, 'out'), version: '1.4.32', dataVersion: '1.4.32-data.20261106.1' };
    const calls = [], messages = []; let failed, stop;
    const createActions = async () => Object.fromEntries(runner.PHASES.map(name => [name, async () => {
        calls.push(name); if (name === failed) throw Object.assign(Error('secret-not-for-receipts'), { code: 'FIXTURE_FAILURE' });
        if (name === stop) stop.controller.abort();
        const file = path.join(c.outputRoot, name + '.txt'); await fs.writeFile(file, name);
        return { value: { runtimeId: 'a'.repeat(64) }, outputs: [file] };
    }]));
    let ticks = 1000;
    const options = { createActions, inputs: async () => [await v.pin(input)], now: () => ticks += 10, log: x => messages.push(x) };
    return { root, input, c, calls, messages, options, setFailure: name => failed = name,
        async state() { return v.read(path.join(c.outputRoot, 'state.json')); } };
}

test('default prepares without remote mutations; publish resumes exact completed stages and seals once', async t => {
    const f = await fixture(t); await runner.runRelease(f.c, f.options);
    assert.deepEqual(f.calls, ['preflight', 'prepare', 'verify']);
    const state = await runner.runRelease(f.c, { ...f.options, publish: true });
    assert.deepEqual(f.calls, runner.PHASES); assert.equal(state.writesClosed, true);
    const closed = await fs.readFile(path.join(f.c.outputRoot, 'state.json'));
    await runner.runRelease(f.c, { ...f.options, publish: true });
    assert.deepEqual(f.calls, runner.PHASES); assert((await fs.readFile(path.join(f.c.outputRoot, 'state.json'))).equals(closed));
    const seal = await v.read(path.join(f.c.outputRoot, 'FINAL-SEAL.json')); await v.verifyPins(seal.files);
});
test('preflight-only never enters prepare or publication', async t => {
    const f = await fixture(t); const state = await runner.runRelease(f.c, { ...f.options, preflightOnly: true });
    assert.deepEqual(f.calls, ['preflight']); assert.equal(state.status, 'PREFLIGHT_PASSED');
});
test('input/config/artifact drift refuses before any resumed job', async t => {
    for (const kind of ['input', 'config', 'artifact']) await t.test(kind, async t => {
        const f = await fixture(t); await runner.runRelease(f.c, f.options); f.calls.length = 0;
        if (kind === 'input') await fs.writeFile(f.input, 'changed');
        if (kind === 'config') f.c.version = '1.4.33';
        if (kind === 'artifact') await fs.writeFile(path.join(f.c.outputRoot, 'prepare.txt'), 'changed');
        await assert.rejects(runner.runRelease(f.c, { ...f.options, publish: true }), { code: kind === 'config' ? 'RELEASE_CONFIG_CHANGED' : 'RELEASE_PIN_CHANGED' });
        assert.deepEqual(f.calls, []);
    });
});
test('overlapping writer refuses without deleting or adopting its lock', async t => {
    const f = await fixture(t); await fs.mkdir(f.c.outputRoot); await fs.writeFile(path.join(f.c.outputRoot, '.release.lock'), 'foreign');
    await assert.rejects(runner.runRelease(f.c, f.options), { code: 'RELEASE_WRITER_ACTIVE' });
    assert.equal(await fs.readFile(path.join(f.c.outputRoot, '.release.lock'), 'utf8'), 'foreign'); assert.deepEqual(f.calls, []);
});
test('a new run never adopts a nonempty foreign output directory',async t=>{
    const f=await fixture(t);await fs.mkdir(f.c.outputRoot);const file=path.join(f.c.outputRoot,'foreign');await fs.writeFile(file,'preserve');
    await assert.rejects(runner.runRelease(f.c,f.options),{code:'RELEASE_OUTPUT_NOT_EMPTY'});
    assert.equal(await fs.readFile(file,'utf8'),'preserve');assert.deepEqual(f.calls,[]);
});
test('failed stage preserves successful timing, first failure and secret-free receipts; only failed step retries', async t => {
    const f = await fixture(t); f.setFailure('recovery');
    await assert.rejects(runner.runRelease(f.c, { ...f.options, publish: true }), { code: 'FIXTURE_FAILURE' });
    const first = await f.state(), forward = first.phases.migration;
    assert.equal(forward.status, 'completed'); assert(forward.durationMs > 0);
    const failure = path.join(f.c.outputRoot, 'failure-recovery-1.json'), original = await fs.readFile(failure);
    assert(!(await fs.readFile(path.join(f.c.outputRoot, 'state.json'), 'utf8')).includes('secret-not-for-receipts'));
    f.calls.length = 0; f.setFailure(null); await runner.runRelease(f.c, { ...f.options, publish: true });
    assert.deepEqual(f.calls, ['recovery', 'app', 'public-app', 'final']);
    assert.deepEqual((await f.state()).phases.migration, forward); assert((await fs.readFile(failure)).equals(original));
});
test('cancel retains a completed checkpoint and never calls later phases', async t => {
    const f = await fixture(t), controller = new AbortController();
    const base = f.options.createActions;
    const createActions = async (...args) => { const jobs = await base(...args); jobs.prepare = async () => { controller.abort(); v.fail('RELEASE_CANCELLED'); }; return jobs; };
    await assert.rejects(runner.runRelease(f.c, { ...f.options, createActions, signal: controller.signal }), { code: 'RELEASE_CANCELLED' });
    const state = await f.state(); assert.equal(state.phases.preflight.status, 'completed'); assert.equal(state.phases.prepare.status, 'cancelled'); assert.equal(state.phases.verify, undefined);
});
async function configFixture(t) {
    const f = await fixture(t), c = { schemaVersion: runner.SCHEMA, ...f.c, buildNumber:'20261106190000',
        appRepository:'fixture/app', dataRepository:'fixture/data', signingIdentity:'a'.repeat(40), sparklePublicKey:Buffer.alloc(32).toString('base64'),
        expected:{workflow:'direct-cli-mcp-v1',runtimeId:'b'.repeat(64),auditDataId:'c'.repeat(64),skills:{'ab-generate-custom-landing':'0.6.0','ab-audit-figma':'0.4.4','figma-layer-name-hygiene':'0.2.0'}},
        previousAppReleaseId:10,priorChannels:{'1.4.31':'d'.repeat(40)} };
    for(const k of ['proxyRoot','runtimeRoot','baseRuntimeRoot','baseRelease','knowledgeRoot','skillsRoot','previousApp','previousData','apolloRoot','sparkleTools']){
        c[k]=path.join(f.root,k);await fs.mkdir(c[k]);
    }
    c.nodeSource=path.join(f.root,'node');await fs.writeFile(c.nodeSource,'node');
    for(const n of ['src','scripts','node_modules','codex-workspace/.agents/skills/apollo-design-validator','macos-app/Sources','macos-app/scripts'])await fs.mkdir(path.join(c.proxyRoot,n),{recursive:true});
    for(const n of ['package-lock.json','server.js','macos-app/Package.swift','test/landing-direct.test.js','test/landing-direct-cli.test.js','test/landing-knowledge-mcp.test.js']){
        const p=path.join(c.proxyRoot,n);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,n);
    }
    await v.json(path.join(c.proxyRoot,'package.json'),{version:c.version});
    await fs.mkdir(path.join(c.apolloRoot,'tests'));await fs.writeFile(path.join(c.apolloRoot,'tests/landing-retry-facts.test.js'),'apollo test');
    await fs.writeFile(path.join(c.sparkleTools,'sign_update'),'sign tool');
    const file=path.join(f.root,'config.json');await v.json(file,c);return {...f,c,file};
}
test('complete configuration pins all four regression sources; missing leaf refuses before credentials/output', async t => {
    const f=await configFixture(t),c=await runner.configuration(f.file),pins=await runner.inventory(c);
    for(const n of ['landing-direct.test.js','landing-direct-cli.test.js','landing-knowledge-mcp.test.js','landing-retry-facts.test.js'])assert(pins.some(p=>p.path.endsWith('/'+n)));
    await fs.unlink(path.join(c.proxyRoot,'test/landing-direct-cli.test.js'));
    await assert.rejects(runner.configuration(f.file),{code:'RELEASE_INPUT_PATH_UNSAFE',detail:'test/landing-direct-cli.test.js'});
    assert.equal(sync.existsSync(c.outputRoot),false);
});
test('new files in an accepted input set invalidate resume', async t => {
    const f=await fixture(t),dir=path.join(f.root,'inputs');await fs.mkdir(dir);await fs.copyFile(f.input,path.join(dir,'one'));
    const options={...f.options,inputs:()=>v.tree(dir)};await runner.runRelease(f.c,options);f.calls.length=0;
    await fs.writeFile(path.join(dir,'two'),'new source');
    await assert.rejects(runner.runRelease(f.c,{...options,publish:true}),{code:'RELEASE_INPUT_SET_CHANGED'});assert.deepEqual(f.calls,[]);
});
test('real child failures and cancellation stop the process before later work', async t => {
    const f=await fixture(t);await assert.rejects(v.command(process.execPath,['-e','process.exit(7)']),{code:'RELEASE_COMMAND_FAILED'});
    await assert.rejects(v.command('/no-such-release-executable',[]),{code:'ENOENT'});
    const controller=new AbortController(),pidFile=path.join(f.root,'child.pid');
    const job=v.command(process.execPath,['-e','require("node:fs").writeFileSync(process.argv[1],String(process.pid));process.on("SIGTERM",()=>{});setInterval(()=>{},100);',pidFile],{signal:controller.signal,timeout:5000});
    while(!sync.existsSync(pidFile))await new Promise(resolve=>setTimeout(resolve,10));
    const pid=Number(await fs.readFile(pidFile,'utf8'));controller.abort();
    await assert.rejects(job,{code:'RELEASE_CANCELLED'});assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});
test('packaged test workspace preserves test bytes and child MCP resolves bundled sources',async t=>{
    const f=await configFixture(t),app=path.join(f.root,'App.app'),src=path.join(app,'Contents/Resources/embedded-proxy/src');await fs.mkdir(src,{recursive:true});
    await fs.writeFile(path.join(src,'probe.js'),'console.log("packaged-child");');
    const original=path.join(f.c.proxyRoot,'test/landing-knowledge-mcp.test.js');
    await fs.writeFile(original,'const {execFileSync}=require("node:child_process"),path=require("node:path");process.stdout.write(execFileSync(process.execPath,[path.resolve(__dirname,"../src/probe.js")]));');
    const files=await v.testWorkspace({c:f.c,l:{app}}),copied=files.find(p=>p.endsWith('/landing-knowledge-mcp.test.js'));
    assert((await fs.readFile(copied)).equals(await fs.readFile(original)));
    assert.equal((await v.command(process.execPath,[copied])).stdout.trim(),'packaged-child');
});
test('encrypted bootstrap creates its store, resumes after later verifier failure and refuses unknown state',async t=>{
    const f=await fixture(t),settings={storeRoot:path.join(f.root,'bootstrap'),runtimeRoot:'/runtime'},index={npm:{dataId:'accepted'},runtimeId:'runtime'};let state=null,installs=0;
    const api={async readState(){return state;},async validateRelease(p){assert.equal(p,'/accepted');}};
    const install=async()=>{assert(sync.existsSync(settings.storeRoot));installs++;state={current:{contentVersion:'accepted',path:'/accepted'}};return state;};
    await v.bootstrap(settings,index,api,install);await v.bootstrap(settings,index,api,install);assert.equal(installs,1);
    await fs.unlink(path.join(settings.storeRoot,'bootstrap-receipt.json'));
    await assert.rejects(v.bootstrap(settings,index,api,install),{code:'RELEASE_BOOTSTRAP_REQUIRES_RECONCILIATION'});assert.equal(installs,1);
});
test('selected Range probe uses actual generation metadata, not the differing audit manifest', () => {
    const gen = { id: 'ab-generate-custom-landing', generation: { workflow: 'direct-cli-mcp-v1' } };
    const audit = { file: 'skills/ab-audit-figma/manifest.json', sha256: 'a'.repeat(64) };
    const landing = { file: 'skills/ab-generate-custom-landing/manifest.json', sha256: 'b'.repeat(64) };
    assert.equal(v.selectProbe({ files: [audit, landing] }, gen), landing);
    assert.throws(() => v.selectProbe({ files: [audit] }, gen), { code: 'RELEASE_PROBE_FILE_MISSING' });
});
test('wire accounting accepts redirect→terminal206 and refuses an unmatched range', async () => {
    const rows = [], wrapped = v.observe(async url => url.includes('github.com') ? new Response('', { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/file' } }) : new Response('abc', { status: 206, headers: { 'content-range': 'bytes 10-12/100' } }), rows);
    await wrapped('https://github.com/file', { headers: { Range: 'bytes=10-12' } }); await wrapped('https://release-assets.githubusercontent.com/file?redacted=1', { headers: { Range: 'bytes=10-12' } });
    assert.deepEqual(v.wireAccounting(rows, { objects: { pin: { offset: 10, bytes: 3 } } }, 50), { objectResponses: 1, cipherBytes: 3, indexBytes: 50, payloadBytes: 53, redirects: 1 });
    assert(!JSON.stringify(rows).includes('redacted'));
    assert.throws(() => v.wireAccounting(rows, { objects: {} }, 50), { code: 'RELEASE_RANGE_INVALID' });
    await assert.rejects(wrapped('https://github.com/file', { headers: new Headers({ Authorization: 'secret' }) }), { code: 'RELEASE_ANONYMOUS_AUTH_FORBIDDEN' });
});
test('old-runtime rollback and compatible new-runtime recovery are independent assertions', async () => {
    const calls = [], api = { async readState() { return {current:{contentVersion:'new'},previous:{contentVersion:'old'}}; }, async rollbackStore(o) { calls.push(['rollback', o.runtimeRoot]); return { current: { contentVersion: 'old', path: '/old' }, previous:{contentVersion:'new'} }; }, async validateRelease(p, o) { calls.push(['validate', p, o.runtimeRoot]); } };
    const cli = { async runCommand(_, o) { calls.push(['status', o.runtime]); return { current: { contentVersion: o.runtime === '/old-runtime' ? 'old' : 'new', path: o.runtime === '/old-runtime' ? '/old' : '/new' }, recovered: o.runtime === '/new-runtime' }; } };
    const o = { api, cli, options: {}, storeRoot: '/fixture', seedRoot: '/seed', oldRuntime: '/old-runtime', newRuntime: '/new-runtime', oldId: 'old', newId: 'new', runtimeChanged: true };
    await v.verifyRollback(o); assert.deepEqual(calls.filter(x => x[0] === 'status'), [['status', '/old-runtime'], ['status', '/new-runtime']]);
    await assert.rejects(v.verifyRollback({ ...o, cli: { async runCommand() { return { current: { contentVersion: 'old', path: '/old' }, recovered: false }; } } }), { code: 'RELEASE_RECOVERY_FAILED' });
});
test('same-runtime recovery resumes an already rolled back store without toggling it again',async()=>{
    let rollback=0;const api={async readState(){return {current:{contentVersion:'old',path:'/old'},previous:{contentVersion:'new'}};},async rollbackStore(){rollback++;throw Error('must not toggle');},async validateRelease(){}};
    const cli={async runCommand(){return {current:{contentVersion:'old',path:'/old'},recovered:false};}};
    await v.verifyRollback({api,cli,options:{},storeRoot:'/store',seedRoot:'/seed',oldRuntime:'/runtime',newRuntime:'/runtime',oldId:'old',newId:'new',runtimeChanged:false});assert.equal(rollback,0);
    await assert.rejects(v.verifyRollback({api:{...api,async readState(){return {current:{contentVersion:'foreign'}};}},cli,options:{},oldId:'old',newId:'new'}),{code:'RELEASE_ROLLBACK_STATE_CHANGED'});
});
test('archive signature is verified independently of a successful signing command', () => {
    const pair = crypto.generateKeyPairSync('ed25519'), bytes = Buffer.from('synthetic archive');
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
    const sig = crypto.sign(null, bytes, pair.privateKey).toString('base64'); v.signature(publicKey, bytes, sig);
    assert.throws(() => v.signature(publicKey, Buffer.from('tampered'), sig), { code: 'RELEASE_SIGNATURE_INVALID' });
});

async function publisherFixture(t, mode = {}) {
    const f = await fixture(t), l = { signed: path.join(f.root, 'signed'), data: path.join(f.root, 'data'), channel: 'apollo/proxy-releases/1.4.32/data-packages/current.json' };
    await fs.mkdir(l.signed); await fs.mkdir(l.data);
    for (const n of ['current.json', `apollo-data-${f.c.dataVersion}.tgz`, 'incremental.json.enc', 'objects.bin']) await fs.writeFile(path.join(l.data, n), n);
    await v.json(path.join(l.signed, 'release.json'), { archive: 'app.zip' });
    await fs.writeFile(path.join(l.signed, 'app.zip'), 'archive'); await fs.writeFile(path.join(l.signed, 'appcast.xml'), 'appcast');
    Object.assign(f.c, { appRepository: 'fixture/app', dataRepository: 'fixture/data', previousAppReleaseId: 10, priorChannels: { '1.4.31': 'a'.repeat(40) } });
    await fs.mkdir(f.c.outputRoot);
    const state = { runId: 'fixture-run', configHash: 'fixture-hash', remote: {} }, changes = [], releases = [], marker = '<!-- apollo-pair:fixture-run:fixture-hash -->';
    let channel, latest = { id: 10 }, channelCommit;
    if (mode.foreign) releases.push({ id: 99, tag_name: 'apollo-data-' + f.c.dataVersion, body: 'unrelated', assets: [] });
    const api = async (endpoint, options = {}) => {
        const method = options.method || 'GET'; if (method !== 'GET') changes.push([method, endpoint]);
        if (endpoint.endsWith('/releases?per_page=100')) return releases;
        if (endpoint.endsWith('/releases/latest')) return latest;
        if (method === 'POST') {
            const made = { id: 11, ...options.body, html_url: 'https://github.com/fixture/release', assets: [] }; releases.push(made);
            if (mode.unknownCreate) throw Error('network outcome unknown'); return made;
        }
        if (/\/releases\/\d+$/.test(endpoint)) {
            const r = releases.find(r => r.id === Number(endpoint.split('/').at(-1)));
            if (method === 'PATCH') { Object.assign(r, { draft: false }); if (r.tag_name.startsWith('v')) latest = r; } return r;
        }
        if (endpoint.includes('/git/ref/tags/')) return null;
        if (endpoint.includes('/git/ref/heads/')) return { object: { sha: 'b'.repeat(40) } };
        if (endpoint.includes('/contents/apollo/proxy-releases/1.4.31/')) return { sha: 'a'.repeat(40) };
        if (endpoint.includes('/contents/' + l.channel)) {
            if (method === 'PUT') { channel = { content: options.body.content, sha: 'c'.repeat(40) }; channelCommit = { sha: 'd'.repeat(40) }; if (mode.unknownChannel) throw Error('lost PUT reply'); return { commit: channelCommit }; }
            return channel || (mode.foreignChannel ? { content: Buffer.from('current.json').toString('base64'), sha: 'c'.repeat(40) } : null);
        }
        if (endpoint.includes('/commits?')) return [{ sha: 'd'.repeat(40), commit: { message: marker } }];
        if (endpoint.includes('/commits/')) return { commit: { message: marker }, files: [{ filename: l.channel, status: 'added' }] };
        if (endpoint === 'repos/fixture/app' || endpoint === 'repos/fixture/data') return { permissions: { push: true } };
        throw Error('Unexpected fixture endpoint ' + endpoint);
    };
    let uploads = 0;
    const upload = async (_, tag, p) => {
        uploads++; if (mode.missingUpload) throw Error('lost upload outcome');
        const r = releases.find(x => x.tag_name === tag); r.assets.push({ name: path.basename(p.path), size: p.bytes, digest: 'sha256:' + p.sha256, state: 'uploaded' });
        if (mode.foreignLatest) latest = { id: 99 }; if (mode.unknownUpload) throw Error('lost upload response');
    };
    const publisher = createPublisher({ c: f.c, l, state, persist: async () => {}, api, upload });
    return { ...f, publisher, state, changes, releases, uploadCount: () => uploads };
}
test('unknown create/upload results reconcile read-only to the owned exact assets without duplicates', async t => {
    const f = await publisherFixture(t, { unknownCreate: true, unknownUpload: true });
    await f.publisher.release('data'); assert.equal(f.releases.length, 1); assert.equal(f.uploadCount(), 5);
    const count = f.changes.length; await f.publisher.release('data'); assert.equal(f.changes.length, count); assert.equal(f.uploadCount(), 5);
});
test('unresolved upload is not blindly repeated', async t => {
    const f = await publisherFixture(t, { missingUpload: true });
    await assert.rejects(f.publisher.release('data')); assert.equal(f.uploadCount(), 1);
    await assert.rejects(f.publisher.release('data'), { code: 'RELEASE_REMOTE_OUTCOME_UNKNOWN' }); assert.equal(f.uploadCount(), 1);
});
test('unrelated existing release/tag and foreign latest are never overwritten', async t => {
    const foreign = await publisherFixture(t, { foreign: true });
    await assert.rejects(foreign.publisher.release('data'), { code: 'RELEASE_REMOTE_COLLISION' }); assert.deepEqual(foreign.changes, []);
    const changed = await publisherFixture(t, { foreignLatest: true });
    await assert.rejects(changed.publisher.release('app'), { code: 'RELEASE_FOREIGN_LATEST_CHANGED' });
    assert(!changed.changes.some(x => x[0] === 'PATCH'));
});
test('unknown channel PUT is admitted only through exact content and owned one-file commit', async t => {
    const f = await publisherFixture(t, { unknownChannel: true });
    const first = await f.publisher.channel(); const mutations = f.changes.length;
    assert.equal(first.value.commit, 'd'.repeat(40)); await f.publisher.channel(); assert.equal(f.changes.length, mutations);
    const foreign = await publisherFixture(t, { foreignChannel: true });
    await assert.rejects(foreign.publisher.channel(), { code: 'RELEASE_REMOTE_CHANNEL_COLLISION' }); assert.deepEqual(foreign.changes, []);
});
