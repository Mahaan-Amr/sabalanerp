// Strict retirement of a completed/no-work LOCAL diagnostic operation only.
// Uncertain transport is retained; this provides no production retirement path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const operation = process.argv[2]; assert.match(operation ?? '', /^[a-f0-9]{32}$/);
const root = '/app/online-runtime-acceptance/retained-ui-' + operation;
const repository = path.resolve(import.meta.dirname, '../..');
const services = ['frontend-online-proxy', 'frontend-online-old', 'frontend-online-new'];
function docker(args, captureBoth = false) {
  const rows = execFileSync('docker', ['compose', '-f', 'D:/sabalanerp/docker-compose.local.yml', 'ps', '--format', 'json'], {encoding: 'utf8'})
    .trim().split(/\r?\n/).flatMap(line => JSON.parse(line));
  for (const service of ['backend', 'frontend', 'inquiry', 'postgres']) assert.ok(rows.some(row => row.Project === 'sabalanerp-local'
    && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
  if (captureBoth) {
    const result = spawnSync('docker', args, {encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024});
    assert.equal(result.status, 0); assert.equal(result.signal, null); assert.equal(result.error, undefined);
    return result.stdout + '\n' + result.stderr;
  }
  return execFileSync('docker', args, {encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024});
}
function canonical() {
  return JSON.parse(docker(['inspect', ...['backend', 'frontend', 'inquiry', 'postgres'].map(service => 'sabalanerp-local-' + service + '-1')]))
    .map(row => ({id: row.Id, image: row.Image, startedAt: row.State.StartedAt}));
}
const before = canonical();
const containers = JSON.parse(docker(['inspect', ...services.map(service => 'sabalanerp-local-' + service + '-1')]));
for (let index = 0; index < containers.length; index++) {
  const row = containers[index];
  assert.equal(row.Config.Labels['com.docker.compose.project'], 'sabalanerp-local');
  assert.equal(row.Config.Labels['com.docker.compose.service'], services[index]);
  assert.equal(row.HostConfig.ReadonlyRootfs, true); assert.deepEqual(row.ExecIDs ?? [], []);
  assert.ok(['running', 'exited'].includes(row.State.Status));
  if (index > 0) assert.deepEqual(row.Mounts, []);
}
const proxy = containers[0];
const alreadyHeld = proxy.State.Status === 'exited' && proxy.State.ExitCode === 75;
assert.ok(proxy.State.Status === 'running' || alreadyHeld);
assert.ok(proxy.Config.Env.includes('RETAINED_UI_FIXTURE_ROOT=' + root));
assert.equal(proxy.Image, 'sha256:33cb69566bb1de4f8895e73486be364ccad1d60e978ba0a30f34c210ecf6f505');
const reader = alreadyHeld ? '7f4d8f79c29c6d80045ea490e8ddcab156416c072c286467cac1c6ce298ba5e2' : proxy.Id;
if (alreadyHeld) {
  const [passive] = JSON.parse(docker(['inspect', reader]));
  assert.equal(passive.Image, proxy.Image); assert.equal(passive.Config.Labels['com.docker.compose.project'], 'sabalanerp-local');
  assert.equal(passive.Config.Labels['com.docker.compose.service'], 'backend-candidate');
  assert.ok(passive.Config.Env.includes('BACKEND_RUNTIME_ROLE=candidate'));
}
const expectedConfiguration = proxy.Config.Env.find(value => value.startsWith('RETAINED_UI_CONFIGURATION_SHA256=')).split('=')[1];
const configuration = JSON.parse(docker(['exec', reader, 'node', '-e',
  "const fs=require('node:fs'),c=require('node:crypto'),p=process.argv[1],b=fs.readFileSync(p+'/configuration.json');if(c.createHash('sha256').update(b).digest('hex')!==process.argv[2])throw Error('changed configuration');const v=JSON.parse(b);console.log(JSON.stringify({format:v.format,images:[v.initialRegistry.builds[0].image,v.nextBuild.image]}));", root, expectedConfiguration]));
assert.equal(configuration.format, 'sabalan-private-retained-ui-acceptance/v1');
assert.equal(containers[1].Image, configuration.images[0]); assert.equal(containers[2].Image, configuration.images[1]);
let heldProof;
if (alreadyHeld) {
  const report = JSON.parse(fs.readFileSync(path.join(repository, 'reports/qa/retained-ui-overlap-' + operation + '.json')));
  assert.equal(report.operation, operation); assert.equal(report.privateRoot, root); assert.equal(report.productionAdmission, false);
  assert.equal(report.status, 'PASS_PRIVATE_OVERLAP_WITH_RETAINED_UNKNOWN');
  assert.equal(report.containers.length, 3); const accepted = new Map(report.containers.map(row => [row.id, row])); assert.equal(accepted.size, 3);
  for (const current of containers) {
    const original = accepted.get(current.Id); assert.ok(original); assert.equal(original.image, current.Image);
    if (current.Id !== proxy.Id) assert.equal(original.startedAt, current.State.StartedAt);
  }
  if (report.proxyRestartIncarnation) {
    assert.deepEqual(report.proxyRestartIncarnation, {id: proxy.Id, image: proxy.Image, startedAt: proxy.State.StartedAt});
  } else {
    // The first accepted run recorded initial births but intentionally restarted
    // this same proxy ID. Preserve that original evidence and explicitly bind
    // its terminal post-restart incarnation, rather than invent an initial-time
    // match. No later operation may use this one-off metadata exception.
    assert.equal(operation, '67d8b4abc2154ccaea5e88b55f7a0cb1');
    assert.equal(report.results.proxyRestartGeneration, 2);
    assert.ok(Date.parse(proxy.State.StartedAt) > Date.parse(accepted.get(proxy.Id).startedAt));
  }
  for (const name of ['tests/online-deployment/retained-ui-proxy.worker.mjs', 'tests/online-deployment/private-ui-startup.fixture.mjs',
    'tests/online-deployment/private-ui-management.fixture.mjs', 'deploy/scripts/browser-release-proxy.mjs',
    'deploy/scripts/browser-routing-store.mjs', 'deploy/scripts/browser-release-routing.mjs', 'deploy/scripts/browser-operation-journal.mjs']) {
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(repository, name))).digest('hex'), report.sources[name]);
  }
  const heldBytes = docker(['exec', reader, 'cat', root + '/transport-shutdown-held.json']);
  assert.equal(createHash('sha256').update(heldBytes).digest('hex'), report.results.heldTransport.sha256);
  const held = JSON.parse(heldBytes); assert.equal(held.status, 'HELD_NOT_DRAINED'); assert.equal(held.root, root);
  assert.equal(held.configurationSha256, expectedConfiguration);
  assert.equal(held.productionAdmission, false); assert.equal(held.pendingOperations.length, 1);
  const pending = held.pendingOperations[0]; assert.equal(pending.method, 'GET'); assert.equal(pending.image, containers[2].Image);
  assert.equal(containers[2].State.Status, 'exited'); assert.equal(containers[2].State.ExitCode, 0); assert.equal(containers[2].State.Pid, 0);
  assert.ok(Date.parse(pending.startedAt) > Date.parse(containers[2].State.FinishedAt));
  assert.ok(Date.parse(proxy.State.StartedAt) < Date.parse(pending.startedAt));
  assert.ok(Date.parse(proxy.State.FinishedAt) > Date.parse(pending.startedAt));
  assert.equal(pending.id, report.results.ambiguityRetained[0].id);
  docker(['exec', reader, 'node', '-e', "const fs=require('node:fs');if(fs.existsSync(process.argv[1]))throw Error('unknown intent was settled');", root + '/operations/' + pending.id + '.complete.json']);
  // Exercise the actual replacement binary: the held root must refuse startup
  // under native ownership before it can open an HTTP or management listener.
  docker(['start', proxy.Id]);
  let stopped;
  for (let attempt = 0; attempt < 40; attempt++) {
    [stopped] = JSON.parse(docker(['inspect', proxy.Id])); if (stopped.State.Status === 'exited') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(stopped.State.Status, 'exited'); assert.equal(stopped.State.ExitCode, 1); assert.equal(stopped.State.Pid, 0);
  assert.deepEqual(stopped.ExecIDs ?? [], []);
  const logs = docker(['logs', '--tail', '15', proxy.Id], true); assert.match(logs, /FIXTURE_HELD_TRANSPORT_REQUIRES_INSPECTION/);
  assert.equal(docker(['exec', reader, 'cat', root + '/transport-shutdown-held.json']), heldBytes);
  heldProof = {status: 'RETIRED_WITH_HELD_UNKNOWN', heldRecordSha256: report.results.heldTransport.sha256,
    preservedUnknown: pending.id, originalExitCode: 75, actualRestartRefusedExitCode: 1,
    initialProxyStartedAt: accepted.get(proxy.Id).startedAt, postRestartProxyStartedAt: proxy.State.StartedAt,
    heldProxyFinishedAt: proxy.State.FinishedAt, intentionalRestartGeneration: report.results.proxyRestartGeneration};
} else {
  const drained = JSON.parse(docker(['exec', proxy.Id, 'node', '-e',
  "const net=require('node:net');let b='';const s=net.connect(process.argv[1]);s.on('connect',()=>s.end('drain\\n'));s.on('data',v=>b+=v);s.on('end',()=>console.log(b));s.on('error',()=>process.exit(1));",
  root + '/management.sock']));
assert.deepEqual(drained, {ok: true, value: {drained: true}}, 'Uncertain work cannot be retired by this fixture');
}
const proof = {operation, privateRoot: root, canonical: before, productionAdmission: false, held: heldProof, containers: []};
for (const row of containers) {
  if (row.State.Status === 'running' && !(alreadyHeld && row.Id === proxy.Id)) docker(['stop', '--time', '-1', row.Id]);
  const [stopped] = JSON.parse(docker(['inspect', row.Id]));
  assert.equal(stopped.Id, row.Id); assert.equal(stopped.Image, row.Image);
  assert.equal(stopped.State.Status, 'exited'); assert.equal(stopped.State.ExitCode, alreadyHeld && row.Id === proxy.Id ? 1 : 0); assert.equal(stopped.State.Pid, 0);
  assert.deepEqual(stopped.ExecIDs ?? [], []);
  proof.containers.push({id: stopped.Id, image: stopped.Image, service: stopped.Config.Labels['com.docker.compose.service'],
    startedAt: stopped.State.StartedAt, finishedAt: stopped.State.FinishedAt, exitCode: stopped.State.ExitCode});
}
assert.deepEqual(canonical(), before);
fs.writeFileSync(path.join(repository, 'reports/qa/retained-ui-natural-retirement-' + operation + '.json'), JSON.stringify(proof, null, 2) + '\n', {flag: 'wx'});
for (const row of containers) {
  const [fresh] = JSON.parse(docker(['inspect', row.Id]));
  assert.equal(fresh.State.Status, 'exited'); assert.equal(fresh.State.Pid, 0); assert.equal(fresh.Image, row.Image);
  assert.deepEqual(fresh.ExecIDs ?? [], []); docker(['rm', row.Id]);
}
assert.deepEqual(canonical(), before); console.log(JSON.stringify({naturallyRetired: operation, containers: proof.containers}));
