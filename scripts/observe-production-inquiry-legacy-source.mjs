/** Fixed read-only public-code inventory. Never read SQLite, .env or secrets. */
import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import{createHash,randomBytes}from'node:crypto';import{originalBackendBaseCommands}from'./lib/production-backend-base-process.mjs';
const repository=path.resolve(import.meta.dirname,'..'),sha=raw=>createHash('sha256').update(raw).digest('hex');
assert.deepEqual(process.argv.slice(2),['--observe']);
const nodeSource=String.raw`const f=require('fs'),p=require('path'),c=require('crypto'),a=require('assert/strict');const sha=x=>c.createHash('sha256').update(x).digest('hex');
const root='/app',identity=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.mode,s.nlink].map(String).join(':');
function file(relative,max=268435456){const name=root+'/'+relative,b=f.lstatSync(name,{bigint:true});a.ok(b.isFile()&&b.nlink===1n&&b.size<=BigInt(max));const fd=f.openSync(name,f.constants.O_RDONLY|f.constants.O_NOFOLLOW|f.constants.O_NONBLOCK);const h=c.createHash('sha256'),buffer=Buffer.alloc(262144);let count=0;try{a.equal(identity(f.fstatSync(fd,{bigint:true})),identity(b));for(;;){const n=f.readSync(fd,buffer,0,buffer.length,null);if(!n)break;h.update(buffer.subarray(0,n));count+=n;}a.equal(identity(f.fstatSync(fd,{bigint:true})),identity(b));a.equal(identity(f.lstatSync(name,{bigint:true})),identity(b));}finally{f.closeSync(fd);}return{path:relative,bytes:count,sha256:h.digest('hex'),executable:Number(b.mode&73n)};}
function tree(start,exclude,maxFiles,maxBytes){const rows=[];let bytes=0;function visit(relative){if(exclude.includes(relative))return;const name=root+'/'+relative,s=f.lstatSync(name,{bigint:true});if(s.isSymbolicLink()){const target=f.readlinkSync(name);a.ok(f.realpathSync(name).startsWith(root+'/'));rows.push({path:relative,kind:'SYMLINK',target,sha256:sha(Buffer.from(target))});a.equal(identity(f.lstatSync(name,{bigint:true})),identity(s));return;}if(s.isDirectory()){const names=f.readdirSync(name).sort();a.ok(names.length<=50000);for(const child of names)visit(relative+'/'+child);a.deepEqual(f.readdirSync(name).sort(),names);a.equal(identity(f.lstatSync(name,{bigint:true})),identity(s));return;}const row=file(relative);bytes+=row.bytes;a.ok(rows.length<maxFiles&&bytes<=maxBytes);rows.push(row);}visit(start);rows.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);return{files:rows.length,bytes,sha256:sha(Buffer.from(JSON.stringify(rows))),entries:rows};}
const compiled=tree('.next',['.next/cache'],30000,1073741824);const publicFiles=f.existsSync('/app/public')?tree('public',[],10000,536870912):null;
const configFiles=['next.config.ts','next.config.js','next.config.mjs','package.json','package-lock.json'].filter(x=>f.existsSync(root+'/'+x)).map(x=>file(x));
const dependencies=tree('node_modules',['node_modules/.cache'],100000,2147483648);delete dependencies.entries;
const schemaFiles=['prisma/schema.prisma','node_modules/.prisma/client/schema.prisma'].filter(x=>f.existsSync(root+'/'+x)).map(x=>({...file(x,2097152),rawBase64:f.readFileSync(root+'/'+x).toString('base64')}));
const required=JSON.parse(f.readFileSync('/app/.next/required-server-files.json')),actions=JSON.parse(f.readFileSync('/app/.next/server/server-reference-manifest.json'));
const ids=[...new Set([...Object.keys(actions.node||{}),...Object.keys(actions.edge||{})])].sort();a.ok(ids.every(x=>/^(?:[a-f0-9]{40}|[a-f0-9]{42})$/.test(x)));
const packageValue=JSON.parse(f.readFileSync('/app/package.json'));const versions={node:process.version,next:JSON.parse(f.readFileSync('/app/node_modules/next/package.json')).version,prisma:JSON.parse(f.readFileSync('/app/node_modules/@prisma/client/package.json')).version};
process.stdout.write(JSON.stringify({format:'sabalan-production-inquiry-legacy-code/v1',frameworkBuildId:f.readFileSync('/app/.next/BUILD_ID','utf8').trim(),deploymentId:required.config.deploymentId||null,compiled,publicFiles,configFiles,dependencies,schemaFiles,actionIds:ids,versions,packageScripts:packageValue.scripts,knownBusinessSourceCommit:null}));`;
const operation=randomBytes(16).toString('hex');
const controller=String.raw`import json,subprocess,hashlib,base64,selectors,os,sys,signal
SOURCE=base64.b64decode('__SOURCE__');EXPECTED='__SHA__';assert hashlib.sha256(SOURCE).hexdigest()==EXPECTED
children=[];history=[];interrupted=False
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
report=dict(format='sabalan-production-inquiry-legacy-code-observation/v1',readOnly=True,passResult=False,productionAdmission=False)
try:
 before=inspect();report['before']=before;target=next(x for x in before if x['service']=='inquiry');assert target['image']=='sha256:ab6e2933e2d0d397f0b1a514dba69206e21856fa7d4275ab33383020bf9dd66e'
 ps();image=json.loads(run(['docker','image','inspect','--format','{"id":{{json .Id}},"rootfs":{{json .RootFS.Layers}}}',target['image']]))
 ps();value=json.loads(run(['docker','exec','-i',target['id'],'node','-'],SOURCE));assert value['frameworkBuildId']=='KQravWuGMIUURyrEIN-mE'
 after=inspect();assert before==after and all(c.poll()is not None for c in children)
 report.update(passResult=True,inquiry=target,image=image,value=value,after=after,allSixIdentitiesUnchanged=True,allOriginalChildrenClosed=True,originalCommands=history)
except BaseException as error:
 for c in children:c.wait()
 report.update(error=type(error).__name__+': '+str(error),allOriginalChildrenClosed=all(c.poll()is not None for c in children),originalCommands=history)
print(json.dumps(report));sys.exit(0 if report['passResult']else 1)
`.replace('__SOURCE__',Buffer.from(nodeSource).toString('base64')).replace('__SHA__',sha(Buffer.from(nodeSource)));
const file=path.join('D:/sabalanerp-online-qa','production-inquiry-legacy-code-'+operation+'-remote.py');fs.writeFileSync(file,controller,{flag:'wx',mode:0o600});
const owner=originalBackendBaseCommands();const child=await owner.run('ssh',['-i','C:/Users/mahan/.ssh/sabalan_codex_deploy_ed25519','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','root@94.182.85.254','python3 -I -B -'],{input:controller,maximum:16*1024*1024});
const closure=await owner.close();const output=path.join(repository,'reports/qa','production-inquiry-legacy-code-'+operation+'.json');fs.writeFileSync(output,JSON.stringify({format:'sabalan-production-inquiry-legacy-code-ssh/v1',remoteSourceFile:file,remoteSourceSha256:sha(Buffer.from(controller)),nodeSourceSha256:sha(Buffer.from(nodeSource)),originalSsh:child,originalClosure:closure},null,2)+'\n',{flag:'wx',mode:0o600});
let value;try{value=JSON.parse(child.stdout);}catch{}
process.stdout.write(JSON.stringify({reportFile:output,sshExitCode:child.code,passResult:value?.passResult,allOriginalChildrenClosed:closure.allOriginalChildrenClosed,allSixIdentitiesUnchanged:value?.allSixIdentitiesUnchanged,error:value?.error})+'\n');if(child.code!==0||!value?.passResult)process.exitCode=1;
