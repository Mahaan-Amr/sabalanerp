"""ONE closed native encryption component from an explicitly negative outer phase.
No parent promotion or live admission. metadata() reads bounded public header only;
publish() adds the exact held-FD full cipher hash before private component output.
"""
import pathlib,json,hashlib,runpy,copy,re,os,stat,argparse
Q=pathlib.Path('D:/sabalanerp-online-qa');HERE=pathlib.Path(__file__).resolve().parent
OP='dded25fdf3d946878484d307ca742743'
REFS={'phase-negative.json': {'file': 'D:\\sabalanerp-online-qa\\C30-source-a-existing-frontend-encrypt-existing-dded25fdf3d946878484d307ca742743\\phase-negative.json', 'sha256': 'b0fd90f11717c2a21d40e1ac407801afba98ae34f07629cf29fad610c3fc0a80'}, 'binaryPhase.original-closed.json': {'file': 'D:\\sabalanerp-online-qa\\C30-source-a-existing-frontend-encrypt-existing-dded25fdf3d946878484d307ca742743\\binaryPhase.original-closed.json', 'sha256': '64598b1edb7dbf2d167a8d9e9094a832937a946e2e5a901925d8b2f0e8c54ad2'}, 'binaryPhase.stderr.raw': {'file': 'D:\\sabalanerp-online-qa\\C30-source-a-existing-frontend-encrypt-existing-dded25fdf3d946878484d307ca742743\\binaryPhase.stderr.raw', 'sha256': '5a8e794eb921b836309c49332c7000616c2e8649fb02c4dcae3e0c884cc25278'}, 'stageSource.original-closed.json': {'file': 'D:\\sabalanerp-online-qa\\C30-source-a-existing-frontend-encrypt-existing-dded25fdf3d946878484d307ca742743\\stageSource.original-closed.json', 'sha256': '9ccb170d9b8eede17a6c05b205eb45ca9a6d0f822e46cb9620dd91c5d17b7e8b'}, 'stageSource.stdout.raw': {'file': 'D:\\sabalanerp-online-qa\\C30-source-a-existing-frontend-encrypt-existing-dded25fdf3d946878484d307ca742743\\stageSource.stdout.raw', 'sha256': '7b002b352fc80dd300b776fe0445a8d87b0fc97e5e450d40d1d5395ec69dbea7'}, 'material': {'file': 'D:\\sabalanerp-online-qa\\C30-source-a-existing-material-frontend-encrypt-existing-dded25fdf3d946878484d307ca742743\\material.json', 'sha256': 'e4f7eb5f1e988114a4b83a24ff572767824f3d137c4fed020b1d96a22f89f817'}}
PARENT={'file': 'D:\\sabalanerp-online-qa\\C30-source-a-fixed-existing-gzip-stream-source-r3-hash-only-local-decrypt-20261025\\source-review.json', 'sha256': '05a210863956a71134f5c8a5c7b332fdd7ee17d4d705f4381a09ff360e2ca8e5'}
PRIVATE={'file': 'D:\\sabalanerp-online-qa\\C30-strict-complete-actual-plan-source-r6-observed-renewal-20261025\\prepare.py', 'sha256': '0e11fddceb398d90eced7650f59b6be92a223277c7bdd971376ccbd4f8ba28cb'}
CUSTODY={'file': 'D:\\sabalanerp-online-qa\\C30-postcheckpoint-terminal-context-source-r2-current-original-pins-20261024\\custody.py', 'sha256': 'a6ab3ec32561ef0865100485ff5a1ab566a5225c95a5831382a305cd8080f2d1'}

def sha(b):return hashlib.sha256(b).hexdigest()
def read(ref):
 p=pathlib.Path(ref['file']);a=p.lstat();assert p.resolve(strict=True)==p and stat.S_ISREG(a.st_mode)and a.st_nlink==1 and 0<a.st_size<=2*1024**2
 raw=p.read_bytes();assert sha(raw)==ref['sha256']and (a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns,a.st_mode,a.st_nlink)==tuple(getattr(p.lstat(),k)for k in ['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_mode','st_nlink']);return json.loads(raw)
def load(ref):
 p=pathlib.Path(ref['file']);before=p.lstat();assert p.resolve(strict=True)==p and stat.S_ISREG(before.st_mode)and before.st_nlink==1
 raw=p.read_bytes();after=p.lstat();fields=lambda x:tuple(getattr(x,k)for k in ['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_mode','st_nlink']);assert fields(before)==fields(after)and sha(raw)==ref['sha256'];ns={'__name__':'fixed_component_source','__file__':str(p)};exec(compile(raw,str(p),'exec'),ns);return ns
def metadata():
 component=load({'file':str(HERE/'components.py'),'sha256':'058cca00514cefe9666bbd37c7a3f6817cc5fc397e47fe7bc0a67f93bb84087b'})['select']('frontend');negative=read(REFS['phase-negative.json']);row=read(REFS['binaryPhase.original-closed.json']);remote=read(REFS['binaryPhase.stderr.raw']);stage=read(REFS['stageSource.original-closed.json']);stage_data=read(REFS['stageSource.stdout.raw']);material=read(REFS['material'])
 assert negative['format']=='sabalan-source-a-stream-phase-negative/v1'and negative['phase']=='encrypt-existing'and negative['interrupted']is False and negative['productionAdmission']is False
 assert REFS['binaryPhase.original-closed.json']in negative['originalClosures']and REFS['stageSource.original-closed.json']in negative['originalClosures']
 assert row['originalPid']==36144 and row['code']==1 and row['signal']is None and row['stdoutEof']is True and row['stderrEof']is True
 for r in [row,stage]:
  assert r['observationFaults']==[]and r['observationFaultCounts']=={}and r['observationFaultTotal']==0 and r['observationFaultLogOverflow']is False and r['localInterrupted']is False and r['cancellations']==[]and r['stdinBodyStored']is False and r['stdinSecretStored']is False
 assert stage['code']==0 and stage['signal']is None and stage['stdoutEof']is True and stage['stderrEof']is True
 assert stage['stdout']==REFS['stageSource.stdout.raw']and row['stderr']==REFS['binaryPhase.stderr.raw']and row['stdoutBytes']==269929059 and row['stdout']['sha256']=='3ebbeafe68d57788847b10fc5d75176235f3ee48324ea9fd67b4a138517b93d3'
 assert material['operation']==OP and material['phase']=='encrypt-existing'and material['sourceReview']==PARENT
 for ref in material['files'].values():
  p=pathlib.Path(ref['file']);assert p.resolve(strict=True)==p and p.lstat().st_nlink==1 and sha(p.read_bytes())==ref['sha256']
 packet=read(PARENT)
 for ref in packet['files'].values():
  p=pathlib.Path(ref['file']);assert p.resolve(strict=True)==p and p.lstat().st_nlink==1 and sha(p.read_bytes())==ref['sha256']
 assert stage_data['operation']==OP and stage_data['phase']=='encrypt-existing'and stage_data['archiveCreated']is False and stage_data['productionAdmission']is False
 assert remote['format']=='sabalan-source-a-closed-stream-phase-negative/v1'and remote['failureType']=='AssertionError'and remote['productionAdmission']is False
 children=remote['children'];assert len(children)==30
 for child in children:assert child['code']==0 and child['pipesClosed']is True and child['observationFault']is None
 node=children[-3];assert node['pid']==2415745 and node['argv']==['/usr/bin/node','/root/sabalan-recovery-private/source-a-existing-frontend-encrypt-existing-'+OP+'/pipeline.cjs']and node['stdoutEof']is True and node['stderrEof']is True and node['faultCounts']=={}and node['outputBoundExceeded']is False
 assert children[-2]['argv']==['docker','ps','-aq','--no-trunc']and children[-1]['argv'][:3]==['docker','container','inspect']
 cipher={**row['stdout'],'bytes':row['stdoutBytes']};assert cipher['file']==str(Q/('C30-source-a-existing-frontend-encrypt-existing-'+OP)/'binaryPhase.stdout.raw')and node['stdoutBytes']==cipher['bytes']and node['stdoutSha256']==cipher['sha256']
 p=pathlib.Path(cipher['file']);before=p.lstat();assert p.resolve(strict=True)==p and stat.S_ISREG(before.st_mode)and before.st_nlink==1 and before.st_size==cipher['bytes']
 fields=lambda s:tuple(getattr(s,k)for k in ['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_mode','st_nlink'])
 portable=lambda s:tuple(getattr(s,k)for k in ['st_ino','st_size','st_mtime_ns','st_mode','st_nlink'])
 with p.open('rb')as f:
  fd=os.fstat(f.fileno());assert portable(fd)==portable(before)
  if os.name!='nt':assert fields(fd)==fields(before)
  prefix=f.read(12);assert prefix[:8]==b'SABREC01';size=int.from_bytes(prefix[8:],'big');assert 0<size<=16384;raw=f.read(size);assert len(raw)==size;header=json.loads(raw);assert fields(fd)==fields(os.fstat(f.fileno()))
 assert fields(before)==fields(p.lstat())and header['format']=='sabalan-recovery'and header['version']==2 and [r['keyId']for r in header['recipients']]==['local-rollback','independent-recovery']
 result={'plainBytes':component['gzip']['bytes'],'plainSha256':component['gzip']['sha256'],'cipherBytes':cipher['bytes'],'cipherSha256':cipher['sha256'],'header':header,'inputKind':'FIXED_EXISTING_GZIP','imageExported':False,'regzipped':False}
 native={'format':'sabalan-source-a-stream-native/v1','mode':'encrypt-existing','image':component['image'],'recipientSpkiSha256':'455e5a7ba5990866ca6992c0fd177fa0df5b22b5d3e985c41ee306e3a779b8af','result':result}
 raw=(json.dumps(native,separators=(',',':'))+'\n').encode();assert len(raw)==node['stderrBytes']==1661 and sha(raw)==node['stderrSha256']=='c435f13e67a57955a7585447726704840e699f26ec652e32c32fb12ec3f8a8cf'
 return {'format':'sabalan-source-a-closed-native-existing-gzip-encryption-component/v1','service':'frontend','component':component,'native':native,'cipher':cipher,'negativeParentReferences':REFS,'nativeOriginal':node,'nativeMetadataPreimage':{'bytes':len(raw),'sha256':sha(raw)},'negativeParentQualified':False,'fullOuterPhaseSucceeded':False,'productionAdmission':False,'healthyApplicationPoint':False}
def authenticate(ref,service,component):
 value=read(ref);assert service=='frontend'and value==metadata()and value['component']==component;return value['cipher']
def publish(output):
 value=metadata();c=load(CUSTODY);pin=c['pin'](value['cipher']['file'],value['cipher']['sha256']);assert pin['bytes']==value['cipher']['bytes']
 private=load(PRIVATE);p=pathlib.Path(output);assert p.parent==Q and re.fullmatch('C30-source-a-frontend-encryption-component-[a-f0-9]{32}',p.name)and not p.exists();private['private_output'](p);return private['write'](p/'component.json',(json.dumps(value,indent=2)+'\n').encode())
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--output',required=True);args=a.parse_args();print(json.dumps(publish(args.output)))
