import {snapshotArguments} from './lib/production-inquiry-snapshot.mjs';
/** Fixed read-only public-code inventory. Never read SQLite, .env or secrets. */
import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import{createHash,randomBytes}from'node:crypto';import{originalBackendBaseCommands}from'./lib/production-backend-base-process.mjs';
const repository=path.resolve(import.meta.dirname,'..'),sha=raw=>createHash('sha256').update(raw).digest('hex');
const args=process.argv.slice(2);assert.equal(args[0],'--observe');const snapshot=snapshotArguments(args,1);assert.ok(snapshot,'EXPLICIT_FRESH_SNAPSHOT_REQUIRED');
const nodeSource=String.raw`const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');const files=[];let total=0;
function stable(file){assert.equal(fs.realpathSync(file),file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const a=fs.fstatSync(fd,{bigint:true});assert(a.isFile()&&a.nlink===1n&&a.size<=128n*1024n**2n);const raw=fs.readFileSync(fd),b=fs.fstatSync(fd,{bigint:true}),c=fs.lstatSync(file,{bigint:true});for(const k of ['dev','ino','size','mtimeNs','ctimeNs','mode','nlink']){assert.equal(a[k],b[k]);assert.equal(a[k],c[k]);}return raw;}finally{fs.closeSync(fd);}}
function add(file){const raw=stable(file);total+=raw.length;assert(total<=256*1024**2&&files.length<20000);files.push({path:file.slice('/app/'.length),bytes:raw.length,sha256:hash(raw)});return raw;}
function walk(folder){const before=fs.lstatSync(folder,{bigint:true});assert(before.isDirectory()&&fs.realpathSync(folder)===folder);for(const name of fs.readdirSync(folder).sort()){const file=path.join(folder,name),st=fs.lstatSync(file);assert(!st.isSymbolicLink());if(st.isDirectory())walk(file);else{assert(st.isFile());add(file);}}const after=fs.lstatSync(folder,{bigint:true});for(const k of ['dev','ino','mtimeNs','ctimeNs'])assert.equal(before[k],after[k]);}
const candidates=['.next-build','.next'];const present=candidates.filter(name=>fs.existsSync('/app/'+name+'/BUILD_ID'));assert.equal(present.length,1);const root='/app/'+present[0];
walk(root+'/server');walk(root+'/static');for(const name of fs.readdirSync(root).sort())if(name==='BUILD_ID'||name.endsWith('.json'))add(root+'/'+name);
walk('/app/public');for(const name of ['next.config.js','browser-build-identity.cjs','package.json'])if(fs.existsSync('/app/'+name))add('/app/'+name);
files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
const buildId=stable(root+'/BUILD_ID').toString().trim(),actions=JSON.parse(stable(root+'/server/server-reference-manifest.json'));
const actionIds=[...new Set([...Object.keys(actions.node),...Object.keys(actions.edge)])].sort();
const assets=files.filter(f=>f.path.startsWith(present[0]+'/static/')).map(f=>({...f,path:'/_next/static/'+f.path.slice((present[0]+'/static/').length)}));
console.log(JSON.stringify({format:'sabalan-production-legacy-browser-bytes/v1',dist:present[0],buildId,nativeBuildRawBase64:stable(root+'/BUILD_ID').toString('base64'),actionManifestRawBase64:stable(root+'/server/server-reference-manifest.json').toString('base64'),requiredServerRawBase64:stable(root+'/required-server-files.json').toString('base64'),deploymentId:JSON.parse(stable(root+'/required-server-files.json')).config.deploymentId||null,files,assets,actionIds,bytes:total,inventorySha256:hash(JSON.stringify(files)),applicationStarted:false,databaseConnected:false}));`;
const operation=randomBytes(16).toString('hex');
const controller=String.raw`import json,subprocess,hashlib,base64,selectors,os,sys,signal
SOURCE=base64.b64decode('__SOURCE__');EXPECTED='__SHA__';assert hashlib.sha256(SOURCE).hexdigest()==EXPECTED
BASELINE=json.loads(base64.b64decode('__BASELINE__'));children=[];history=[];interrupted=False
def cancelled(*_):
 global interrupted
 interrupted=True
for n in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP):signal.signal(n,cancelled)
def run(argv,stdin=None):
 c=subprocess.Popen(argv,stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE);children.append(c)
 if stdin is not None:c.stdin.write(stdin);c.stdin.close()
 s=selectors.DefaultSelector();buffers={c.stdout:bytearray(),c.stderr:bytearray()};overflow=False
 for stream in buffers:s.register(stream,selectors.EVENT_READ)
 while s.get_map():
  for key,_ in s.select(0.2):
   raw=os.read(key.fd,65536)
   if not raw:s.unregister(key.fileobj);continue
   if len(buffers[key.fileobj])+len(raw)<=16*1024*1024:buffers[key.fileobj].extend(raw)
   else:overflow=True
 c.wait();s.close();out=bytes(buffers[c.stdout]);err=bytes(buffers[c.stderr]);history.append(dict(argv=argv,originalPid=c.pid,returncode=c.returncode,stdoutSha256=hashlib.sha256(out).hexdigest(),stderrSha256=hashlib.sha256(err).hexdigest()))
 assert c.returncode==0 and not overflow and not interrupted,(c.returncode,err[:1024]);return out
def ps():
 raw=run(['docker','compose','-f','/opt/sabalanerp/docker-compose.prod.yml','ps','--format','json']);v=json.loads(raw)if raw.lstrip().startswith(b'[')else[json.loads(row)for row in raw.splitlines()if row]
 assert len(v)==6 and len(set(x['Service']for x in v))==6 and all(x['Project']=='sabalanerp'and x['State']=='running'and x['Health']=='healthy'for x in v);return v
template='{"id":{{json .Id}},"image":{{json .Image}},"birth":{{json .State.StartedAt}},"health":{{json .State.Health.Status}},"service":{{json (index .Config.Labels "com.docker.compose.service")}}}'
def inspect():
 rows=ps();return sorted([json.loads(row)for row in run(['docker','inspect','--format',template,*[x['Name']for x in rows]]).decode().splitlines()],key=lambda x:x['service'])
report=dict(format='sabalan-production-frontend-code-observation/v1',readOnly=True,passResult=False,productionAdmission=False)
try:
 before=inspect();report['before']=before;target=next(x for x in before if x['service']=='frontend');assert target['image']==BASELINE['services']['frontend']['image']
 if BASELINE:
  assert run(['git','-C','/opt/sabalanerp','rev-parse','HEAD']).decode().strip()==BASELINE['deployedHead']
  for row in before:
   expected=BASELINE['services'][row['service']];assert(row['id'],row['image'],row['birth'])==(expected['id'],expected['image'],expected['startedAt'])
 ps();image=json.loads(run(['docker','image','inspect','--format','{"id":{{json .Id}},"rootfs":{{json .RootFS.Layers}}}',target['image']]))
 ps();assert not json.loads(run(['docker','inspect','--format','{{json .Mounts}}',target['id']]))
 ps();value=json.loads(run(['docker','exec','-i',target['id'],'node','-'],SOURCE));assert isinstance(value['buildId'],str) and value['buildId']
 if BASELINE:value['sourceSnapshot']=dict(format='sabalan-measured-frontend-source/v1',baselineSha256=BASELINE['sha256'],deployedHead=BASELINE['deployedHead'],engineImage=target['image'],containerId=target['id'],startedAt=target['birth'])
 after=inspect();assert before==after and all(c.poll()is not None for c in children)
 report.update(snapshotBaseline=BASELINE,passResult=True,frontend=dict(target,mounts=[]),image=image,value=value,after=after,allSixIdentitiesUnchanged=True,allOriginalChildrenClosed=True,originalCommands=history)
except BaseException as error:
 for c in children:c.wait()
 report.update(error=type(error).__name__+': '+str(error),allOriginalChildrenClosed=all(c.poll()is not None for c in children),originalCommands=history)
print(json.dumps(report));sys.exit(0 if report['passResult']else 1)
`.replace('__BASELINE__',Buffer.from(JSON.stringify(snapshot)).toString('base64')).replace('__SOURCE__',Buffer.from(nodeSource).toString('base64')).replace('__SHA__',sha(Buffer.from(nodeSource)));
const file=path.join('D:/sabalanerp-online-qa','production-frontend-code-'+operation+'-remote.py');fs.writeFileSync(file,controller,{flag:'wx',mode:0o600});
const owner=originalBackendBaseCommands();const child=await owner.run('ssh',['-i','C:/Users/mahan/.ssh/sabalan_codex_deploy_ed25519','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','root@94.182.85.254','python3 -I -B -'],{input:controller,maximum:16*1024*1024});
const closure=await owner.close();const output=path.join(repository,'reports/qa','production-frontend-code-'+operation+'.json');fs.writeFileSync(output,JSON.stringify({format:'sabalan-production-frontend-code-ssh/v1',remoteSourceFile:file,remoteSourceSha256:sha(Buffer.from(controller)),nodeSourceSha256:sha(Buffer.from(nodeSource)),originalSsh:child,originalClosure:closure},null,2)+'\n',{flag:'wx',mode:0o600});
let value;try{value=JSON.parse(child.stdout);}catch{}
process.stdout.write(JSON.stringify({reportFile:output,sshExitCode:child.code,passResult:value?.passResult,allOriginalChildrenClosed:closure.allOriginalChildrenClosed,allSixIdentitiesUnchanged:value?.allSixIdentitiesUnchanged,error:value?.error})+'\n');if(child.code!==0||!value?.passResult)process.exitCode=1;
