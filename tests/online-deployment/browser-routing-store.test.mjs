import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {openSync, closeSync, fstatSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import {BrowserRoutingStore, BrowserRoutingPublicationLock} from '../../deploy/scripts/browser-routing-store.mjs';
import {selectBrowserRelease, compileBrowserRoutingRegistry} from '../../deploy/scripts/browser-release-routing.mjs';

const image = `sha256:${'a'.repeat(64)}`;
const baseline = () => ({format: 'sabalan-browser-routing/v1', generation: 1,
  current: {erp: 'erp_first', inquiry: 'inquiry_first'}, legacy: {erp: 'erp_first', inquiry: 'inquiry_first'},
  builds: ['erp_first', 'inquiry_first'].map(id => ({id, application: id.startsWith('erp_') ? 'erp' : 'inquiry',
    image, slotId: 'slot_' + id, manifestSha256: 'b'.repeat(64), actionIds: [], assets: [], retiredAt: null, supportUntil: null}))});
const retire = (input, name, time) => {
  const result = structuredClone(input); result.generation++;
  const old = result.builds.find(build => build.id === result.current.erp);
  old.retiredAt = time; old.supportUntil = new Date(Date.parse(time) + 86400000).toISOString();
  const next = {...old, id: name, slotId: 'slot_' + name, retiredAt: null, supportUntil: null};
  result.builds.push(next); result.current.erp = name; return result;
};

async function fixture(run) {
  assert.equal(process.platform, 'linux', 'native publication acceptance requires Linux');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-routing-store-'));
  const directory = path.join(root, 'publications'); await fs.mkdir(directory, {mode: 0o700});
  const file = path.join(root, 'publication.lock'), descriptor = openSync(file, 'wx+', 0o600);
  const locked = spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', '3'], {stdio: ['ignore', 'ignore', 'ignore', descriptor]});
  assert.equal(locked.status, 0); assert.equal(locked.signal, null);
  const actual = fstatSync(descriptor, {bigint: true});
  const publicationLock = new BrowserRoutingPublicationLock({file, descriptor,
    identity: {device: actual.dev.toString(), inode: actual.ino.toString(), ownerUid: process.getuid()}});
  let owned = true;
  const owner = () => {if (!owned) throw Error('NATIVE_PUBLICATION_OWNERSHIP_LOST');};
  try {await run({directory, publicationLock, owner, loseOwner: () => {owned = false;}});}
  finally {
    closeSync(descriptor);
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('sabalan-routing-store-'));
    await fs.rm(root, {recursive: true, force: true});
  }
}

test('persistent multi-release switching and proxy restart retain every old browser build for its full retirement window', async () => {
  await fixture(async ({directory, publicationLock, owner}) => {
    let store = new BrowserRoutingStore({directory, publicationLock, assertReleaseOwnership: owner});
    const first = baseline(), publication1 = await store.publish(first, null);
    const second = retire(first, 'erp_second', '2026-10-17T12:00:00.000Z');
    const publication2 = await store.publish(second, publication1.publicationSha256);
    const third = retire(second, 'erp_third', '2026-10-17T12:05:00.000Z');
    await store.publish(third, publication2.publicationSha256);
    store = new BrowserRoutingStore({directory});
    const registry = compileBrowserRoutingRegistry(await store.read());
    const request = {application: 'erp', isRsc: true, deploymentId: 'erp_first'};
    assert.equal(selectBrowserRelease(registry, {application: 'erp'}).buildId, 'erp_third');
    assert.equal(selectBrowserRelease(registry, request, Date.parse('2026-10-18T11:59:59.999Z')).requiresDraftHandoff, false);
    assert.equal(selectBrowserRelease(registry, request, Date.parse('2026-10-18T12:00:00.000Z')).requiresDraftHandoff, true);
    assert.equal(selectBrowserRelease(registry, request, Date.parse('2026-10-18T12:00:00.000Z')).buildId, 'erp_first',
      'expiry cannot silently redirect or discard an old form');
    assert.equal(selectBrowserRelease(registry, {application: 'erp', isRsc: true}).buildId, 'erp_first');
    assert.equal(selectBrowserRelease(registry, {...request, deploymentId: 'erp_second'}).buildId, 'erp_second');
    await assert.rejects(() => store.publish({...third, generation: 4}, null), /READ_ONLY/);
  });
});

test('opening the matching inode without its existing exclusive native lock never grants publication ownership', async () => {
  await fixture(async ({directory}) => {
    const file = path.join(path.dirname(directory), 'publication.lock');
    const descriptor = openSync(file, 'r+'), actual = fstatSync(descriptor, {bigint: true});
    try {
      assert.throws(() => new BrowserRoutingPublicationLock({file, descriptor,
        identity: {device: actual.dev.toString(), inode: actual.ino.toString(), ownerUid: process.getuid()}}), /LOCK_UNPROVEN/);
    } finally {closeSync(descriptor);}
  });
});

test('compatible rollback is a new immutable publication and retains current and previously retired browser identities', async () => {
  await fixture(async ({directory, publicationLock, owner}) => {
    const store = new BrowserRoutingStore({directory, publicationLock, assertReleaseOwnership: owner});
    const first = baseline(), one = await store.publish(first, null);
    const second = retire(first, 'erp_second', '2026-10-17T12:00:00.000Z');
    second.builds[0].supportUntil = '2026-10-19T12:00:00.000Z';
    const two = await store.publish(second, one.publicationSha256);
    const rollback = structuredClone(second); rollback.generation++;
    rollback.current.erp = 'erp_first';
    Object.assign(rollback.builds[0], {retiredAt: null, supportUntil: null});
    Object.assign(rollback.builds[2], {retiredAt: '2026-10-17T12:05:00.000Z', supportUntil: '2026-10-18T12:05:00.000Z'});
    await store.publish(rollback, two.publicationSha256);
    const fresh = new BrowserRoutingStore({directory, publicationLock, assertReleaseOwnership: owner});
    assert.deepEqual(await fresh.read(), rollback);
    const secondRetirement = structuredClone(second); secondRetirement.generation = 4;
    secondRetirement.builds[0].retiredAt = '2026-10-17T12:10:00.000Z';
    secondRetirement.builds[0].supportUntil = '2026-10-18T12:10:00.000Z';
    const currentBytes = await fs.readFile(path.join(directory, 'published-00000003.json'));
    await assert.rejects(() => store.publish(secondRetirement, createHash('sha256').update(currentBytes).digest('hex')),
      /HISTORICAL_SUPPORT_SHORTENED/);
    assert.deepEqual(await fresh.read(), rollback);
    secondRetirement.builds[0].supportUntil = '2026-10-19T12:10:00.000Z';
    await store.publish(secondRetirement, createHash('sha256').update(currentBytes).digest('hex'));
    assert.equal((await store.read()).builds[0].supportUntil, '2026-10-19T12:10:00.000Z');
  });
});

test('wrong predecessor, changed build bytes, shortened support, legacy reassignment and omitted retirement refuse before publication', async () => {
  await fixture(async ({directory, publicationLock, owner}) => {
    const store = new BrowserRoutingStore({directory, publicationLock, assertReleaseOwnership: owner});
    const first = baseline(), one = await store.publish(first, null);
    const second = retire(first, 'erp_second', '2026-10-17T12:00:00.000Z');
    await assert.rejects(() => store.publish(second, null), /PREDECESSOR_CHANGED/);
    for (const [change, error] of [
      [value => {value.builds[0].image = `sha256:${'c'.repeat(64)}`;}, /BUILD_IDENTITY_CHANGED/],
      [value => {value.legacy.erp = 'erp_second';}, /LEGACY_OWNER_CHANGED/],
      [value => {value.builds[0].retiredAt = value.builds[0].supportUntil = null;}, /RETIREMENT_REQUIRED/],
      [value => {value.builds = value.builds.filter(build => build.id !== 'erp_first'); value.legacy.erp = 'erp_second';}, /SUPPORTED_BUILD_REMOVED/],
    ]) {
      const candidate = structuredClone(second); change(candidate);
      await assert.rejects(() => store.publish(candidate, one.publicationSha256), error);
      assert.deepEqual(await store.read(), first);
    }
    const two = await store.publish(second, one.publicationSha256);
    const shortened = structuredClone(second); shortened.generation++;
    shortened.builds[0].retiredAt = '2026-10-17T11:59:00.000Z';
    shortened.builds[0].supportUntil = '2026-10-18T11:59:00.000Z';
    await assert.rejects(() => store.publish(shortened, two.publicationSha256), /SUPPORT_WINDOW_SHORTENED|HISTORICAL_SUPPORT_SHORTENED/);
  });
});

test('publication inventory exhaustion refuses before a prepared intent and keeps the existing current registry readable', {timeout: 120000}, async () => {
  await fixture(async ({directory, publicationLock, owner}) => {
    const store = new BrowserRoutingStore({directory, publicationLock, assertReleaseOwnership: owner});
    await store.publish(baseline(), null);
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    const {browserRoutingIdentity} = await import('../../deploy/scripts/browser-release-routing.mjs');
    let bytes = await fs.readFile(path.join(directory, 'published-00000001.json'));
    for (let generation = 2; generation <= 8192; generation++) {
      const registry = baseline(); registry.generation = generation;
      bytes = Buffer.from(JSON.stringify(canonical({format: 'sabalan-browser-publication/v1', generation,
        previousPublicationSha256: createHash('sha256').update(bytes).digest('hex'),
        registryIdentity: browserRoutingIdentity(registry), registry})) + '\n');
      await fs.writeFile(path.join(directory, `published-${String(generation).padStart(8, '0')}.json`), bytes, {flag: 'wx', mode: 0o600});
    }
    const next = baseline(); next.generation = 8193;
    await assert.rejects(() => store.publish(next, createHash('sha256').update(bytes).digest('hex')), /INVENTORY_CAPACITY/);
    assert.equal((await fs.readdir(directory)).length, 8192);
    assert.equal((await new BrowserRoutingStore({directory}).read()).generation, 8192);
  });
});

test('lost publication ownership leaves a prepared intent; current traffic survives and a replacement cannot erase or reuse it', async () => {
  await fixture(async ({directory, publicationLock, owner, loseOwner}) => {
    const firstStore = new BrowserRoutingStore({directory, publicationLock, assertReleaseOwnership: owner});
    const first = baseline(), one = await firstStore.publish(first, null);
    const second = retire(first, 'erp_second', '2026-10-17T12:00:00.000Z');
    let checks = 0;
    const interrupted = new BrowserRoutingStore({directory, publicationLock, assertReleaseOwnership: () => {
      if (++checks === 3) loseOwner(); owner();
    }});
    await assert.rejects(() => interrupted.publish(second, one.publicationSha256), /OWNERSHIP_LOST/);
    assert.deepEqual(await firstStore.read(), first);
    assert.equal((await fs.readdir(directory)).filter(name => name.startsWith('.prepared-')).length, 1);
    const replacement = new BrowserRoutingStore({directory, publicationLock, assertReleaseOwnership: () => {}});
    await assert.rejects(() => replacement.publish(second, one.publicationSha256), /REQUIRES_INSPECTION/);
    assert.deepEqual(await replacement.read(), first);
  });
});

test('missing history and modified immutable bytes fail after a new reader starts instead of selecting an older current build', async () => {
  await fixture(async ({directory, publicationLock, owner}) => {
    const store = new BrowserRoutingStore({directory, publicationLock, assertReleaseOwnership: owner});
    const first = baseline(), one = await store.publish(first, null);
    await store.publish(retire(first, 'erp_second', '2026-10-17T12:00:00.000Z'), one.publicationSha256);
    const original = await fs.readFile(path.join(directory, 'published-00000001.json'));
    await fs.unlink(path.join(directory, 'published-00000001.json'));
    await assert.rejects(() => new BrowserRoutingStore({directory, publicationLock, assertReleaseOwnership: owner}).read(), /HISTORY_GAP/);
    await fs.writeFile(path.join(directory, 'published-00000001.json'), original, {flag: 'wx', mode: 0o600});
    const modified = JSON.parse(original); modified.registry.builds[0].slotId = 'slot_changed';
    await fs.writeFile(path.join(directory, 'published-00000001.json'), JSON.stringify(modified) + '\n');
    await assert.rejects(() => new BrowserRoutingStore({directory, publicationLock, assertReleaseOwnership: owner}).read(), /PUBLICATION_INVALID|HISTORY_INVALID/);
  });
});
