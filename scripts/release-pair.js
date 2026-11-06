#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const sync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const v = require('./release-pair-verify');
const { createPublisher } = require('./release-pair-github');

const SCHEMA = 'apollo.paired-release.v1';
const PHASES = ['preflight', 'prepare', 'verify', 'data', 'public-data', 'channel', 'migration', 'recovery', 'app', 'public-app', 'final'];
const SOURCE = ['package.json', 'package-lock.json', 'server.js', 'src', 'scripts', 'node_modules',
    'codex-workspace/.agents/skills/apollo-design-validator', 'macos-app/Package.swift',
    'macos-app/Package.resolved', 'macos-app/Sources', 'macos-app/scripts'];
const ROOTS = ['proxyRoot', 'runtimeRoot', 'baseRuntimeRoot', 'baseRelease', 'knowledgeRoot',
    'skillsRoot', 'previousApp', 'previousData', 'apolloRoot', 'sparkleTools', 'nodeSource'];
const TESTS = ['landing-direct.test.js', 'landing-direct-cli.test.js', 'landing-knowledge-mcp.test.js'];

async function configuration(file) {
    const raw = await v.read(file);
    v.check(raw.schemaVersion === SCHEMA, 'RELEASE_CONFIG_INVALID');
    const c = { ...raw };
    for (const k of [...ROOTS, 'outputRoot']) {
        v.check(typeof c[k] === 'string' && c[k], 'RELEASE_CONFIG_PATH_REQUIRED', k);
        c[k] = path.resolve(path.dirname(file), c[k]);
    }
    for (const k of ROOTS) v.check(await fs.realpath(c[k]).catch(() => null) === c[k], 'RELEASE_INPUT_PATH_UNSAFE', k);
    for (const file of [...SOURCE.filter(n => !n.endsWith('Package.resolved')), ...TESTS.map(n => 'test/' + n)]) {
        const p = path.join(c.proxyRoot, file);
        v.check(await fs.realpath(p).catch(() => null) === p, 'RELEASE_INPUT_PATH_UNSAFE', file);
    }
    for (const p of [path.join(c.apolloRoot, 'tests/landing-retry-facts.test.js'), path.join(c.sparkleTools, 'sign_update')])
        v.check(await fs.realpath(p).catch(() => null) === p, 'RELEASE_INPUT_PATH_UNSAFE', p);
    v.check(/^[0-9]+$/.test(c.buildNumber || ''), 'RELEASE_BUILD_INVALID');
    const pkg = await v.read(path.join(c.proxyRoot, 'package.json'));
    c.version = pkg.version;
    v.check(/^\d+\.\d+\.\d+$/.test(c.version) && c.dataVersion?.startsWith(c.version + '-data.') && /^[\w.-]+$/.test(c.dataVersion), 'RELEASE_VERSION_INVALID');
    for (const k of ['appRepository', 'dataRepository']) v.check(/^[\w.-]+\/[\w.-]+$/.test(c[k] || ''), 'RELEASE_REPOSITORY_INVALID');
    v.check(/^[a-f0-9]{40}$/i.test(c.signingIdentity || '') && Buffer.from(c.sparklePublicKey || '', 'base64').length === 32, 'RELEASE_SIGNING_INVALID');
    v.check(c.expected?.workflow === 'direct-cli-mcp-v1' && c.expected.skills?.['ab-generate-custom-landing'] && c.expected.skills?.['ab-audit-figma'] && c.expected.skills?.['figma-layer-name-hygiene'], 'RELEASE_EXPECTATIONS_REQUIRED');
    v.check(/^[a-f0-9]{64}$/.test(c.expected.auditDataId || ''), 'RELEASE_EXPECTATIONS_REQUIRED');
    v.check(/^[a-f0-9]{64}$/.test(c.expected.runtimeId || ''), 'RELEASE_EXPECTATIONS_REQUIRED');
    v.check(Number.isSafeInteger(c.previousAppReleaseId) && c.previousAppReleaseId > 0 && Object.keys(c.priorChannels || {}).length > 0, 'RELEASE_PREVIOUS_REQUIRED');
    for (const [version, blob] of Object.entries(c.priorChannels)) v.check(/^\d+\.\d+\.\d+$/.test(version) && /^[a-f0-9]{40}$/.test(blob), 'RELEASE_CHANNEL_PIN_INVALID');
    let ancestor = c.outputRoot;
    while (!sync.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    v.check(await fs.realpath(ancestor) === ancestor, 'RELEASE_OUTPUT_UNSAFE');
    for (const k of ROOTS) v.check(!v.overlaps(c.outputRoot, c[k]), 'RELEASE_OUTPUT_UNSAFE', k);
    c.configFile = await fs.realpath(file);
    v.check(!v.overlaps(c.outputRoot, c.configFile), 'RELEASE_OUTPUT_UNSAFE');
    return c;
}

async function inventory(c) {
    const files = [];
    for (const name of SOURCE) {
        const file = path.join(c.proxyRoot, name);
        if (name.endsWith('Package.resolved') && !sync.existsSync(file)) continue;
        files.push(...await v.tree(file));
    }
    for (const k of ROOTS.filter(k => !['proxyRoot', 'apolloRoot'].includes(k))) files.push(...await v.tree(c[k]));
    files.push(...await v.tree(path.join(c.apolloRoot, 'tests/landing-retry-facts.test.js')));
    for (const name of TESTS) files.push(...await v.tree(path.join(c.proxyRoot, 'test', name)));
    files.push(await v.pin(c.configFile));
    return [...new Map(files.map(p => [p.path, p])).values()].sort((a, b) => a.path.localeCompare(b.path));
}

function locations(c) {
    const source = path.join(c.outputRoot, 'source');
    return { source, app: path.join(c.outputRoot, 'app/ApolloProxyControl.app'),
        signed: path.join(c.outputRoot, 'signed'), data: path.join(c.outputRoot, 'data', c.dataVersion),
        channel: `apollo/proxy-releases/${c.version}/data-packages/current.json`,
        descriptor: `https://raw.githubusercontent.com/${c.dataRepository}/main/apollo/proxy-releases/${c.version}/data-packages/current.json`,
        appBase: `https://github.com/${c.appRepository}/releases/download/v${c.version}`,
        dataBase: `https://github.com/${c.dataRepository}/releases/download/apollo-data-${c.dataVersion}` };
}

function environment(c, l) {
    return { ...process.env, TMPDIR: sync.realpathSync(require('node:os').tmpdir()),
        CLANG_MODULE_CACHE_PATH: path.join(c.outputRoot, 'module-cache'), SWIFT_MODULECACHE_PATH: path.join(c.outputRoot, 'module-cache'),
        APOLLO_APP_BUILD_NUMBER: c.buildNumber, APOLLO_APP_DIST_DIR: path.dirname(l.app),
        APOLLO_APP_WORK_DIR: path.join(c.outputRoot, 'app-work'), APOLLO_PROXY_SOURCE_ROOT: l.source,
        APOLLO_PORTABLE_RUNTIME_SOURCE: c.runtimeRoot,
        APOLLO_SKILL_SOURCE_ROOT: path.join(l.source, 'codex-workspace/.agents/skills/apollo-design-validator'),
        APOLLO_NODE_SOURCE: c.nodeSource, APOLLO_EMPTY_DATA_START: '1', APOLLO_DATA_DESCRIPTOR_URL: l.descriptor,
        APOLLO_APPCAST_URL: `https://github.com/${c.appRepository}/releases/latest/download/appcast.xml`,
        APOLLO_SPARKLE_PUBLIC_KEY: c.sparklePublicKey, APOLLO_SPARKLE_KEY_ACCOUNT: c.sparkleAccount || 'apollo-proxy', CODESIGN_IDENTITY: c.signingIdentity,
        NOTARY_KEYCHAIN_PROFILE: '', REQUIRE_NOTARIZATION: '0', EMBED_PROXY_ENV: '0' };
}

async function actions(c, state, persist, signal, log) {
    const l = locations(c), env = environment(c, l);
    const run = (bin, args, options = {}) => v.command(bin, args, { env, signal, ...options });
    const publisher = createPublisher({ c, l, state, persist, run });
    const dataConfig = { schemaVersion: 'apollo.data-package-build.v1', ...Object.fromEntries(
        ['baseRelease', 'baseRuntimeRoot', 'runtimeRoot', 'knowledgeRoot', 'skillsRoot'].map(k => [k, c[k]])),
        outputRoot: path.join(c.outputRoot, 'data'), version: c.dataVersion,
        activationFile: path.join(c.outputRoot, 'activation.json'), tarballUrl: l.dataBase + `/apollo-data-${c.dataVersion}.tgz`,
        passwordCommand: ['/usr/bin/env', `CLANG_MODULE_CACHE_PATH=${env.CLANG_MODULE_CACHE_PATH}`, `SWIFT_MODULECACHE_PATH=${env.SWIFT_MODULECACHE_PATH}`,
            '/usr/bin/swift', path.join(l.source, 'macos-app/scripts/data-publisher.swift'), 'password'],
        incremental: { packUrl: l.dataBase + '/objects.bin', previousRoot: c.previousData } };
    const password = () => require(path.join(l.source, 'scripts/prepare-data-package')).passwordFrom(undefined, dataConfig.passwordCommand);
    const options = { c, l, run, dataConfig, password, signal };
    return {
        async preflight() {
            v.check(process.platform === 'darwin' && Number(process.versions.node.split('.')[0]) >= 22, 'RELEASE_ENVIRONMENT_UNSUPPORTED');
            v.check(!process.env.APOLLO_DATA_PRODUCER_ROOT && !process.env.APOLLO_DATA_TOKEN, 'RELEASE_ENVIRONMENT_OVERRIDE');
            for (const bin of ['gh', 'git', 'swift', 'python3', 'codesign', 'lipo', 'ditto', 'bash', 'rsync', 'xattr', 'spctl']) await run('/usr/bin/which', [bin]);
            await fs.access(c.nodeSource, sync.constants.X_OK);
            v.check(Number((await run(c.nodeSource, ['-p', 'process.versions.node.split(".")[0]'])).stdout.trim()) >= 22, 'RELEASE_ENVIRONMENT_UNSUPPORTED');
            v.check(!sync.existsSync(path.join(c.proxyRoot, 'macos-app/Sources/ApolloProxyControl/ApolloProxyControl.app')), 'RELEASE_STALE_SOURCE_BUNDLE');
            if (!sync.existsSync(l.source)) {
                for (const name of SOURCE) {
                    const from = path.join(c.proxyRoot, name);
                    if (!sync.existsSync(from) && name.endsWith('Package.resolved')) continue;
                    await fs.mkdir(path.dirname(path.join(l.source, name)), { recursive: true });
                    await fs.cp(from, path.join(l.source, name), { recursive: true, filter: async p => !(await fs.lstat(p)).isSymbolicLink() });
                }
            }
            for (const name of SOURCE) {
                const original = path.join(c.proxyRoot, name);
                if (!sync.existsSync(original) && name.endsWith('Package.resolved')) continue;
                for (const row of await v.tree(original)) {
                    const copied = await v.pin(path.join(l.source, path.relative(c.proxyRoot, row.path)));
                    v.check(row.sha256 === copied.sha256 && row.bytes === copied.bytes, 'RELEASE_SOURCE_COPY_CHANGED');
                }
            }
            const old = await v.plist(c.previousApp, run), previous = await v.read(path.join(c.previousData, 'current.json'));
            for (const name of Object.keys((await v.read(path.join(l.source, 'package.json'))).dependencies || {}))
                require.resolve(name, { paths: [l.source] });
            v.check(c.priorChannels[old.CFBundleShortVersionString] && BigInt(c.buildNumber) > BigInt(old.CFBundleVersion), 'RELEASE_PREVIOUS_INVALID');
            v.check(old.SUPublicEDKey === c.sparklePublicKey && old.SUFeedURL === env.APOLLO_APPCAST_URL, 'RELEASE_SIGNING_CHANGED');
            const api = require(path.join(l.source, 'src/data-release'));
            const runtime = api.readRuntime(c.runtimeRoot);
            v.check(runtime.id === c.expected.runtimeId && runtime.capabilities?.generationWorkflow === c.expected.workflow, 'RELEASE_RUNTIME_INVALID');
            const prior = await api.validateRelease(c.baseRelease, { runtimeRoot: c.baseRuntimeRoot });
            v.check(prior.id === previous.npm.dataId && prior.runtimeId === previous.runtimeId, 'RELEASE_PREVIOUS_INVALID');
            await v.json(path.join(c.outputRoot, 'activation.json'), previous.activation);
            const prep = require(path.join(l.source, 'scripts/prepare-data-package'));
            await prep.inputSnapshot(dataConfig);
            await fs.mkdir(env.CLANG_MODULE_CACHE_PATH, { recursive: true });
            await run('swift', ['package', '--package-path', path.join(l.source, 'macos-app'), 'describe', '--type', 'json'], { timeout: 120000 });
            await v.environmentProbe({ ...options, old });
            await publisher.preflight();
            return { value: { runtimeId: runtime.id, previousRuntimeId: prior.runtimeId, platform: process.platform, node: process.version },
                outputs: [path.join(c.outputRoot, 'activation.json')], tree: SOURCE.map(n => path.join(l.source, n)).filter(p => sync.existsSync(p)) };
        },
        async prepare() {
            v.check(!sync.existsSync(l.app) && !sync.existsSync(l.signed) && !sync.existsSync(l.data), 'RELEASE_PARTIAL_PREPARE_REQUIRES_RECONCILIATION');
            const cfg = path.join(c.outputRoot, 'data-config.json'); await v.json(cfg, dataConfig);
            // Both jobs consume the same pinned inputs. Neither invokes a model or an installed app.
            const jobs = await Promise.allSettled([
                run('bash', [path.join(l.source, 'macos-app/scripts/build-app.sh')], { timeout: 1800000, log: path.join(c.outputRoot, 'app-build.log') }),
                run(c.nodeSource, [path.join(l.source, 'scripts/prepare-data-package.js'), '--config', cfg], { timeout: 1800000, log: path.join(c.outputRoot, 'data-prepare.log') })
            ]);
            for (const job of jobs) if (job.status === 'rejected') throw job.reason;
            await run('bash', [path.join(l.source, 'macos-app/scripts/prepare-app-update.sh'), l.app, l.signed, l.appBase],
                { timeout: 300000, log: path.join(c.outputRoot, 'app-sign.log') });
            return { value: await v.read(path.join(l.signed, 'release.json')), tree: [l.app, l.signed, l.data], outputs: [cfg] };
        },
        async verify() { return v.localVerification(options); },
        async data() { return publisher.release('data'); },
        async 'public-data'() { return v.publicData(options); },
        async channel() { return publisher.channel(); },
        async migration() { return v.migration(options); },
        async recovery() { return v.recovery(options); },
        async app() { return publisher.release('app'); },
        async 'public-app'() { return v.publicApp(options); },
        async final() { return publisher.final(); }
    };
}

async function runRelease(c, { publish = false, preflightOnly = false, signal, createActions = actions,
    inputs = inventory, now = () => Date.now(), log = value => console.log(JSON.stringify(value)) } = {}) {
    await fs.mkdir(c.outputRoot, { recursive: true, mode: 0o700 });
    v.check(await fs.realpath(c.outputRoot) === c.outputRoot, 'RELEASE_OUTPUT_UNSAFE');
    const stateFile = path.join(c.outputRoot, 'state.json'), lockFile = path.join(c.outputRoot, '.release.lock');
    const lock = await fs.open(lockFile, 'wx').catch(e => { if (e.code === 'EEXIST') v.fail('RELEASE_WRITER_ACTIVE'); throw e; });
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: now() }));
    try {
        const hash = v.sha(Buffer.from(JSON.stringify(c))), existing = await v.read(stateFile).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
        if (!existing) v.check((await fs.readdir(c.outputRoot)).every(name => name === '.release.lock'), 'RELEASE_OUTPUT_NOT_EMPTY');
        const state = existing || { schemaVersion: SCHEMA, configHash: hash, runId: crypto.randomUUID(), phases: {}, remote: {}, inputs: await inputs(c), createdAt: now() };
        v.check(state.configHash === hash, 'RELEASE_CONFIG_CHANGED');
        const assertInputs = async () => {
            await v.verifyPins(state.inputs);
            v.check(JSON.stringify(await inputs(c)) === JSON.stringify(state.inputs), 'RELEASE_INPUT_SET_CHANGED');
        };
        await assertInputs();
        for (const phase of Object.values(state.phases)) if (phase.status === 'completed') {
            await v.verifyPins(phase.pins);
            for (const root of phase.trees || []) {
                const expected = phase.pins.filter(p => p.path === root || p.path.startsWith(root + path.sep));
                v.check(JSON.stringify(await v.tree(root)) === JSON.stringify(expected), 'RELEASE_OUTPUT_SET_CHANGED');
            }
        }
        if (state.writesClosed) { await seal(c, state, stateFile); return state; }
        const persist = () => v.json(stateFile, state);
        const jobs = await createActions(c, state, persist, signal, log);
        for (const name of PHASES) {
            if ((!publish && name === 'data') || (preflightOnly && name !== 'preflight')) break;
            if (state.phases[name]?.status === 'completed') { log({ phase: name, status: 'reused' }); continue; }
            v.check(!signal?.aborted, 'RELEASE_CANCELLED'); await assertInputs();
            const startedAt = now(), attempt = (state.phases[name]?.attempt || 0) + 1;
            state.phases[name] = { status: 'running', attempt, startedAt }; await persist(); log({ phase: name, status: 'running' });
            try {
                const result = await jobs[name]();
                v.check(!signal?.aborted, 'RELEASE_CANCELLED'); await assertInputs();
                const pins = [];
                for (const p of result.outputs || []) pins.push(await v.pin(p));
                for (const p of result.tree || []) pins.push(...await v.tree(p));
                const finishedAt = now();
                state.phases[name] = { status: 'completed', attempt, startedAt, finishedAt, durationMs: finishedAt - startedAt, result: result.value, pins, trees: result.tree || [] };
                await persist(); log({ phase: name, status: 'completed', durationMs: state.phases[name].durationMs });
            } catch (error) {
                const finishedAt = now();
                const failure = { status: signal?.aborted ? 'cancelled' : 'failed', attempt, startedAt, finishedAt, durationMs: finishedAt - startedAt, code: error.code || 'RELEASE_STEP_FAILED' };
                state.phases[name] = failure;
                await v.json(path.join(c.outputRoot, `failure-${name}-${attempt}.json`), failure); await persist(); throw error;
            }
        }
        state.status = state.phases.final?.status === 'completed' ? 'PUBLISHED_AWAITING_GENERAL' : preflightOnly ? 'PREFLIGHT_PASSED' : 'PREPARED_AWAITING_PUBLICATION';
        if (state.phases.final?.status === 'completed') {
            state.writesClosed = true; await persist();
            await seal(c, state, stateFile);
        } else await persist();
        return state;
    } finally { await lock.close(); await fs.unlink(lockFile); }
}

async function seal(c, state, stateFile) {
    const writeOnce = async (file, value) => {
        const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
        try { await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 }); }
        catch (e) { if (e.code !== 'EEXIST') throw e; v.check((await fs.readFile(file)).equals(bytes), 'RELEASE_SEAL_CHANGED'); }
    };
    const handoffFile = path.join(c.outputRoot, 'FINAL-HANDOFF.json');
    await writeOnce(handoffFile, { status: state.status, writesClosed: true, generalAcceptance: 'PENDING',
        version: c.version, dataVersion: c.dataVersion, runtimeId: state.phases.preflight.result.runtimeId,
        configHash: state.configHash, modelCalls: 0, installed: false, manualFigma: false,
        state: await v.pin(stateFile), timings: Object.fromEntries(Object.entries(state.phases).map(([k, p]) => [k, p.durationMs])) });
    await writeOnce(path.join(c.outputRoot, 'FINAL-SEAL.json'), { writesClosed: true,
        files: [await v.pin(stateFile), await v.pin(handoffFile), ...Object.values(state.phases).flatMap(p => p.pins)], inputs: state.inputs });
}

async function main(argv) {
    let file, publish = false, preflightOnly = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--config' && argv[i + 1]) file = path.resolve(argv[++i]);
        else if (argv[i] === '--publish') publish = true;
        else if (argv[i] === '--preflight') preflightOnly = true;
        else v.fail('RELEASE_ARGUMENT_INVALID');
    }
    v.check(file && !(publish && preflightOnly), 'RELEASE_ARGUMENT_INVALID');
    const controller = new AbortController();
    const stop = () => controller.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try { return await runRelease(await configuration(file), { publish, preflightOnly, signal: controller.signal }); }
    finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(JSON.stringify({ code: e.code || 'RELEASE_FAILED' })); process.exitCode = 1; });
module.exports = { SCHEMA, PHASES, configuration, inventory, locations, environment, runRelease, main };
