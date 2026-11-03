"""Exactly two existing successful serving-image archives. No caller path/image mapping."""
import pathlib,json,hashlib,stat
R=pathlib.Path('C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp')
ROWS={
 'frontend':('actual-frontend-image-export-b1b5e8027189f655899c54b975e9cfd7','29c73bcfd569226fceb60eacf81f063808fd3993de009d0f273bb37133e04f93','sha256:008388c7f0188170b46b7466f534398f91894f12770a96c9af96a4f6cc90e040','11c6401196e63e8e91339936574f8f5ae4fca9c1566b14520408e138e0dffb79',269927919),
 'inquiry':('actual-inquiry-image-export-e8edf8e5e2925fe515b897bf86ecfe2a','3143aba1cbe74b84879c61bc263a89c39cfe03a86d02d1570dee8590882a2897','sha256:7b029f245af9ad80ca85d92df38996ac268821b62732b9b325901d697295e1b9','3c4616cfc19171fd8735edf75cd62c1418e716abf60adae838276342a2ad2aa9',379560615)}
def authenticated_json(p,digest):
 p=pathlib.Path(p);before=p.lstat();assert p.resolve(strict=True)==p and stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<before.st_size<=8*1024**2
 fields=lambda x:tuple(getattr(x,k)for k in ['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_mode','st_nlink']);portable=lambda x:tuple(getattr(x,k)for k in ['st_ino','st_size','st_mtime_ns','st_mode','st_nlink'])
 with p.open('rb')as f:
  opened=__import__('os').fstat(f.fileno());assert portable(before)==portable(opened)
  if __import__('os').name!='nt':assert fields(before)==fields(opened)
  raw=f.read(8*1024**2+1);assert len(raw)<=8*1024**2 and fields(opened)==fields(__import__('os').fstat(f.fileno()))
 assert fields(before)==fields(p.lstat())and hashlib.sha256(raw).hexdigest()==digest;return json.loads(raw)

def select(service):
 assert service in ROWS,'ONLY_TWO_FIXED_SUCCESSFUL_COMPONENTS'
 stem,digest,image,packed_hash,packed_size=ROWS[service];p=R/'reports/qa'/(stem+'.json');v=authenticated_json(p,digest)
 assert v['format']=='sabalan-actual-'+service+'-image-export-ssh/v1'and v['passResult']is True and v['originalClosure']=={'allOriginalChildrenClosed':True,'childCount':2,'interrupted':False}
 for key in ['originalSsh','originalTransfer']:
  c=v[key];assert c['code']==0 and c['signal']is None and c['naturalChildClosure']is True and c['outputBoundExceeded']is False and c['stderr']==''
 remote=v['remote'];assert json.loads(v['originalSsh']['stdout'])==remote and remote['sourceImage']==image and remote['image']['id']==image and remote['allOriginalChildrenClosed']is True and remote['allSixIdentitiesUnchanged']is True and remote['before']==remote['after']
 assert all(c['returncode']==0 and type(c['originalPid'])is int and c['originalPid']>0 for c in remote['originalCommands'])
 gzip=v['localArchive'];assert gzip['sha256']==packed_hash and gzip['bytes']==packed_size
 plan_pin,retirement_id,retirement_pin={'frontend':('64fd578e1c510a7c95e44b0ac5cbabbde08ac09af7b9708c055ea0e10ac2072d','4b2296870b95a765','6727c90f4642613129368c3a669983059f10c805f3377025bc7a9d254c48e32c'),'inquiry':('9125e78012823a8c7f8284cc25f44093b414118c1e95bfe0d5617fba7144eafe','438636c0e76857b0','32adb7cd4a33b8bbfd59a79326a0d06a41b3e777ebef7fca2f2fb3c4db8f9c03')}[service]
 plan_path=pathlib.Path('D:/sabalanerp-online-qa')/stem/'retirement-plan.json';plan=authenticated_json(plan_path,plan_pin);assert plan['exportReceipt']['sha256']==digest
 retired_path=R/'reports/qa'/(stem+'-scratch-retirement-'+retirement_id+'.json');retired=authenticated_json(retired_path,retirement_pin);assert retired['passResult']is True and retired['remote']['localCopiesPreserved']is True and retired['remote']['allOriginalChildrenClosed']is True
 preservation=plan['spec']['localPreservation'];graph=preservation['graph'];assert graph['index']==image and graph['rootfsDiffIds']==remote['image']['rootfs']and graph['archiveSha256']==remote['rawArchive']['sha256']and graph['archiveBytes']==remote['rawArchive']['bytes'];assert preservation['gzip']['sha256']==packed_hash and preservation['gzip']['bytes']==packed_size
 return {'service':service,'image':image,'receipt':{'file':str(p),'sha256':digest},'gzip':{'file':gzip['path'],'bytes':packed_size,'sha256':packed_hash},'raw':{'file':preservation['rawArchive'],'bytes':graph['archiveBytes'],'sha256':graph['archiveSha256']},'rootfsDiffIds':graph['rootfsDiffIds'],'archiveGraph':graph,'retirementPlan':{'file':str(plan_path),'sha256':plan_pin},'retirementReceipt':{'file':str(retired_path),'sha256':retirement_pin},'historicalContentOnly':True,'productionAdmission':False}
