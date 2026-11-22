#!/usr/bin/env python3
"""Standalone content/FD test only; never a recovery-point producer."""
SPEC = None
import base64, copy, fcntl, hashlib, json, os, selectors, shutil, signal, subprocess, sys
from pathlib import Path
assert SPEC is not None and not sys.flags.optimize and os.getuid()==0
os.umask(0o077);children=[];history=[];interrupted=False
sha=lambda raw:hashlib.sha256(raw).hexdigest()
def cancelled(*_):
 global interrupted
 interrupted=True
for number in [signal.SIGINT,signal.SIGTERM,signal.SIGHUP]:signal.signal(number,cancelled)
def run(argv,expected=0,inherit=()):
 child=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=inherit);children.append(child)
 buffers={child.stdout:bytearray(),child.stderr:bytearray()};selector=selectors.DefaultSelector();overflow=False
 for stream in buffers:selector.register(stream,selectors.EVENT_READ)
 while selector.get_map():
  for item,_ in selector.select(0.2):
   raw=os.read(item.fd,65536)
   if not raw:selector.unregister(item.fileobj);continue
   if len(buffers[item.fileobj])+len(raw)<=4*1024*1024:buffers[item.fileobj].extend(raw)
   else:overflow=True
 child.wait();selector.close();out=bytes(buffers[child.stdout]);err=bytes(buffers[child.stderr])
 history.append(dict(argv=argv,originalPid=child.pid,returncode=child.returncode,stdoutSha256=sha(out),stderrSha256=sha(err),stderr=err.decode(errors='replace'),outputBoundExceeded=overflow))
 assert child.returncode==expected and not overflow and not interrupted,(child.returncode,err)
 return out
def write(file,raw,mode=0o400):
 fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
 try:
  with os.fdopen(fd,'wb',closefd=False)as stream:stream.write(raw);stream.flush();os.fsync(fd)
 finally:os.close(fd)
def foreign():
 ids=run(['/usr/bin/docker','ps','-aq','--no-trunc']).decode().splitlines();assert len(ids)<=128
 if not ids:return []
 template='{"id":{{json .Id}},"image":{{json .Image}},"startedAt":{{json .State.StartedAt}},"running":{{json .State.Running}},"health":{{if (index .State "Health")}}{{json .State.Health.Status}}{{else}}null{{end}}}'
 return sorted([json.loads(row)for row in run(['/usr/bin/docker','inspect','--format',template,*ids]).decode().splitlines()],key=lambda row:row['id'])
operation=SPEC['operation'];assert len(operation)==32 and all(c in'abcdef0123456789'for c in operation)
root=Path('/root/sabalan-recovery-private/host-crypto-content-'+operation);root.mkdir(mode=0o700)
report=dict(format='sabalan-original-host-crypto-content/v1',operation=operation,passResult=False,scope='CONTENT_ONLY_NO_CAPTURE',genuineCheckpointCreated=False,sqlConnected=False,runtimeStarted=False,productionAdmission=False)
try:
 before=foreign();report['foreignBefore']=before
 node=shutil.which('node');assert node and Path(node).is_absolute(),'EXISTING_HOST_NODE_REQUIRED'
 report['nodeVersion']=run([node,'--version']).decode().strip();report['nodeSha256']=sha(Path(node).resolve().read_bytes())
 code=root/'source'
 for relative,row in SPEC['files'].items():
  relative=Path(relative);assert not relative.is_absolute()and'..'not in relative.parts
  file=code/relative;file.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
  raw=base64.b64decode(row['base64'],validate=True);assert sha(raw)==row['sha256'];write(file,raw)
 keyroot=root/'keys';keyroot.mkdir(mode=0o700)
 keyscript="const f=require('fs'),c=require('crypto'),p=process.argv[1];const k=c.generateKeyPairSync('rsa',{modulusLength:2048});for(const[n,v]of[['local',c.randomBytes(48).toString('base64')],['public',k.publicKey.export({type:'spki',format:'pem'})]]){const fd=f.openSync(p+'/'+n,'wx',384);try{f.writeFileSync(fd,v);f.fsyncSync(fd);}finally{f.closeSync(fd);}}process.stdout.write('PRIVATE_QA_KEYS_CREATED')"
 assert run([node,'-e',keyscript,str(keyroot)])==b'PRIVATE_QA_KEYS_CREATED'
 mapping=root/'volume';mapping.mkdir(mode=0o700);point=mapping/'point';point.mkdir(mode=0o700)
 runtime='/qa-host/runtime';runtimepoint=runtime+'/point'
 roles=['physical-base','coherent-cut','coverage-manifest','inquiry-sqlite','coordination','wal-capture']+['versioned-file-cut']*9+['wal-segment']
 rows=[]
 for index,role in enumerate(roles):
  raw=('CONTENT ONLY '+operation+' '+str(index)).encode();file=point/('content-'+str(index));write(file,raw)
  rows.append(dict(role=role,name='content-'+str(index),path=runtimepoint+'/'+file.name,bytes=len(raw),sha256=sha(raw)))
 manifest=dict(format='sabalan-online-checkpoint-plaintext-components/v1',operation=operation*2,coverageSha256=next(r['sha256']for r in rows if r['role']=='coverage-manifest'),sourceCaptureSha256=next(r['sha256']for r in rows if r['role']=='coherent-cut'),sources=rows)
 manifestraw=json.dumps(manifest,sort_keys=True).encode();write(point/'plaintext-components.json',manifestraw)
 lock=root/'owner.lock';fd=os.open(lock,os.O_RDWR|os.O_CREAT|os.O_EXCL,0o600);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);os.dup2(fd,9,inheritable=True)
 config=dict(format='sabalan-original-host-checkpoint-crypto/v1',kind='point',mapping=dict(host=str(mapping),runtime=runtime),lockFile=str(lock),localKeyFile=str(keyroot/'local'),publicKeyFile=str(keyroot/'public'),applicationMountHosts=[str(mapping)],point=dict(componentManifestFile=runtimepoint+'/plaintext-components.json',componentManifestSha256=sha(manifestraw),operation=operation*2,outputRoot=runtimepoint+'/sealed-components'))
 configraw=json.dumps(config,sort_keys=True).encode();configuration=root/'configuration.json';write(configuration,configraw)
 command=[node,str(code/'deploy/scripts/online-checkpoint-host-crypto.cjs'),str(configuration),sha(configraw)]
 run(command,expected=1);assert not(point/'sealed-components').exists();report['missingFd9Refused']=True
 run(command[:-1]+['0'*64],expected=1,inherit=(9,));assert not(point/'sealed-components').exists();report['wrongShaRefused']=True
 result_raw=run(command,inherit=(9,));result=json.loads(result_raw);assert result['phase']=='SEALED_LOCAL'and len(result['objects'])==16
 assert result['manifestSha256']==sha(manifestraw)and result['productionAdmission']is False and result['healthyRecoveryPoint']is False and result['independentDecryptVerified']is False
 assert json.loads((point/'sealed-components/sealed.json').read_bytes())==result
 for row in result['objects']:
  assert row['localDecryptVerified']is True and row['cipherFile'].startswith(runtimepoint+'/sealed-components/')
  local=mapping/row['cipherFile'][len(runtime)+1:];raw=local.read_bytes();assert len(raw)==row['cipherBytes']and sha(raw)==row['cipherSha256']
 for relative,row in SPEC['files'].items():assert sha((code/relative).read_bytes())==row['sha256']
 assert (point/'plaintext-components.json').read_bytes()==manifestraw
 report['privateCryptoReadbackVerified']=True
 after=foreign();assert all(child.poll()is not None for child in children)
 # This executor never writes to Docker, SQL or any application. Unrelated
 # foreign health churn is observed, not turned into release/restore authority.
 report.update(passResult=True,objects=16,canonicalSourceSha256=SPEC['canonicalSourceSha256'],canonicalBundleSha256=SPEC['files']['deploy/scripts/online-release-host-crypto.cjs']['sha256'],resultSha256=sha(result_raw),foreignIdentitiesUnchangedObserved=before==after,foreignObservationOnly=True,foreignAfter=after,allOriginalChildrenClosed=True,originalCommands=history)
except BaseException as error:
 for child in children:child.wait()
 report.update(failure=type(error).__name__+': '+str(error),allOriginalChildrenClosed=all(child.poll()is not None for child in children),originalCommands=history)
finally:
 for child in children:child.wait()
 write(root/'receipt.json',(json.dumps(report,sort_keys=True)+'\n').encode());print(json.dumps(report));sys.exit(0 if report['passResult']else 1)
