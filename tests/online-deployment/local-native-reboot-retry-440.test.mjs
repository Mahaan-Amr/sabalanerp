import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFailedTarget } from '../../scripts/retry-local-native-reboot-440.mjs';

const other = { clamav: 'b89c4299ea7d41a1895c8d52a1835cefd3da2d447d6e1e985bb201ee00a1dca8',
  frontend: '19aebf5decc2ed7cdf62a83f5b4f792d320bf74cffb32a14ddcd97258f930115',
  inquiry: 'b67c817a4eee00e71a821805b3d80354f74758e5140418229a0fdb781d7a4257',
  postgres: '3ba7c705a08e4c3066a6dd43aa839ef9bcfd2614745558052884f2a4de787c48',
  redis: '06c2b7237917b007962b6e93dcc7ffb7fb49233f21c1d8c370c65134666ce3d8' };
const volumes = [
  'sabalanerp-local_recovery_coordination', 'sabalanerp-local_backend_uploads',
  'sabalanerp-local_inquiry_data', 'sabalanerp-local_backend_storage_accounting_contracts',
  'sabalanerp-local_backend_storage_contracts', 'sabalanerp-local_backend_storage_dispatch_documents',
  'sabalanerp-local_backend_storage_hr_hiring', 'sabalanerp-local_backend_recovery',
  'sabalanerp-local_backend_storage_sepidar_backups',
  'sabalanerp-local_backend_storage_support_tickets',
];
const fixture = () => {
  const services = ['backend', ...Object.keys(other)];
  const rows = services.map(Service => ({ Service, Project: 'sabalanerp-local',
    Health: Service === 'backend' ? '' : 'healthy' }));
  const containers = Object.fromEntries(services.map(service => [service, {
    Id: service === 'backend' ? 'b458b387a52ceeff66d101298764846b64701b2ca6fc78a45856efb1911763e4' : other[service],
    Image: service === 'backend' ? 'sha256:84d6cadf143013d289efb80d5f533d31bfe06d43a285bf5611e88c23e213a5d2' : service,
    State: service === 'backend' ? { Status: 'exited', ExitCode: 75 } : { Status: 'running' },
    Mounts: service === 'backend' ? volumes.map(Name => ({ Type: 'volume', Name })) : [],
    Config: { Labels: { 'com.docker.compose.project': 'sabalanerp-local',
      'com.docker.compose.service': service } },
    HostConfig: { NetworkMode: 'sabalanerp-local_default', PortBindings: service === 'backend'
      ? { '5000/tcp': [{ HostIp: '127.0.0.1', HostPort: '5000' }] } : {} },
  }]));
  const state = { activeSha256: 'b820bfa60ec642b87c17a34fcbc527021164708a33df1227d7e19c39c4f8be8a',
    active: { guardian: { bootId: 'db891a29-1343-421d-9df8-28b3b495cf08',
      pidNamespace: 'pid:[4026532751]', startTicks: '1829736' } },
    priorProofSha256: 'd96d4a1e369cafc96766a251effdeec7ddc77a2cc0c9e2b750b4fb243626babe',
    receiptExists: false };
  const database = { system: '7703877635514671138', oid: '57567', oldSessions: 0,
    allTagged: 0, prepared: 0 };
  return { rows, containers, state, database };
};

test('retry accepts only the observed failed one-shot with quiet SQL and five unchanged services', () => {
  const original = fixture();
  assert.equal(assertFailedTarget(...Object.values(original)), true);
  for (const change of [
    value => { value.containers.backend.State.ExitCode = 0; },
    value => { value.containers.backend.Id = 'different'; },
    value => { value.containers.inquiry.Id = 'different'; },
    value => { value.containers.backend.Mounts.pop(); },
    value => { value.containers.backend.HostConfig.PortBindings['5000/tcp'][0].HostIp = '0.0.0.0'; },
    value => { value.state.priorProofSha256 = '0'.repeat(64); },
    value => { value.state.receiptExists = true; },
    value => { value.database.oldSessions = 1; },
    value => { value.database.prepared = 1; },
  ]) {
    const changed = fixture(); change(changed);
    assert.throws(() => assertFailedTarget(...Object.values(changed)));
  }
});
