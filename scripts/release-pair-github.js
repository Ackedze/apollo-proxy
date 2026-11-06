'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const v = require('./release-pair-verify');

function createPublisher({ c, l, state, persist, run, api: injectedApi, upload: injectedUpload }) {
    const marker = `<!-- apollo-pair:${state.runId}:${state.configHash} -->`;
    async function api(endpoint, { method = 'GET', body, missing = false, pages = false } = {}) {
        if (injectedApi) return injectedApi(endpoint, { method, body, missing, pages });
        const args = ['api', endpoint];
        let input;
        if (pages) args.push('--paginate', '--slurp');
        if (method !== 'GET') {
            input = path.join(c.outputRoot, 'github-input-' + crypto.randomUUID() + '.json');
            await v.json(input, body); args.push('--method', method, '--input', input);
        }
        try {
            const result = await run('gh', args, { allowFailure: true, timeout: 90000 });
            let value; try { value = JSON.parse(result.stdout); } catch {}
            if (result.code && missing && String(value?.status) === '404') return null;
            v.check(result.code === 0 && value, 'RELEASE_GITHUB_REQUEST_FAILED');
            return pages ? value.flat() : value;
        } finally { if (input) await fs.rm(input); }
    }
    const latest = () => api(`repos/${c.appRepository}/releases/latest`);
    async function releaseAt(repo, tag) {
        const releases = await api(`repos/${repo}/releases?per_page=100`, { pages: true });
        const found = releases.filter(r => r.tag_name === tag);
        v.check(found.length <= 1, 'RELEASE_REMOTE_COLLISION'); return found[0] || null;
    }
    const owned = (release, tag) => release?.tag_name === tag && release.body?.includes(marker) && release.prerelease === false;
    async function priorChannels(ref = 'main') {
        for (const [version, sha] of Object.entries(c.priorChannels)) {
            const file = await api(`repos/${c.dataRepository}/contents/apollo/proxy-releases/${version}/data-packages/current.json?ref=${ref}`);
            v.check(file.sha === sha, 'RELEASE_PRIOR_CHANNEL_CHANGED');
        }
    }
    async function assetPlan(kind) {
        const release = kind === 'app' ? await v.read(path.join(l.signed, 'release.json')) : null;
        const files = kind === 'app' ? [path.join(l.signed, release.archive), path.join(l.signed, 'appcast.xml'), path.join(l.signed, 'release.json')]
            : ['current.json', `apollo-data-${c.dataVersion}.tgz`, 'incremental.json.enc', 'objects.bin'].map(n => path.join(l.data, n));
        const pins = await Promise.all(files.map(v.pin));
        const sums = path.join(c.outputRoot, kind.toUpperCase() + '-SHA256SUMS');
        const bytes = Buffer.from(pins.map(p => `${p.sha256}  ${path.basename(p.path)}\n`).join(''));
        try { v.check((await fs.readFile(sums)).equals(bytes), 'RELEASE_ASSET_PLAN_CHANGED'); }
        catch (e) { if (e.code !== 'ENOENT') throw e; await fs.writeFile(sums, bytes, { flag: 'wx', mode: 0o600 }); }
        return [...pins, await v.pin(sums)];
    }
    function verifyAsset(asset, pin) {
        v.check(asset?.state === 'uploaded' && asset.size === pin.bytes && asset.digest === 'sha256:' + pin.sha256, 'RELEASE_ASSET_MISMATCH');
    }
    async function activeApp(ownRelease) {
        const active = await latest();
        v.check(active.id === c.previousAppReleaseId || ownRelease && active.id === ownRelease.id, 'RELEASE_FOREIGN_LATEST_CHANGED');
    }
    async function preflight() {
        for (const repo of [c.appRepository, c.dataRepository]) {
            const info = await api(`repos/${repo}`); v.check(info.permissions?.push === true, 'RELEASE_REMOTE_PERMISSION_REQUIRED');
            const head = await api(`repos/${repo}/git/ref/heads/main`); v.check(/^[a-f0-9]{40}$/.test(head.object?.sha), 'RELEASE_REMOTE_HEAD_INVALID');
        }
        for (const [kind, repo, tag] of [['app', c.appRepository, 'v' + c.version], ['data', c.dataRepository, 'apollo-data-' + c.dataVersion]]) {
            const remote = await releaseAt(repo, tag);
            v.check(!remote || owned(remote, tag), 'RELEASE_REMOTE_COLLISION');
            const ref = await api(`repos/${repo}/git/ref/tags/${tag}`, { missing: true });
            v.check(!ref || remote && owned(remote, tag), 'RELEASE_REMOTE_TAG_COLLISION');
            if (kind === 'app') await activeApp(remote);
        }
        await priorChannels();
        const channel = await api(`repos/${c.dataRepository}/contents/${l.channel}?ref=main`, { missing: true });
        v.check(!channel || state.remote.channel?.commit, 'RELEASE_REMOTE_CHANNEL_COLLISION');
        return { value: { accessible: true, priorChannelsPreserved: true } };
    }
    async function release(kind) {
        const repo = kind === 'app' ? c.appRepository : c.dataRepository;
        const tag = kind === 'app' ? 'v' + c.version : 'apollo-data-' + c.dataVersion;
        const assets = await assetPlan(kind);
        const record = state.remote[kind] ||= { mutations: {} };
        let remote = await releaseAt(repo, tag);
        v.check(!remote || owned(remote, tag), 'RELEASE_REMOTE_COLLISION');
        if (kind === 'app') await activeApp(remote);
        if (!remote) {
            v.check(!record.mutations.create, 'RELEASE_REMOTE_OUTCOME_UNKNOWN');
            v.check(!await api(`repos/${repo}/git/ref/tags/${tag}`, { missing: true }), 'RELEASE_REMOTE_TAG_COLLISION');
            const head = await api(`repos/${repo}/git/ref/heads/main`);
            record.mutations.create = { status: 'intent', target: head.object.sha }; await persist();
            const body = { tag_name: tag, target_commitish: head.object.sha, name: `Apollo ${kind === 'app' ? 'Proxy ' + c.version : 'data ' + c.dataVersion}`,
                body: (c.notes?.[kind] || '') + '\n' + marker, draft: true, prerelease: false };
            try { remote = await api(`repos/${repo}/releases`, { method: 'POST', body }); }
            catch (error) {
                remote = await releaseAt(repo, tag);
                if (!owned(remote, tag)) throw error;
            }
            v.check(owned(remote, tag), 'RELEASE_REMOTE_OWNERSHIP_INVALID');
        }
        record.id ||= remote.id;
        v.check(record.id === remote.id, 'RELEASE_REMOTE_OWNERSHIP_INVALID'); await persist();
        for (const file of remote.assets) v.check(assets.some(p => path.basename(p.path) === file.name), 'RELEASE_FOREIGN_ASSET_PRESENT');
        for (const pin of assets) {
            const name = path.basename(pin.path), found = remote.assets.find(a => a.name === name);
            if (found) { verifyAsset(found, pin); continue; }
            v.check(remote.draft && !record.mutations[name], 'RELEASE_REMOTE_OUTCOME_UNKNOWN');
            record.mutations[name] = { status: 'intent', sha256: pin.sha256 }; await persist();
            let error;
            try {
                if (injectedUpload) await injectedUpload(repo, tag, pin);
                else await run('gh', ['release', 'upload', tag, pin.path, '--repo', repo], { timeout: 300000 });
            } catch (e) { error = e; }
            remote = await api(`repos/${repo}/releases/${record.id}`);
            v.check(owned(remote, tag), 'RELEASE_REMOTE_OWNERSHIP_INVALID');
            const uploaded = remote.assets.find(a => a.name === name);
            if (!uploaded && error) throw error;
            v.check(uploaded, 'RELEASE_REMOTE_OUTCOME_UNKNOWN'); verifyAsset(uploaded, pin);
            record.mutations[name].status = 'confirmed'; await persist();
        }
        if (remote.draft) {
            if (kind === 'app') await activeApp(remote);
            record.mutations.publish = { status: 'intent' }; await persist();
            let error;
            try { await api(`repos/${repo}/releases/${record.id}`, { method: 'PATCH', body: { draft: false, make_latest: kind === 'app' ? 'true' : 'false' } }); }
            catch (e) { error = e; }
            remote = await api(`repos/${repo}/releases/${record.id}`);
            if (remote.draft && error) throw error;
        }
        v.check(owned(remote, tag) && remote.draft === false, 'RELEASE_PUBLICATION_UNCONFIRMED');
        for (const p of assets) verifyAsset(remote.assets.find(a => a.name === path.basename(p.path)) || {}, p);
        record.url = remote.html_url; record.published = true; await persist();
        return { value: { id: remote.id, url: remote.html_url, tag, published: true }, outputs: assets.map(p => p.path) };
    }
    async function channel() {
        await priorChannels();
        const endpoint = `repos/${c.dataRepository}/contents/${l.channel}`;
        const bytes = await fs.readFile(path.join(l.data, 'current.json'));
        let existing = await api(endpoint + '?ref=main', { missing: true });
        const record = state.remote.channel ||= {};
        let commit = record.commit;
        if (!existing) {
            v.check(!record.intent, 'RELEASE_REMOTE_OUTCOME_UNKNOWN');
            record.intent = true; await persist();
            let error;
            try {
                const created = await api(endpoint, { method: 'PUT', body: { message: `Publish Apollo ${c.version} data ${marker}`, content: bytes.toString('base64'), branch: 'main' } });
                commit = created.commit.sha;
            } catch (e) { error = e; }
            existing = await api(endpoint + '?ref=main', { missing: true });
            if (!existing && error) throw error;
        }
        v.check(existing && Buffer.from(existing.content, 'base64').equals(bytes), 'RELEASE_REMOTE_CHANNEL_COLLISION');
        if (!commit) {
            v.check(record.intent, 'RELEASE_REMOTE_CHANNEL_COLLISION');
            const commits = await api(`repos/${c.dataRepository}/commits?path=${encodeURIComponent(l.channel)}&per_page=1`);
            v.check(commits[0]?.commit.message.includes(marker), 'RELEASE_REMOTE_CHANNEL_COLLISION'); commit = commits[0].sha;
        }
        const detail = await api(`repos/${c.dataRepository}/commits/${commit}`);
        v.check(detail.commit.message.includes(marker) && detail.files.length === 1 && detail.files[0].filename === l.channel && detail.files[0].status === 'added', 'RELEASE_CHANNEL_COMMIT_INVALID');
        await priorChannels(commit);
        record.commit = commit; record.blob = existing.sha; await persist();
        const file = path.join(c.outputRoot, 'channel.json'); await v.json(file, record);
        return { value: record, outputs: [file] };
    }
    async function final() {
        await priorChannels(); const active = await latest();
        v.check(active.id === state.remote.app?.id && active.draft === false, 'RELEASE_FOREIGN_LATEST_CHANGED');
        for (const kind of ['app', 'data']) {
            const repo = kind === 'app' ? c.appRepository : c.dataRepository;
            const remote = await api(`repos/${repo}/releases/${state.remote[kind].id}`);
            const tag = kind === 'app' ? 'v' + c.version : 'apollo-data-' + c.dataVersion;
            v.check(owned(remote, tag) && !remote.draft, 'RELEASE_PUBLICATION_UNCONFIRMED');
            const plan = await assetPlan(kind);
            v.check(remote.assets.length === plan.length, 'RELEASE_FOREIGN_ASSET_PRESENT');
            for (const pin of plan) verifyAsset(remote.assets.find(a => a.name === path.basename(pin.path)) || {}, pin);
        }
        const current = await api(`repos/${c.dataRepository}/contents/${l.channel}?ref=main`);
        v.check(current.sha === state.remote.channel.blob, 'RELEASE_REMOTE_CHANNEL_COLLISION');
        return { value: { appReleaseId: active.id, appUrl: state.remote.app.url, dataUrl: state.remote.data.url,
            channelCommit: state.remote.channel.commit, priorChannelsPreserved: true }, outputs: [] };
    }
    return { preflight, release, channel, final };
}
module.exports = { createPublisher };
