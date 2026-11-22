// ONE-OFF retirement of the obsolete read-only local QA proxy from the failed
// 2026-10-17 overlap test. It is not a production recovery/retirement command.
// The old fixture cannot exit after retaining UNKNOWN. Preserve that UNKNOWN,
// prove its sole upstream was already naturally dead and its transport closed,
// then retire only this exact diagnostic process. No intent is settled/deleted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const operation = '8f417154f543d7ca2ff58268f457a7c7';
const root = '/app/online-runtime-acceptance/retained-ui-' + operation;
const proxy = 'd8265b41e3bc8de7fd0d7d44fea0d9ec8794e90793647818ca1ed7f3f1986471';
const previous = 'a41bdf63afeee43af48a8943a828538c593ce7bb9c3733d1442038951fc70ae5';
const failed = 'ea87f79d89c98a4106594820d89c8e2c0f10c15e8bcc9267430c937228e3dab2';
const repository = path.resolve(import.meta.dirname, '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function docker(args) {
  const rows = execFileSync('docker', ['compose', '-f', 'D:/sabalanerp/docker-compose.local.yml', 'ps', '--format', 'json'], {encoding: 'utf8'})
    .trim().split(/\r?\n/).flatMap(line => JSON.parse(line));
  for (const service of ['backend', 'frontend', 'inquiry', 'postgres']) assert.ok(rows.some(row => row.Project === 'sabalanerp-local'
    && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
  return execFileSync('docker', args, {encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024});
}
function canonical() {return JSON.parse(docker(['inspect', ...['backend','frontend','inquiry','postgres'].map(name => 'sabalanerp-local-' + name + '-1')]))
  .map(row => ({id: row.Id, image: row.Image, startedAt: row.State.StartedAt}));}
function inspect(id) {const [row] = JSON.parse(docker(['inspect', id])); assert.equal(row.Id, id); return row;}
function control(command) {
  const reply = JSON.parse(docker(['exec', proxy, 'node', '-e',
    "const n=require('node:net');let b='';const s=n.connect(process.argv[1]);s.on('connect',()=>s.end(process.argv[2]+'\\n'));s.on('data',v=>b+=v);s.on('end',()=>console.log(b));s.on('error',()=>process.exit(1));", root + '/management.sock', command]));
  return reply;
}
const baseline = canonical(), original = inspect(proxy), upstream = inspect(failed), old = inspect(previous);
for (const [row, service] of [[original,'frontend-online-proxy'],[upstream,'frontend-online-new'],[old,'frontend-online-old']]) {
  assert.equal(row.Config.Labels['com.docker.compose.project'], 'sabalanerp-local');
  assert.equal(row.Config.Labels['com.docker.compose.service'], service); assert.equal(row.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(row.ExecIDs ?? [], []);
}
assert.ok(original.Config.Env.includes('RETAINED_UI_FIXTURE_ROOT=' + root));
assert.equal(original.Image, 'sha256:33cb69566bb1de4f8895e73486be364ccad1d60e978ba0a30f34c210ecf6f505');
assert.equal(original.RestartCount, 0); assert.equal(original.State.Status, 'running');
assert.equal(upstream.Image, 'sha256:e4113e20e13bcd26c5d9593bc84dfc76875ed88267e762c333d07669f670c0e7');
assert.equal(upstream.State.Status, 'exited'); assert.equal(upstream.State.ExitCode, 0); assert.equal(upstream.State.Pid, 0);
assert.deepEqual(upstream.Mounts, []); assert.deepEqual(old.Mounts, []);
assert.equal(control('drain').error, 'BROWSER_PROXY_DRAIN_NOT_PROVEN');
const first = control('status'); assert.equal(first.ok, true);
assert.deepEqual(first.value.proxy, {accepting:false,active:0,unresolved:1,bodyBytes:0,generation:3});
assert.equal(first.value.pending.length, 1);
const pending = first.value.pending[0]; assert.equal(pending.method, 'GET'); assert.equal(pending.image, upstream.Image);
assert.equal(pending.buildId, 'erp_draft_handoff_20261017');
assert.ok(Date.parse(pending.startedAt) > Date.parse(upstream.State.FinishedAt), 'The only unresolved target was already naturally stopped before this request');
const initialPublication = first.value.publication.publicationSha256;
// Ask the OLD diagnostic implementation to close ingress normally first. It
// refuses to declare drain and keeps its management socket alive, as expected.
docker(['exec', proxy, 'node', '-e', "process.kill(1,'SIGTERM')"]);
const second = control('status'); assert.equal(second.ok, true);
assert.deepEqual(second.value.proxy, first.value.proxy); assert.deepEqual(second.value.pending, first.value.pending);
assert.equal(second.value.publication.publicationSha256, initialPublication);
const nativeSource = String.raw`
import os,json,stat
root='${root}'
assert os.readlink('/proc/1/exe').endswith('/node')
assert open('/proc/1/cmdline','rb').read()==b'node\0/fixture/tests/online-deployment/retained-ui-proxy.worker.mjs\0'
assert open('/proc/1/task/1/children').read().strip()==''
birth={'bootId':open('/proc/sys/kernel/random/boot_id').read().strip(),'pidNamespace':os.readlink('/proc/1/ns/pid'),'startTicks':open('/proc/1/stat').read().rsplit(')',1)[1].split()[19]}
sockets=set()
for name in os.listdir('/proc/1/fd'):
 try: value=os.readlink('/proc/1/fd/'+name)
 except FileNotFoundError: continue
 if value.startswith('socket:['): sockets.add(value[8:-1])
for table in ['/proc/1/net/tcp','/proc/1/net/tcp6']:
 for line in open(table).readlines()[1:]:
  fields=line.split()
  if fields[9] in sockets: raise AssertionError('diagnostic controller retains a TCP descriptor')
lock=root+'/publication.lock'; st=os.lstat(lock)
assert stat.S_ISREG(st.st_mode) and st.st_nlink==1 and st.st_size==0 and st.st_uid==0
owned=False
for name in os.listdir('/proc/1/fd'):
 try: item=os.stat('/proc/1/fd/'+name)
 except FileNotFoundError: continue
 if item.st_dev==st.st_dev and item.st_ino==st.st_ino:
  info=open('/proc/1/fdinfo/'+name).read()
  assert 'FLOCK  ADVISORY  WRITE' in info
  owned=True
assert owned
print(json.dumps({'birth':birth,'tcpDescriptors':0,'children':0,'retainedPublicationLock':{'device':str(st.st_dev),'inode':str(st.st_ino)}}))
`;
const native = JSON.parse(docker(['exec', proxy, 'python3', '-c', nativeSource]));
const held = {format:'sabalan-obsolete-private-ui-retirement/v1',operation,root,canonical:baseline,
  original:{id:proxy,image:original.Image,startedAt:original.State.StartedAt}, failedUpstream:{id:failed,image:upstream.Image,finishedAt:upstream.State.FinishedAt},
  native,pendingOperations:first.value.pending,publicationSha256:initialPublication,status:'HELD_NOT_DRAINED',productionAdmission:false};
const bytes = Buffer.from(JSON.stringify(held)+'\n');
docker(['exec', proxy, 'node', '-e',
  "const fs=require('node:fs'),p=process.argv[1],b=Buffer.from(process.argv[2],'base64');const f=fs.openSync(p+'/obsolete-proxy-retirement-held.json','wx',0o600);fs.writeFileSync(f,b);fs.fsyncSync(f);fs.closeSync(f);const d=fs.openSync(p,'r');fs.fsyncSync(d);fs.closeSync(d);",root,bytes.toString('base64')]);
const fresh = inspect(proxy);
assert.equal(fresh.State.Pid,original.State.Pid); assert.equal(fresh.State.StartedAt,original.State.StartedAt); assert.equal(fresh.RestartCount,0);
assert.deepEqual(fresh.ExecIDs ?? [],[]); assert.deepEqual(control('status').value.pending,first.value.pending);
assert.deepEqual(JSON.parse(docker(['exec',proxy,'python3','-c',nativeSource])),native);
// Only this obsolete QA controller is terminated. Its HTTP ingress and all
// native TCP/descent work are already absent; its unresolved record stays HELD.
// This is not a method for terminating production/native application work.
docker(['kill','--signal','KILL',proxy]);
const dead=inspect(proxy); assert.equal(dead.State.Status,'exited'); assert.equal(dead.State.ExitCode,137); assert.equal(dead.State.Pid,0);
assert.deepEqual(dead.ExecIDs ?? [],[]);
docker(['stop','--time','-1',previous]);
const previousDead=inspect(previous); assert.equal(previousDead.State.Status,'exited'); assert.equal(previousDead.State.ExitCode,0); assert.equal(previousDead.State.Pid,0);
assert.deepEqual(previousDead.ExecIDs ?? [],[]); assert.deepEqual(canonical(),baseline);
held.retirement={obsoleteControllerExitCode:137,previousRuntimeExitCode:0,heldRecordSha256:sha(bytes)};
fs.writeFileSync(path.join(repository,'reports/qa/obsolete-held-ui-retirement-'+operation+'.json'),JSON.stringify(held,null,2)+'\n',{flag:'wx'});
for(const id of [proxy,previous,failed]) {const row=inspect(id);assert.equal(row.State.Status,'exited');assert.equal(row.State.Pid,0);assert.deepEqual(row.ExecIDs??[],[]);docker(['rm',id]);}
assert.deepEqual(canonical(),baseline); console.log(JSON.stringify({retiredObsoletePrivateController:proxy,preservedUnknown:pending.id,productionAdmission:false}));
