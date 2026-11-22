#!/usr/bin/env python3
"""Original container controller. No private signing key enters this namespace.
Every native/verifier/SQL subprocess is retained from birth; uncertainty holds
this SAME controller. No status file can recreate original ownership.
"""
import base64, hashlib, json, os, pathlib, re, signal, stat, subprocess, sys, time
ROOT=pathlib.Path('/app/scripts')
PUBLIC='/run/sabalan-online/release-controller-public-key.pem'
VERIFY="const fs=require('fs'),c=require('crypto');let b=[];process.stdin.on('data',x=>b.push(x));process.stdin.on('end',()=>{const v=JSON.parse(Buffer.concat(b));const k=c.createPublicKey(fs.readFileSync(process.argv[1]));process.exit(k.asymmetricKeyType==='ed25519'&&c.verify(null,Buffer.from(v.message,'base64'),k,Buffer.from(v.signature,'base64'))?0:1)});"
children=[]; actor=None; native_start=None; sequence=0

def require(v):
 if not v: raise RuntimeError('ONLINE_ORIGINAL_INNER_UNPROVEN')
def encode(v): return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def emit(event,**fields): print(json.dumps(dict(event=event,**fields),separators=(',',':')),flush=True)
def read(file):
 fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  before=os.fstat(fd);require(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and before.st_size<=8388608)
  raw=os.read(fd,before.st_size+1);after=os.fstat(fd);require(before==after and len(raw)==before.st_size)
  return json.loads(raw)
 finally: os.close(fd)
def original(argv,**kwargs):
 child=subprocess.Popen(argv,**kwargs);children.append(child);return child

def receive():
 global sequence
 raw=sys.stdin.buffer.readline(67108865);require(raw and raw.endswith(b'\n') and len(raw)<=67108864)
 envelope=json.loads(raw);require(set(envelope)=={'decision','signature'})
 value=envelope['decision'];require(set(value)=={'format','session','scopeSha256','sequence','command','input'})
 require(value['format']=='sabalan-online-original-control/v1' and value['session']==session and value['scopeSha256']==scope_sha and value['sequence']==sequence+1)
 verify=original(['/usr/local/bin/node','-e',VERIFY,PUBLIC],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 payload=encode(dict(message=base64.b64encode(b'sabalan-online-original-control/v1\n'+encode(value)).decode(),signature=envelope['signature']))
 output,error=verify.communicate(payload);require(verify.returncode==0 and not output and len(error)<=65536)
 sequence+=1;return value

def query_quiet(native):
 source=os.environ.get('DATABASE_URL');require(source)
 sql="SELECT json_build_object('visible',(rolsuper OR pg_has_role(current_user,'pg_read_all_stats','MEMBER')),'system',(SELECT system_identifier::text FROM pg_control_system()),'database',current_database(),'oid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),'sessions',(SELECT count(*) FROM pg_stat_activity WHERE application_name='"+native['namespace']+"'),'prepared',(SELECT count(*) FROM pg_prepared_xacts WHERE database=current_database())) FROM pg_roles WHERE rolname=current_user"
 require(native['namespace'].startswith('sabalan-rt-') and len(native['namespace'])==59 and all(c in '0123456789abcdef' for c in native['namespace'][11:]))
 child=original(['/usr/bin/psql',source,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 out,err=child.communicate();require(child.returncode==0 and len(out)<=65536 and len(err)<=65536)
 row=json.loads(out);require(row['visible'] and row['system']==native['clusterIdentifier'] and row['oid']==str(native['initialDatabase']['oid']) and row['database']==native['initialDatabase']['name'] and row['sessions']==row['prepared']==0)
 return row

try:
 require(sys.platform=='linux' and len(sys.argv)==4 and stat.S_ISFIFO(os.fstat(0).st_mode))
 file,scope_sha,session=sys.argv[1:];require(len(scope_sha)==len(session)==64 and all(c in '0123456789abcdef' for c in scope_sha+session))
 require(hashlib.sha256(pathlib.Path(file).read_bytes()).hexdigest()==scope_sha)
 scope=read(file);require(scope['format']=='sabalan-online-runtime-scope/v2')
 os.environ.update(BACKEND_ONLINE_SCOPE_FILE=file,BACKEND_ONLINE_SCOPE_SHA256=scope_sha,BACKEND_RUNTIME_ROLE=scope['role'],RECOVERY_COORDINATION_DIR=scope['coordinationDirectory'])
 require(not any(k.startswith(('LD_','PYTHON','NODE_PRELOAD','BACKEND_CONTROL_','BACKEND_NATIVE_')) for k in os.environ))
 require(not os.environ.get('NODE_OPTIONS') and not os.environ.get('NODE_PATH'))
 request=receive();require(request['command']=='START' and set(request['input'])=={'databaseUrl','startupDecision','protectedBootstrap','evidenceFiles'})
 os.environ['DATABASE_URL']=request['input']['databaseUrl']
 acceptance=pathlib.Path(scope['nativeDirectory'])/'release-acceptance';require(acceptance.resolve()==acceptance)
 acceptance.mkdir(mode=0o700,exist_ok=False)
 files=request['input']['evidenceFiles'];require(isinstance(files,list) and 1<=len(files)<=512)
 names=set();total=0
 for descriptor in files:
  require(set(descriptor)=={'file','sha256','rawBase64'} and re.fullmatch(r'[a-z0-9][a-z0-9_.-]{0,95}',descriptor['file']) and descriptor['file'] not in names)
  names.add(descriptor['file']);payload=base64.b64decode(descriptor['rawBase64'],validate=True);total+=len(payload)
  require(0<len(payload)<=8388608 and total<=50331648 and hashlib.sha256(payload).hexdigest()==descriptor['sha256'])
  fd=os.open(acceptance/descriptor['file'],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
  try:
   offset=0
   while offset<len(payload):
    count=os.write(fd,payload[offset:]);require(count>0);offset+=count
   os.fsync(fd)
  finally:os.close(fd)
 for name,value in [('startup-decision.json',request['input']['startupDecision']),('protected-bootstrap.json',request['input']['protectedBootstrap'])]:
  if value is not None:
   fd=os.open(acceptance/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
   try:
    payload=encode(value);offset=0
    while offset<len(payload):
     written=os.write(fd,payload[offset:]);require(written>0);offset+=written
    os.fsync(fd)
   finally:os.close(fd)
 directory_fd=os.open(acceptance,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(directory_fd)
 finally:os.close(directory_fd)
 native_file=pathlib.Path(scope['nativeDirectory'])/'deployment-runtime-native.json'
 require(not native_file.exists())
 actor=original(['/usr/bin/python3','-I','-B',str(ROOT/'online-runtime-owner.py'),'/usr/local/bin/node',str(ROOT/'online-release-runtime.mjs')],stdin=subprocess.PIPE,stdout=sys.stderr,stderr=sys.stderr,env=dict(os.environ))
 # Runtime stdout is forwarded on stderr; authoritative runtime commands are
 # independently acknowledged through the original anonymous reply pipe.
 while not native_file.exists():require(actor.poll() is None);time.sleep(.01)
 native_start=read(native_file);require(native_start['phase']=='ACTIVE' and native_start['guardian']['pid']==actor.pid and native_start['onlineScope']['sha256']==scope_sha)
 emit('ACTOR_STARTED',originalPid=actor.pid,guardian=native_start['guardian'],native=native_start)
 while True:
  request=receive();command=request['command'];require(request['input']=={})
  if command in ('PREPARE_DRAIN','SHUTDOWN','ACTIVATE_BOOTSTRAP'):
   require(actor.poll() is None);actor.stdin.write(encode(dict(sequence=sequence-1,command=command))+b'\n');actor.stdin.flush();emit('COMMAND_SENT',command=command)
  elif command=='WAIT_CLOSED':
   actor.wait();native=read(native_file)
   require(native['phase']=='QUIESCENT' and native['nativeReaped'] and native['databaseQuiet'] and native['guardian']==native_start['guardian'] and native['onlineScope']['sha256']==scope_sha)
   work=read(pathlib.Path(scope['boundaryDirectory'])/'state.json');require(work['phase']=='QUIESCENT')
   sql=query_quiet(native);require(all(child.poll() is not None for child in children))
   emit('CLOSED',originalReturncode=actor.returncode,native=native,work=work,sql=sql,allOriginalChildrenClosed=True);break
  else:raise RuntimeError('FIXED_COMMAND_REQUIRED')
except BaseException:
 emit('HELD',originalPid=actor.pid if actor else None)
 while True:time.sleep(1)
