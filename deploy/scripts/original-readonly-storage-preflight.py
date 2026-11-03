"""SAME-Root finite no-delete two-host owner; no service/DB/image mutation.

The original production SSH retains FD9 while this owner runs the independent
backup canonical plan under FD9/10. Existing bounded original custody is reused.
"""
import contextlib,hashlib,json,os,pathlib,signal,stat,sys
REPO=pathlib.Path('C:/Users/mahan/.codex/worktrees/native-c3-execution-419/sabalanerp')
Q=pathlib.Path('D:/sabalanerp-online-qa')
PATHS={'custody':'deploy/scripts/original-image-owner-custody.py','backendSource':'deploy/scripts/original-c3-backend-stream-source.py','imageSource':'deploy/scripts/original-image-repository-source.py','readonlySource':'deploy/scripts/original-readonly-storage-source.py','sourceRemote':'deploy/scripts/original-readonly-storage-source-remote.py','sourceReadiness':'deploy/scripts/original-source-runtime-diagnostics.py','backupRemote':'deploy/scripts/original-readonly-storage-backup-remote.py','backupHost':'deploy/scripts/original-image-repository-remote.py','channel':'deploy/scripts/original-image-repository-channel.py','canonicalStorage':'deploy/scripts/storage-preflight.mjs','canonicalInventory':'scripts/deployment-storage.mjs'}


def read(ref,maximum=8*1024**2):
 p=pathlib.Path(ref['file']);a=p.lstat();assert p.resolve(strict=True)==p and stat.S_ISREG(a.st_mode) and a.st_nlink==1 and 0<a.st_size<=maximum
 raw=p.read_bytes();b=p.lstat();fields=lambda s:tuple(getattr(s,k) for k in ['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_mode','st_nlink'])
 assert fields(a)==fields(b) and hashlib.sha256(raw).hexdigest()==ref['sha256'];return raw


def execute(raw,file,name):
 scope=dict(__file__=str(file),__name__=name);exec(compile(raw,str(file),'exec'),scope);return scope


def save_raw(file,raw):
 fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_BINARY',0),0o600)
 try:
  offset=0
  while offset<len(raw):count=os.write(fd,raw[offset:]);assert count>0;offset+=count
  os.fsync(fd)
 finally:os.close(fd)
 return dict(file=str(file),sha256=hashlib.sha256(raw).hexdigest())


def emit(value):
 raw=(json.dumps(value,separators=(',',':'))+'\n').encode();assert len(raw)<=65536
 assert sys.stdout.buffer.write(raw)==len(raw);sys.stdout.buffer.flush()


def source_frame(child,audit,name):
 raw=child.stdout.readline(2*1024**2+1);assert raw.endswith(b'\n') and len(raw)<=2*1024**2
 return json.loads(raw),save_raw(audit/name,raw)



@contextlib.contextmanager
def retained_backup_executable(file,expected_sha256):
 # Windows path stat synthesizes executable permission bits and ctime differs
 # from fstat's creation time. Bind shared file identity across the two views,
 # then preserve EVERY field independently in its original view through work.
 file=pathlib.Path(file);named=file.lstat()
 assert file.resolve(strict=True)==file and stat.S_ISREG(named.st_mode) and named.st_nlink==1
 exact=lambda st:tuple(getattr(st,k) for k in ['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_mode','st_nlink'])
 shared=lambda st:tuple(getattr(st,k) for k in ['st_dev','st_ino','st_size','st_mtime_ns','st_nlink'])+(stat.S_IFMT(st.st_mode),)
 with file.open('rb') as descriptor:
  opened=os.fstat(descriptor.fileno());assert shared(named)==shared(opened),'BACKUP_EXECUTABLE_IDENTITY_MISMATCH'
  assert hashlib.file_digest(descriptor,'sha256').hexdigest()==expected_sha256,'BACKUP_EXECUTABLE_SHA_MISMATCH'
  assert exact(named)==exact(file.lstat()) and exact(opened)==exact(os.fstat(descriptor.fileno()))
  try:yield
  finally:
   assert exact(named)==exact(file.lstat()) and exact(opened)==exact(os.fstat(descriptor.fileno())),'BACKUP_EXECUTABLE_CHANGED_DURING_WORK'


def main(reference):
 assert os.name=='nt' and not sys.flags.optimize
 config=json.loads(read(reference));assert set(config)=={'format','operation','rootOperation','parent','sources','runtime','admission','auditDirectory','capacity','productionAdmission'}
 assert config['format']=='sabalan-readonly-storage-preflight-input/v1' and config['productionAdmission'] is False
 operation=config['operation'];import re;assert re.fullmatch('[a-f0-9]{32}',operation)
 audit=pathlib.Path(config['auditDirectory']);assert audit==Q/('419-readonly-storage-'+operation) and audit.resolve(strict=True)==audit and not any(audit.iterdir())
 assert set(config['sources'])==set(PATHS)
 raw={};modules={}
 for name,file in PATHS.items():
  ref=config['sources'][name];assert pathlib.Path(ref['file'])==REPO/file;raw[name]=read(ref)
 for name in ['custody','backendSource','imageSource','readonlySource']:
  modules[name]=execute(raw[name],config['sources'][name]['file'],'readonly_storage_'+name)
 parent=modules['custody']['ParentCustody'](config['parent']);assert pathlib.Path(config['parent']['lockFile'])==Q/'deployment.lock'
 cancelled=[];handlers={};password=None;owner=None;source_result=None;backup_result=None;source_row=None;backup_row=None;failure=None;remote_started=False;known=True
 def cancel(number,_frame):
  if number not in cancelled:cancelled.append(number)
 def current():
  parent.assert_current();assert not cancelled
  if owner is not None:assert not owner.interrupted
 try:
  for number in [signal.SIGINT,signal.SIGTERM]:handlers[number]=signal.signal(number,cancel)
  current();emit(dict(format='sabalan-r9-master-private-credential-ready/v1',operation=operation,credentialsRead=False,productionAdmission=False))
  credential_raw=bytearray(sys.stdin.buffer.readline(16385));assert credential_raw.endswith(b'\n') and len(credential_raw)<=16384
  credential=json.loads(credential_raw);credential_raw[:]=b'\0'*len(credential_raw)
  assert set(credential)=={'format','operation','credential'} and credential['format']=='sabalan-r9-master-private-credential/v1' and credential['operation']==operation
  password=credential.pop('credential');assert isinstance(password,str) and 0<len(password)<256 and not any(char in password for char in '\r\n\0')
  source=modules['backendSource'];builder=modules['readonlySource'];spec=json.loads(read(config['runtime']))
  admission=execute(read(config['admission']),config['admission']['file'],'readonly_current_admission');admission['validate_spec'](spec)
  canonical={'deploy/scripts/storage-preflight.mjs':raw['canonicalStorage'],'scripts/deployment-storage.mjs':raw['canonicalInventory']}
  fragments=dict(source=raw['sourceRemote'],backup=raw['backupRemote'],backupHost=raw['backupHost'],channel=raw['channel'])
  capacity=config['capacity'];assert capacity['purpose'] in ['COMPLETE_FULL','IMAGE_STAGING'] and capacity['rootOperation']==config['rootOperation']
  material=builder['build'](spec,operation,source,canonical,fragments,capacity,raw['readonlySource'],modules['imageSource'],raw['sourceReadiness'])
  core=execute(builder['original_windows_owner'](source),audit/'same-original.py','readonly_original');owner=core['SourceStreamOwner'](audit)
  original_run=owner.run_original
  def guarded_run(*args,**kwargs):
   current()
   try:return original_run(*args,**kwargs)
   finally:parent.assert_current()
  owner.run_original=guarded_run
  r7=source['captured_sources'](source['REVIEW'],source['REVIEW_SHA']);template=r7['windows-owner.template.py'].decode();helpers=execute(template[:template.index('def main():')],source['REVIEW']/'windows-owner.template.py','readonly_existing_ssh_helpers')
  profile_file=Q/'fixed-production-openssh-profile-20261020.json';profile=json.loads(source['pinned'](profile_file,'71c591618aff78625652a341d3798bc231e9617f0c626c55c12c9a93a453e298'))
  assert profile['host']=='94.182.85.254' and profile['user']=='root'
  custody_file=Q/'C30-postcheckpoint-terminal-context-source-r2-current-original-pins-20261024/custody.py';custody=execute(source['pinned'](custody_file,'a6ab3ec32561ef0865100485ff5a1ab566a5225c95a5831382a305cd8080f2d1'),custody_file,'readonly_fixed_ssh_custody')
  for name,digest in [('sshExecutable','sshExecutableSha256'),('privateKeyPath','privateKeySha256'),('knownHostsPath','knownHostsSha256')]:custody['pin'](profile[name],profile[digest],installed_ssh=name=='sshExecutable')
  ssh_file=Q/'C30-production-control-image-import-source-r4-exact-six-service-census-20261024/owner.py';ssh=execute(source['pinned'](ssh_file,'62236fe988dff14e21fa62016fea000e9830599771acfaf7d9e01f26b5c6db04'),ssh_file,'readonly_existing_signature')
  env=dict(os.environ);env['PSModulePath']='C:/Windows/System32/WindowsPowerShell/v1.0/Modules'
  signature=owner.run_original(['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','-NoProfile','-NonInteractive','-Command',ssh['SIGNATURE_COMMAND']],'nativeSshSignature',maximum_stdout=2*1024**2,env=env)
  assert signature['stderrBytes']==0 and json.loads(read(signature['stdout']))=={'Status':'Valid','Subject':'CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond, S=Washington, C=US','Thumbprint':'AD714D3C4B2B794A95441375C954130E9109EF4C'}
  credential_file=Q/'C30-strict-complete-actual-plan-source-r9-full-capsule-observer-20261025/backup_credential.py';backup_helper=execute(source['pinned'](credential_file,'2d7114304b5b31647a91b4d6fdfaa281de6e4d3ddcfbec4be962ecd2f85b321d'),credential_file,'readonly_backup_credential')
  def bootstrap(program):
   import shlex
   return 'python3 -I -B -c '+shlex.quote("import hashlib,sys;r=sys.stdin.buffer.read("+str(len(program))+");assert len(r)=="+str(len(program))+" and hashlib.sha256(r).hexdigest()=="+repr(hashlib.sha256(program).hexdigest())+";exec(compile(r,'same-original-readonly-storage','exec'),{'__name__':'__main__'})")
  with backup_helper['private_backup_password'](owner,password) as password_file:
   def source_exchange(child):
    nonlocal source_result,backup_result,backup_row
    assert child.stdin.write(material['source'])==len(material['source']);child.stdin.flush()
    ready,ready_ref=source_frame(child,audit,'source-held.raw')
    if ready['format']=='sabalan-source-readonly-storage-closed/v1':source_result=ready;return dict(sourceHeld=None,sourceClosed=ready_ref,backup=None)
    assert ready['format']=='sabalan-source-readonly-storage-held/v1' and ready['operation']==operation and ready['runtimeSpecSha256']==config['runtime']['sha256'] and ready['sourceLockHeld'] is True
    backup_capacity={**capacity,'backupCanonicalReserveBytes':ready['backupCanonicalReserveBytes']}
    backup_material=builder['build'](spec,operation,source,canonical,fragments,backup_capacity,raw['readonlySource'],modules['imageSource'],raw['sourceReadiness'])
    assert backup_material['source']==material['source']
    current();argv=backup_helper['plink_argv'](password_file,bootstrap(backup_material['backup']))
    with retained_backup_executable(argv[0],backup_helper['profile']()['plinkExecutableSha256']):
     current()
     backup_row=owner.run_original(argv,'backupPreflight',secret_input=backup_material['backup'],redact_password=password.encode(),maximum_stdout=2*1024**2)
    assert backup_row['stderrBytes']==0;backup_result=json.loads(read(backup_row['stdout'],2*1024**2))
    assert backup_result['format']=='sabalan-backup-readonly-storage-closed/v1' and backup_result['operation']==operation and backup_result['allOriginalChildrenClosed'] is True
    ack=dict(format='sabalan-readonly-storage-backup-ack/v1',operation=operation,backupSucceeded=backup_result['preflightSucceeded'],backupOriginalClosed=True,backupResultSha256=backup_row['stdout']['sha256'])
    frame=(json.dumps(ack,separators=(',',':'))+'\n').encode();assert child.stdin.write(frame)==len(frame);child.stdin.flush();child.stdin.close();child.stdin=None
    source_result,closed_ref=source_frame(child,audit,'source-closed.raw')
    assert source_result['format']=='sabalan-source-readonly-storage-closed/v1' and source_result['operation']==operation and source_result['runtimeSpecSha256']==config['runtime']['sha256']
    return dict(sourceHeld=ready_ref,sourceClosed=closed_ref,backup=backup_row['stdout'])
   current();remote_started=True;known=False
   source_row=helpers['pinned_ssh'](owner,custody,profile,[*helpers['ssh_argv'](profile),bootstrap(material['source'])],'sourcePreflight',interactive=source_exchange,maximum_stdout=2*1024**2)
   assert source_row['stdoutBytes']==0 and source_row['stderrBytes']==0
   known=True;current()
 except BaseException as error:failure=type(error).__name__
 finally:
  if owner is not None:
   owner.close()
   rows=[]
   for ref in owner.children:
    try:rows.append(json.loads(read(ref)))
    except BaseException:known=False
   if any(row.get('format')!='sabalan-secret-stdin-original-closure/v1' or row.get('code')!=0 or row.get('signal') is not None or row.get('stdoutEof') is not True or row.get('stderrEof') is not True or row.get('localInterrupted') is not False or row.get('observationFaultTotal')!=0 for row in rows):known=False
  if cancelled:known=False
  password=None
  for number,handler in handlers.items():signal.signal(number,handler)
  parent.close()
 succeeded=failure is None and known and source_result is not None and backup_result is not None and source_result['preflightSucceeded'] is True and backup_result['preflightSucceeded'] is True
 result=dict(format='sabalan-readonly-storage-preflight-owner/v1',operation=operation,rootOperation=config['rootOperation'],runtimeSpecSha256=config['runtime']['sha256'],source=source_result,backup=backup_result,sourceOriginal=source_row,backupOriginal=backup_row,originalClosures=[] if owner is None else owner.children,remoteActorsStarted=remote_started,originalCustodyKnown=known,preflightSucceeded=succeeded,deletionApplied=False,storagePolicyChanged=False,failureType=failure,productionAdmission=False)
 result_ref=save_raw(audit/'owner-result.json',(json.dumps(result,separators=(',',':'))+'\n').encode())
 emit(dict(format='sabalan-readonly-storage-preflight-owner-result/v1',operation=operation,**result_ref,preflightSucceeded=succeeded,outerOriginalClosurePending=True,productionAdmission=False));return 0


if __name__=='__main__':
 assert len(sys.argv)==3
 sys.exit(main(dict(file=str(pathlib.Path(sys.argv[1])),sha256=sys.argv[2])))
