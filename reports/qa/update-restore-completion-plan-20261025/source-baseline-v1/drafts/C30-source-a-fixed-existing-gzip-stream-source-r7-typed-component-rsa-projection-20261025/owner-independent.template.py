"""Same original credential context and plink child; zero backup archive files."""
import pathlib,hashlib,json,os,sys,getpass
BOUND=None
def main():
 assert BOUND is not None,'UNBOUND_INDEPENDENT_IMAGE_STREAM_OWNER';b=BOUND
 helpers={};scope={'__name__':'fixed_public_input_helpers','__file__':b['files']['public-window-helpers.py']['file']}
 p=pathlib.Path(b['files']['public-window-helpers.py']['file']);raw=p.read_bytes();assert hashlib.sha256(raw).hexdigest()==b['files']['public-window-helpers.py']['sha256'];exec(compile(raw,str(p),'exec'),scope)
 for row in b['files'].values():scope['read'](row)
 component=scope['module'](b['files']['components.py'],'fixed_two_components')['select'](b['service']);assert component==b['component']
 scope['read'](b['producerReview']);scope['read'](b['productionReview']);scope['read'](b['encryptionPhase']);scope['read'](b['localPhase'])
 private=scope['module'](b['privateOutputProducer'],'fixed_private_output');output=pathlib.Path(b['output']);acl=private['private_output'](output)
 core={};exec(compile(scope['read'](b['files']['original.py']),'fixed_independent_original','exec'),core);owner=core['SourceStreamOwner'](output);credential=scope['module'](b['files']['backup_credential.py'],'fixed_existing_backup_credential');custody=scope['module'](b['custody'],'fixed_existing_custody');result=None;password=None;completed=False
 def original(passwordFile,command,phase,**kwargs):
  profile=credential['profile']();argv=credential['plink_argv'](passwordFile,command);fd=os.open(profile['plinkExecutable'],os.O_RDONLY|getattr(os,'O_BINARY',0));held=os.fstat(fd);named=pathlib.Path(profile['plinkExecutable']).stat()
  try:
   assert custody['same_stat'](held,named,cross_windows=True)
   try:return owner.run_original(argv,phase,redact_password=password.encode('utf8'),**kwargs)
   finally:assert custody['same_stat'](held,os.fstat(fd))and custody['same_stat'](named,pathlib.Path(profile['plinkExecutable']).stat())
  finally:os.close(fd)
 try:
  password=getpass.getpass('Private SSH credential: ')
  with credential['private_backup_password'](owner,password)as passwordFile:
   stage=original(passwordFile,'python3 -I -B -','backupStage',secret_input=scope['read'](b['files']['stage.py']),maximum_stdout=2*1024**2);assert stage['stderrBytes']==0
   staged=json.loads(scope['read'](stage['stdout'],2*1024**2));assert staged['format']=='sabalan-source-a-independent-image-source-stage/v1'and staged['operation']==b['operation']and staged['files']['runtime.py']['sha256']==b['runtimeSha256']
   p,stream,named,held=scope['check_input'](b['cipherInput'])
   try:
    verified=original(passwordFile,b['verifyCommand'],'backupVerify',input_file=stream,maximum_stdout=2*1024**2)
    assert scope['same_api_pin'](held)==scope['same_api_pin'](os.fstat(stream.fileno()))and scope['same_api_pin'](named)==scope['same_api_pin'](p.lstat())
   finally:stream.close()
   native=json.loads(scope['read'](verified['stdout'],2*1024**2));closed=json.loads(scope['read'](verified['stderr'],2*1024**2));assert native['format']=='sabalan-source-a-independent-image-stream-gcm/v1'and closed['format']=='sabalan-source-a-independent-image-original-closed/v1'and closed['operation']==b['operation']and closed['allOriginalChildrenClosed']is True
   for name in ['image','cipherBytes','cipherSha256','plainBytes','plainSha256']:assert native[name]==b['expected'][name]
   assert native['gcmAuthenticated']is True and native['privateRsaExported']is False and native['plaintextPersisted']is False and native['cipherPersisted']is False and not owner.interrupted
   result={'format':'sabalan-source-a-independent-image-stream-verified/v1','operation':b['operation'],'service':b['service'],'component':b['component'],'inputKind':'FIXED_EXISTING_GZIP','imageExported':False,'encryptionPhase':b['encryptionPhase'],'localPhase':b['localPhase'],'sourcePrivateAcl':acl,'stageOriginal':stage,'verifyOriginal':verified,'native':native,'remoteOriginalClosure':closed,'originalClosures':owner.children,'allOriginalChildrenClosed':True,'independentDecryptVerified':True,'productionAdmission':False,'healthyApplicationPoint':False}
  password=None
  proof=core['save'](output/'verification-complete.json',result);completed=True;return proof
 finally:
  password=None;owner.close()
  if not completed:core['save'](output/'verification-negative.json',{'format':'sabalan-source-a-independent-image-stream-negative/v1','originalClosures':owner.children,'interrupted':owner.interrupted,'productionAdmission':False})
if __name__=='__main__':print(json.dumps(main()))
