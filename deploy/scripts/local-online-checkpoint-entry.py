#!/usr/bin/env python3
"""Original private namespace entry; no daemon/app authority is inherited by JSON."""
import base64,hashlib,json,os,re,stat,subprocess,sys,threading
from pathlib import Path
SOURCE_FILES=tuple('deploy/scripts/'+name for name in ('local-dev-frontend-suspension.py','local-online-checkpoint-entry.py','local-online-checkpoint-driver.py','local-online-checkpoint-owner.py','online-local-host-runtime.py','online-checkpoint-producer.py','continuous-online-wal-owner.py','capture-postgres-base.py','receive-postgres-wal.py','online-runtime-owner.py','capture-coherent-components.py','online-checkpoint-coverage.py','recovery-versioned-files.py','online-checkpoint-inventory.py','coherent-versioned-file-cuts.py','capture-coordination-history.py','native-versioned-file-sealer.py','recovery-file-generations.py','recovery-database-freeze.py','online-backend-boundary.py','online-inquiry-boundary.py','online-runtime-scope.py'))+('tests/online-deployment/local-online-checkpoint-controller.worker.cjs','scripts/lib/local-dev-frontend-suspension.mjs','scripts/run-local-dev-frontend-suspension.mjs')
QUALIFICATION_SHA='234265c34dfb5514f2cc8357f4c770d91576e6da387997eec91854f800feb918'
EXTRACTION_SHA='474dae1c2f13cbe81a8d3d28a8dcaae721d37bd7244790e99bff99dd37438487'
def require(v,code):
 if not v:raise RuntimeError('LOCAL_ONLINE_ENTRY_'+code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encode(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def read(file,maximum=64*1024*1024):
 fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);require(stat.S_ISREG(s.st_mode)and s.st_nlink==1 and 0<=s.st_size<=maximum,'SOURCE_FILE');raw=b''
  while len(raw)<s.st_size:
   part=os.read(fd,min(1024*1024,s.st_size-len(raw)));require(part,'SOURCE_SHORT_READ');raw+=part
  k=lambda x:(x.st_dev,x.st_ino,x.st_size,x.st_mtime_ns,x.st_ctime_ns,x.st_mode,x.st_uid,x.st_nlink)
  require(k(s)==k(os.fstat(fd))==k(Path(file).lstat()),'SOURCE_CHANGED');return raw
 finally:os.close(fd)
def main():
 require(os.getuid()==0 and sys.platform=='linux'and len(sys.argv)==1,'ORIGINAL_ENTRY_REQUIRED')
 try:os.fstat(9)
 except OSError as error:require(error.errno==9,'FD9_UNKNOWN')
 else:raise RuntimeError('LOCAL_ONLINE_ENTRY_FD9_ALREADY_OWNED')
 reserved=os.open('/dev/null',os.O_RDONLY|os.O_NOFOLLOW)
 if reserved!=9:os.dup2(reserved,9);os.close(reserved)
 placeholder=os.fstat(9);require(stat.S_ISCHR(placeholder.st_mode),'FD9_PLACEHOLDER_INVALID')
 raw=sys.stdin.buffer.readline(32*1024*1024+1);require(0<len(raw)<=32*1024*1024 and raw.endswith(b'\n'),'INITIAL_FRAME_BOUND');v=json.loads(raw)
 require(set(v)=={'format','operation','capturePlanData','sourceRoot','sourcePins','runtimeQualification','artifacts','sourceHostIdentity'}and v['format']=='sabalan-original-local-online-checkpoint-entry/v1'and re.fullmatch('[a-f0-9]{32}',v['operation']),'INITIAL_FRAME')
 require(set(v['sourcePins'])==set(SOURCE_FILES),'FIXED_SOURCE_SET');source=Path(v['sourceRoot']);require(str(source)=='/mnt/host/c/Users/mahan/.codex/worktrees/online-deployment/sabalanerp'and source.resolve(strict=True)==source,'FIXED_SOURCE_ROOT')
 sources={}
 for name,wanted in v['sourcePins'].items():
  require(re.fullmatch('[a-f0-9]{64}',wanted),'SOURCE_SHA');body=read(source/name,16*1024*1024);require(sha(body)==wanted,'SOURCE_PIN_CHANGED');sources[Path(name).name]=body
 require(Path(__file__).resolve(strict=True)==source/'deploy/scripts/local-online-checkpoint-entry.py','FIXED_ENTRY_SOURCE')
 q=v['runtimeQualification'];require(q['qualificationSha256']==QUALIFICATION_SHA and q['descriptor']['qualificationSha256']==QUALIFICATION_SHA,'RUNTIME_QUALIFICATION');native=Path(q['descriptor']['root']);require(re.fullmatch('/var/lib/sabalan-online-host-[a-f0-9]{32}',str(native)),'RUNTIME_ROOT')
 daemons=[]
 for p in Path('/proc').iterdir():
  if p.name.isdigit():
   try:
    if(p/'comm').read_text().strip()=='dockerd':daemons.append(p)
   except(FileNotFoundError,ProcessLookupError):pass
 require(len(daemons)==1,'ONE_ORIGINAL_DAEMON_REQUIRED');daemon=daemons[0];require(os.readlink(daemon/'exe')=='/usr/bin/dockerd','DAEMON_EXECUTABLE');birth=(daemon/'stat').read_text().rsplit(')',1)[1].split()[19];boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
 fds=[os.open(daemon/name,os.O_RDONLY|(os.O_DIRECTORY if name=='root'else 0))for name in('ns/mnt','ns/pid','root')];identities=[(os.fstat(f).st_dev,os.fstat(f).st_ino)for f in fds];host=Path('/proc/self/fd')/str(fds[2]);mapped=host/str(native)[1:]
 for file,wanted in [('qualification-r5.json',QUALIFICATION_SHA),('extraction-receipt.json',EXTRACTION_SHA)]:require(sha(read(mapped/file,16*1024*1024))==wanted,'ORIGINAL_RUNTIME_RECEIPT')
 extraction=json.loads(read(mapped/'extraction-receipt.json',16*1024*1024));expected=dict(extraction['inventory']['files'])
 for file,target in extraction['inventory']['links'].items():expected[file]=expected[os.path.normpath(target if target.startswith('/')else os.path.dirname(file)+'/'+target)]
 for file,row in expected.items():require(sha(read(mapped/'sysroot'/file[1:]))==row['sha256'],'RUNTIME_CLOSURE_BYTES')
 stage=mapped/('entry-'+v['operation']);stage.mkdir(mode=0o700)
 for name,body in sources.items():
  fd=os.open(stage/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
  with os.fdopen(fd,'wb')as s:s.write(body);s.flush();os.fsync(s.fileno())
 require({x['name']for x in v['artifacts']}=={'native-process-owner','qualification-public-key.pem'}and len(v['artifacts'])==2,'FIXED_ARTIFACT_SET')
 for item in v['artifacts']:
  body=base64.b64decode(item['rawBase64'],validate=True);require(sha(body)==item['sha256']and len(body)<=8*1024*1024,'ARTIFACT_BYTES')
  if item['name']=='qualification-public-key.pem':require(item['sha256']=='e61a06dfe5562a2375cb3051178ad9760857a7a01ea8b88f094a6e6123fdbc48','FIXED_QUALIFICATION_PUBLIC_KEY')
  else:require(body[:7]==bytes([127,69,76,70,2,1,1])and body[18:20]==b'\x3e\x00','STATIC_NATIVE_OWNER_REQUIRED')
  fd=os.open(stage/item['name'],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o500 if item['name']=='native-process-owner'else 0o400)
  with os.fdopen(fd,'wb')as s:s.write(body);s.flush();os.fsync(s.fileno())
 native_stage=native/('entry-'+v['operation']);v['originalEntry']={'sourceRootNative':str(native_stage),'pid':os.getpid(),'daemonPid':int(daemon.name),'daemonStartTicks':birth,'namespaceIdentities':identities,'kernelBootIdSha256':sha(boot.encode()),'reservedFd9':dict(device=placeholder.st_dev,inode=placeholder.st_ino,mode=placeholder.st_mode,rdev=placeholder.st_rdev)}
 libs=sorted({str(native/'sysroot'/str(Path(file[1:]).parent))for file in expected if not file.startswith('/usr/lib/python3.11/')});argv=['/usr/bin/nsenter','--mount=/proc/self/fd/'+str(fds[0]),'--pid=/proc/self/fd/'+str(fds[1]),'--root=/proc/self/fd/'+str(fds[2]),'--wdns=/',str(native/'sysroot/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2'),'--library-path',':'.join(libs),str(native/'sysroot/usr/bin/python3.11'),'-I','-B',str(native_stage/'local-online-checkpoint-driver.py')]
 child=subprocess.Popen(argv,stdin=subprocess.PIPE,stdout=sys.stdout.buffer,stderr=sys.stderr.buffer,pass_fds=tuple([9,*fds]));child.stdin.write(encode(v));child.stdin.flush();errors=[]
 def forward():
  try:
   while True:
    b=sys.stdin.buffer.read1(65536)
    if not b:break
    child.stdin.write(b);child.stdin.flush()
  except BaseException as e:errors.append(type(e).__name__)
  finally:child.stdin.close()
 pump=threading.Thread(target=forward);pump.start();status=child.wait();pump.join()
 require(birth==(daemon/'stat').read_text().rsplit(')',1)[1].split()[19]and identities==[(os.fstat(f).st_dev,os.fstat(f).st_ino)for f in fds],'ORIGINAL_NAMESPACE_CHANGED')
 for f in fds:os.close(f)
 require((placeholder.st_dev,placeholder.st_ino,placeholder.st_mode,placeholder.st_rdev)==(os.fstat(9).st_dev,os.fstat(9).st_ino,os.fstat(9).st_mode,os.fstat(9).st_rdev),'ORIGINAL_PLACEHOLDER_CHANGED');os.close(9)
 require(status==0 and not errors,'ORIGINAL_DRIVER_NOT_CLOSED')
if __name__=='__main__':main()
