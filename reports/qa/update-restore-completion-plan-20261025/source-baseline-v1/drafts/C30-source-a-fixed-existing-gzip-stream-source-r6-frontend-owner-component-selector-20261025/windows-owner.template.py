"""One finite source-A stream phase. No main accepts caller commands or keys."""
import pathlib,json,hashlib,os,runpy,sys,stat
BOUND=None
HERE=pathlib.Path(__file__).resolve().parent
def sha(raw):return hashlib.sha256(raw).hexdigest()
def read(ref,maximum=16*1024**2):
 p=pathlib.Path(ref['file']);a=p.lstat();assert p.resolve(strict=True)==p and stat.S_ISREG(a.st_mode)and a.st_nlink==1 and 0<a.st_size<=maximum
 raw=p.read_bytes();b=p.lstat();fields=lambda s:tuple(getattr(s,k)for k in ['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_nlink']);assert fields(a)==fields(b)and sha(raw)==ref['sha256'];return raw
def input_pin(s):return tuple(getattr(s,k)for k in ['st_ino','st_size','st_mtime_ns','st_mode','st_nlink'])
def same_api_pin(s):return tuple(getattr(s,k)for k in ['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_mode','st_nlink'])
def module(ref,name):
 scope={'__file__':ref['file'],'__name__':name};exec(compile(read(ref),ref['file'],'exec'),scope);return scope
def ssh_argv(profile):
 return [profile['sshExecutable'],'-T','-F','NUL','-p','22','-i',profile['privateKeyPath'],'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','IdentityAgent=none','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+profile['knownHostsPath'],'-o','GlobalKnownHostsFile=none','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','root@'+profile['host']]
def pinned_ssh(owner,custody,profile,argv,phase,**kwargs):
 fd=os.open(profile['sshExecutable'],os.O_RDONLY|getattr(os,'O_BINARY',0));before=os.fstat(fd);named=pathlib.Path(profile['sshExecutable']).stat()
 try:
  assert custody['same_stat'](before,named,cross_windows=True)
  try:row=owner.run_original(argv,phase,**kwargs)
  finally:assert custody['same_stat'](before,os.fstat(fd))and custody['same_stat'](named,pathlib.Path(profile['sshExecutable']).stat())
  row['installedSshHeldAcrossSameOriginal']=True;return row
 finally:os.close(fd)
def check_input(ref):
 p=pathlib.Path(ref['file']);named=p.lstat();assert p.resolve(strict=True)==p and stat.S_ISREG(named.st_mode)and named.st_nlink==1 and named.st_size==ref['bytes']and 0<named.st_size<=2**31
 fd=os.open(p,os.O_RDONLY|getattr(os,'O_BINARY',0));stream=os.fdopen(fd,'rb',buffering=0)
 try:
  held=os.fstat(fd);assert input_pin(named)==input_pin(held)
  # Actual Windows named/descriptor dev+ctime have separate API domains.
  # Each remains exact before/after; all portable fields including mode match.
  if os.name!='nt':assert same_api_pin(named)==same_api_pin(held)
  h=hashlib.sha256()
  while raw:=stream.read(262144):h.update(raw)
  assert h.hexdigest()==ref['sha256']and same_api_pin(held)==same_api_pin(os.fstat(fd))and same_api_pin(named)==same_api_pin(p.lstat());stream.seek(0)
  return p,stream,named,held
 except BaseException:stream.close();raise
def select_local_cipher(b):
 previous=json.loads(read(b['encryptionPhase']))
 if previous.get('format')=='sabalan-source-a-closed-native-existing-gzip-encryption-component/v1':
  cipher=module(b['sourceFiles']['frontend-cipher-component.py'],'fixed_closed_frontend_cipher')['authenticate'](b['encryptionPhase'],b['service'],b['component'])
 else:
  assert previous['format']=='sabalan-source-a-original-closed-stream-phase/v1'and previous['phase']=='encrypt-existing'and previous['allOriginalChildrenClosed']is True
  cipher=previous['streamOutput']
 assert cipher==b['cipherInput'];return cipher

def main():
 assert BOUND is not None,'UNBOUND_SOURCE_A_STREAM_OWNER'
 b=BOUND;assert b['phase']in ['encrypt-existing','local-decrypt']and b['productionAdmission']is False
 component=module(b['sourceFiles']['components.py'],'fixed_two_components')['select'](b['service']);assert component==b['component']
 for ref in b['sourceFiles'].values():read(ref)
 read(b['producerReview']);ad=module(b['admission'],'fixed_admission');spec=json.loads(read(b['runtimeSpec']));ad['validate_spec'](spec)
 preflight=module(b['preflightValidator'],'fixed_source_a_preflight');preflight['validate'](b['preflight'])
 profile=json.loads(read(b['profile']));assert profile['format']=='sabalan-fixed-production-original-ssh/v1'and profile['host']=='94.182.85.254'and profile['user']=='root'
 custody=module(b['custody'],'fixed_existing_custody')
 for name,digestName in [('sshExecutable','sshExecutableSha256'),('privateKeyPath','privateKeySha256'),('knownHostsPath','knownHostsSha256')]:custody['pin'](profile[name],profile[digestName],installed_ssh=name=='sshExecutable')
 acl=module(b['privateOutputProducer'],'fixed_private_output');output=pathlib.Path(b['output']);private=acl['private_output'](output)
 core={};exec(compile(read(b['sourceFiles']['original.py']),'fixed-source-stream-original','exec'),core);owner=core['SourceStreamOwner'](output);result=None
 argv=ssh_argv(profile);reused_stream=None
 try:
  if b['phase']=='local-decrypt':reused_path,reused_stream,reused_named,reused_held=check_input(b['component']['gzip'])
  ssh=module(b['sshOwner'],'fixed_original_ssh_owner');env=dict(os.environ);env['PSModulePath']='C:/Windows/System32/WindowsPowerShell/v1.0/Modules'
  signature=owner.run_original(['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','-NoProfile','-NonInteractive','-Command',ssh['SIGNATURE_COMMAND']],'nativeSshSignature',maximum_stdout=2*1024**2,env=env)
  assert signature['stderrBytes']==0 and json.loads(read(signature['stdout']))=={'Status':'Valid','Subject':'CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond, S=Washington, C=US','Thumbprint':'AD714D3C4B2B794A95441375C954130E9109EF4C'}
  stage=pinned_ssh(owner,custody,profile,[*argv,'python3 -I -B -'],'stageSource',secret_input=read(b['sourceFiles']['stage.py']),maximum_stdout=2*1024**2)
  assert stage['stderrBytes']==0;staged=json.loads(read(stage['stdout'],2*1024**2));assert staged['format']=='sabalan-source-a-stream-source-stage/v1'and staged['operation']==b['operation']and staged['phase']==b['phase']and staged['runtimeSpecSha256']==b['runtimeSpec']['sha256']and staged['allOriginalChildrenClosed']is True
  assert staged['files']['runtime.py']['sha256']==b['runtimeSourceSha256']
  assert __import__('shutil').disk_usage(output).free>=3*staged['imageBytes']+64*1024**2+512*1024**2,'WINDOWS_STREAM_WORKSPACE_REFUSED'
  ad['validate_spec'](spec);preflight['validate'](b['preflight'])
  held_input=None
  try:
   if b['phase']=='encrypt-existing':
    p,held_input,named,held=check_input(b['component']['gzip'])
   elif b['phase']=='local-decrypt':
    cipher=select_local_cipher(b);p,held_input,named,held=check_input(cipher)
   binary=pinned_ssh(owner,custody,profile,[*argv,b['remoteCommand']],'binaryPhase',maximum_stdout=2**31 if b['phase']=='encrypt-existing'else 2*1024**2,input_file=held_input)
   if held_input is not None:assert same_api_pin(held)==same_api_pin(os.fstat(held_input.fileno()))and same_api_pin(named)==same_api_pin(p.lstat())
  finally:
   if held_input is not None:held_input.close()
  remote=json.loads(read(binary['stderr'if b['phase']=='encrypt-existing'else'stdout'],2*1024**2));assert remote['format']==('sabalan-source-a-closed-stream-phase/v1'if b['phase']=='encrypt-existing'else'sabalan-source-a-closed-local-hash-phase/v1')and remote['phase']==b['phase']and remote['operation']==b['operation']and remote['runtimeSpecSha256']==b['runtimeSpec']['sha256']and remote['allOriginalChildrenClosed']is True and remote['productionAdmission']is False
  assert remote['image']==b['component']['image']and remote['rootfsDiffIds']==b['component']['rootfsDiffIds'];row=remote['native']['result'];assert row['plainBytes']==b['component']['gzip']['bytes']and row['plainSha256']==b['component']['gzip']['sha256'];field='cipher'if b['phase']=='encrypt-existing'else'plain'
  if b['phase']=='encrypt-existing':assert binary['stdoutBytes']==row[field+'Bytes']and binary['stdout']['sha256']==row[field+'Sha256']
  else:assert binary['stderrBytes']==0 and remote['plaintextReturned']is False and remote['plaintextTransportBytes']==0 and same_api_pin(reused_held)==same_api_pin(os.fstat(reused_stream.fileno()))and same_api_pin(reused_named)==same_api_pin(reused_path.lstat())
  if b['phase']=='local-decrypt':assert row['gcmAuthenticated']is True and row['cipherBytes']==b['cipherInput']['bytes']and row['cipherSha256']==b['cipherInput']['sha256']
  validation=None
  if b['phase']=='local-decrypt':
   node=b['windowsNode'];custody['pin'](node['file'],node['sha256']);expected={'bytes':row['plainBytes'],'sha256':row['plainSha256'],'rootfsDiffIds':remote['rootfsDiffIds']}
   checked=owner.run_original([node['file'],'--max-old-space-size=512',b['sourceFiles']['validate-gzip.cjs']['file'],b['component']['gzip']['file'],b['component']['raw']['file'],json.dumps(expected,separators=(',',':'))],'validateArchive',maximum_stdout=2*1024**2)
   assert checked['stderrBytes']==0;validation=json.loads(read(checked['stdout'],2*1024**2));assert validation['format']=='sabalan-source-a-private-local-gzip-oci/v1'and validation['productionAdmission']is False
  if reused_stream is not None:assert same_api_pin(reused_held)==same_api_pin(os.fstat(reused_stream.fileno()))and same_api_pin(reused_named)==same_api_pin(reused_path.lstat())
  assert not owner.interrupted
  result={'format':'sabalan-source-a-original-closed-stream-phase/v1','service':b['service'],'component':b['component'],'inputKind':'FIXED_EXISTING_GZIP','imageExported':False,'regzipped':False,'phase':b['phase'],'operation':b['operation'],'sourcePrivateAcl':private,'stageOriginal':stage,'binaryOriginal':binary,'remote':remote,'streamOutput':{**binary['stdout'],'bytes':binary['stdoutBytes']},'canonicalLocalArchiveValidation':validation,'originalClosures':owner.children,'allOriginalChildrenClosed':True,'productionAdmission':False,'healthyPointClaimed':False,'independentDecryptVerified':False}
  if b['phase']=='local-decrypt':
   result['format']='sabalan-source-a-original-closed-local-hash-phase/v1';result['hashProofPacket']=result.pop('streamOutput');result['reusedPlaintextRef']=b['component']['gzip'];result['encryptionPhase']=b['encryptionPhase']
  return core['save'](output/'phase-complete.json',result)
 finally:
  if reused_stream is not None:reused_stream.close()
  owner.close()
  if result is None:core['save'](output/'phase-negative.json',{'format':'sabalan-source-a-stream-phase-negative/v1','phase':b['phase'],'originalClosures':owner.children,'interrupted':owner.interrupted,'productionAdmission':False})
if __name__=='__main__':print(json.dumps(main()))
