import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { assertExistingTarget, assertCheckpointReadback, waitDockerStream }
  from '../../scripts/reconcile-local-native-reboot.mjs';

const services = ['backend', 'clamav', 'frontend', 'inquiry', 'postgres', 'redis'];
const target = () => {
  const rows = services.map(Service => ({ Project: 'sabalanerp-local', Service,
    Health: Service === 'backend' ? '' : 'healthy' }));
  const containers = Object.fromEntries(services.map(service => [service, {
    Id: service === 'backend' ? 'd9b3fa7533bb54d39f355f479814517d71f5d4cdfecb99a8a54a38c28da7af4a' : service,
    Image: service === 'backend' ? 'sha256:80e43f635da51a9290281b12a1b0a3b7d0a9ad2da81d41e8111c8a50c8de642d' : service,
    Config: { Labels: { 'com.docker.compose.project': 'sabalanerp-local',
      'com.docker.compose.service': service } },
    HostConfig: { NetworkMode: 'sabalanerp-local_default',
      PortBindings: service === 'backend' ? { '5000/tcp': [{ HostIp: '127.0.0.1', HostPort: '5000' }] } : {} },
    State: { Restarting: service === 'backend' },
  }]));
  return { rows, containers };
};

test('host proof requires the exact existing six-service project and private bindings', () => {
  const { rows, containers } = target();
  assert.equal(assertExistingTarget(rows, containers), true);
  for (const mutate of [
    state => { state.rows.pop(); },
    state => { state.rows[0].Project = 'other'; },
    state => { state.rows[1].Health = 'unhealthy'; },
    state => { state.containers.backend.Id = 'other'; },
    state => { state.containers.backend.Image = 'sha256:' + '0'.repeat(64); },
    state => { state.containers.backend.HostConfig.PortBindings['5000/tcp'][0].HostIp = '0.0.0.0'; },
    state => { state.containers.backend.HostConfig.NetworkMode = 'host'; },
    state => { state.containers.inquiry.Config.Labels['com.docker.compose.service'] = 'backend'; },
  ]) {
    const changed = target(); mutate(changed);
    assert.throws(() => assertExistingTarget(changed.rows, changed.containers));
  }
});

test('checkpoint proof refuses a changed object in either copy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-local-reboot-host-test-'));
  assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  try {
    const primaryPath = path.join(root, 'primary'), independentPath = path.join(root, 'independent');
    fs.mkdirSync(primaryPath); fs.mkdirSync(independentPath);
    const bytes = Buffer.from('checkpoint-object');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const manifest = { entries: [{ name: 'object.bin', bytes: bytes.length, sha256 }] };
    const raw = Buffer.from(JSON.stringify(manifest) + '\n');
    const manifestSha256 = createHash('sha256').update(raw).digest('hex');
    for (const directory of [primaryPath, independentPath]) {
      fs.writeFileSync(path.join(directory, 'object.bin'), bytes);
      fs.writeFileSync(path.join(directory, 'manifest.json'), raw);
    }
    const checkpoint = { primaryPath, independentPath, manifest, manifestSha256 };
    assert.equal(assertCheckpointReadback(checkpoint), true);
    fs.writeFileSync(path.join(independentPath, 'object.bin'), 'tampered-object');
    assert.throws(() => assertCheckpointReadback(checkpoint));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('stream timeout rejects even when inherited pipes never close', async () => {
  const child = new EventEmitter();
  let killed = false;
  child.kill = () => { killed = true; return true; };
  await assert.rejects(waitDockerStream(child, 5), /exceeded/);
  assert.equal(killed, true);
});
