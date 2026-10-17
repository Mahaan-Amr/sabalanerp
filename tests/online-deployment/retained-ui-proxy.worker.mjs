// Private local acceptance fixture. No production admission, business routing,
// release lease, database access or public management listener is provided.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {openSync, closeSync, fstatSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import path from 'node:path';
import {once} from 'node:events';
import {BrowserRoutingStore, BrowserRoutingPublicationLock} from '../../deploy/scripts/browser-routing-store.mjs';
import {BrowserOperationJournal} from '../../deploy/scripts/browser-operation-journal.mjs';
import {createBrowserReleaseProxy} from '../../deploy/scripts/browser-release-proxy.mjs';
import {privateUiManagementServer} from './private-ui-management.fixture.mjs';

const root = process.env.RETAINED_UI_FIXTURE_ROOT;
assert.match(root ?? '', /^\/app\/online-runtime-acceptance\/retained-ui-[a-f0-9]{32}$/);
assert.equal(await fs.realpath(root), root);
const rootStat = await fs.lstat(root);
assert.equal(rootStat.uid, process.getuid()); assert.equal(rootStat.mode & 0o077, 0);
const configurationBytes = await fs.readFile(path.join(root, 'configuration.json'));
assert.equal(createHash('sha256').update(configurationBytes).digest('hex'), process.env.RETAINED_UI_CONFIGURATION_SHA256);
const configuration = JSON.parse(configurationBytes);
assert.equal(configuration.format, 'sabalan-private-retained-ui-acceptance/v1');
const file = path.join(root, 'publication.lock'), descriptor = openSync(file, 'a+', 0o600);
assert.equal(spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', '3'], {stdio: ['ignore', 'ignore', 'ignore', descriptor]}).status, 0);
const lockStat = fstatSync(descriptor, {bigint: true});
const publicationLock = new BrowserRoutingPublicationLock({file, descriptor, identity: {
  device: lockStat.dev.toString(), inode: lockStat.ino.toString(), ownerUid: process.getuid(),
}});
let closing = false;
// Diagnostic ownership only. This cannot satisfy a production release lease.
const store = new BrowserRoutingStore({directory: path.join(root, 'publications'), publicationLock,
  assertReleaseOwnership: () => {assert.ok(!closing); publicationLock.assertOwned();}});
try {await store.readPublication();}
catch (failure) {
  if (failure.code !== 'BROWSER_ROUTING_NOT_PUBLISHED') throw failure;
  await store.publish(configuration.initialRegistry, null);
}
const journal = new BrowserOperationJournal({directory: path.join(root, 'operations'), instanceId: randomBytes(32).toString('hex')});
await journal.initialize();
const proxy = createBrowserReleaseProxy({loadRegistry: () => store.read(), slotEndpoints: configuration.slotEndpoints,
  applicationsByHost: {'127.0.0.1:3104': 'erp'}, operationJournal: journal, timeoutMs: 10000});

const managementPath = path.join(root, 'management.sock');
try {await fs.lstat(managementPath); throw Error('FIXTURE_MANAGEMENT_SOCKET_ALREADY_EXISTS');}
catch (failure) {if (failure.code !== 'ENOENT') throw failure;}
const management = privateUiManagementServer(async command => {
      if (command === 'status') return {publication: await store.readPublication(), proxy: proxy.status(), pending: await journal.pending()};
      if (command === 'drain') {
        proxy.beginDrain(); await proxy.assertDrained(); return {drained: true};
      }
      if (!['next', 'rollback'].includes(command)) throw Error('FIXTURE_COMMAND_INVALID');
      const current = await store.readPublication(), registry = structuredClone(current.registry);
      const id = command === 'next' ? configuration.nextBuild.id : configuration.initialRegistry.current.erp;
      if (registry.current.erp === id) throw Error('FIXTURE_BUILD_ALREADY_CURRENT');
      const now = new Date(), until = new Date(now.getTime() + 86400000).toISOString();
      const previous = registry.builds.find(build => build.id === registry.current.erp);
      previous.retiredAt = now.toISOString();
      previous.supportUntil = new Date(Math.max(Date.parse(until), Date.parse(previous.supportUntil) || 0)).toISOString();
      let next = registry.builds.find(build => build.id === id);
      if (!next) {next = structuredClone(configuration.nextBuild); registry.builds.push(next);}
      next.retiredAt = null; next.supportUntil = null; registry.current.erp = id; registry.generation++;
      return {published: await store.publish(registry, current.publicationSha256)};
});
management.listen(managementPath); await once(management, 'listening'); await fs.chmod(managementPath, 0o600);
const socketIdentity = await fs.lstat(managementPath);
proxy.server.listen(3000, '0.0.0.0'); await once(proxy.server, 'listening');
console.log(JSON.stringify({privateDiagnosticProxyReady: true, root, generation: (await store.readPublication()).generation}));
async function shutdown() {
  if (closing) return;
  closing = true; proxy.beginDrain();
  await new Promise(resolve => proxy.server.close(resolve)); await proxy.assertDrained();
  await new Promise(resolve => management.close(resolve));
  try {
    const named = await fs.lstat(managementPath);
    assert.equal(named.ino, socketIdentity.ino); assert.equal(named.dev, socketIdentity.dev); assert.ok(named.isSocket());
    await fs.unlink(managementPath);
  } catch (failure) {if (failure.code !== 'ENOENT') throw failure;}
  closeSync(descriptor);
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  shutdown().then(() => process.exit(0), failure => {
    console.error(failure.code || failure.message);
    // Unresolved transport stays retained and requires inspection; no success.
    process.exitCode = 1;
  });
});
