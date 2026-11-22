"""Original bounded WAL verifier under the restore guardian's SAME lock OFDs.
No Docker, SSH, SQL, runtime adoption, or successful-report import.
"""
import base64,hashlib,json,os,re,stat,subprocess,threading
from pathlib import Path

MAX_CIPHER=256*1024**2
MAX_PLAIN=64*1024**2

def frame(value):return (json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def request(value):
 assert set(value)=={'format','sequence','challenge','deploymentId','releaseId','windowSha256','sourceIdentity','objects'}
 assert value['format']=='sabalan-original-wal-window-verification-request/v1'
 assert type(value['sequence']) is int and value['sequence']>0
 for key in ['challenge','windowSha256']:assert re.fullmatch('[a-f0-9]{64}',value[key])
 for key in ['deploymentId','releaseId']:assert re.fullmatch('[A-Za-z0-9][A-Za-z0-9_.-]{7,127}',value[key])
 identity=value['sourceIdentity'];assert set(identity)=={'systemIdentifier','timeline'}
 assert re.fullmatch('[1-9][0-9]{0,19}',identity['systemIdentifier']) and type(identity['timeline']) is int and 0<identity['timeline']<=0xffffffff
 assert 1<=len(value['objects'])<=16;names=set();total=0
 for item in value['objects']:
  assert set(item)=={'name','bytes','sha256'} and re.fullmatch('[A-Za-z0-9_.-]{1,160}',item['name']) and item['name'] not in ('.','..') and item['name'] not in names
  names.add(item['name']);assert type(item['bytes']) is int and 0<item['bytes']<=MAX_PLAIN and re.fullmatch('[a-f0-9]{64}',item['sha256']);total+=item['bytes']
 assert total<=MAX_CIPHER
 return total

def fsync_parent(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)

def bind_original_prepoint_windows(source,point,read):
 """Bind only authentic same-source ACK rows after the real point exists."""
 rows=source['initialWindows'];assert 1<=len(rows)<=10000 and len({x['requestSha256']for x in rows})==len(rows)
 owner=dict(sourceOriginalPid=source['sourceOriginalPid'],sourceRuntimeId=source['sourceRuntimeId'])
 assert type(owner['sourceOriginalPid']) is int and owner['sourceOriginalPid']>0 and re.fullmatch('[a-f0-9]{64}',owner['sourceRuntimeId'])
 sealed=json.loads(read(Path(point['sealedFile']),point['sealedSha256']))
 base=dict(sealedManifestSha256=point['sealedSha256'],plaintextManifestSha256=point['manifestSha256'],cipherInventorySha256=digest([dict(name=x['name'],bytes=x['cipherBytes'],sha256=x['cipherSha256'])for x in sealed['objects']]),directory=point['root'])
 bindings=[]
 for row in rows:
  checksum=row['requestSha256'];assert re.fullmatch('[a-f0-9]{64}',checksum)
  file=Path('/root/sabalan-recovery-private/native-qa/wal-windows')/checksum/'dependency.json';assert str(file)==row['dependencyFile'] and file.resolve(strict=True)==file
  original=read(file,row['dependencySha256']);value=json.loads(original)
  assert value['format']=='sabalan-independent-certified-wal-prepoint-dependency/v1' and value['basePoint'] is None and value['sourceOwner']==owner and value['requestSha256']==checksum and value['certificateSha256']==row['certificateSha256']
  read(Path(value['certificateFile']),value['certificateSha256'],65536)
  for item in value['objects']:read(Path(item['path']),item['sha256'],item['bytes'])
  binding_file=file.parent/'point-binding.json';body=frame(dict(format='sabalan-original-prepoint-wal-binding/v1',sourceOwner=owner,originalDependencySha256=row['dependencySha256'],basePoint=base));write(binding_file,body)
  bindings.append(dict(**row,bindingFile=str(binding_file),bindingSha256=hashlib.sha256(body).hexdigest()))
 return bindings

def write(path,raw):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
 try:
  with os.fdopen(os.dup(fd),'wb') as out:assert out.write(raw)==len(raw);out.flush();os.fsync(out.fileno())
  assert path.read_bytes()==raw
 finally:os.close(fd)
 fsync_parent(path.parent)

def verify_original(config,value,root,read):
 """Birth/retain one actual verifier child; no accepting supplied PIDs/receipt."""
 wanted=value['request'];request(wanted);checksum=digest(wanted)
 assert value['requestSha256']==checksum
 assert type(value['sourceOriginalPid']) is int and value['sourceOriginalPid']>0 and re.fullmatch('[a-f0-9]{64}',value['sourceRuntimeId'])
 write(root/'original-source.json',frame(dict(sourceOriginalPid=value['sourceOriginalPid'],sourceRuntimeId=value['sourceRuntimeId'])))
 worker=Path(config['bundleRoot'])/'independent-wal-window.worker.cjs'
 read(worker,config['sourcePins'][worker.name],1024**2)
 codec=Path(config['bundleRoot'])/'recoveryCrypto.cjs';coverage=Path(config['bundleRoot'])/'postgres-recovery-coverage.mjs'
 read(codec,config['sourcePins'][codec.name],1024**2);read(coverage,config['sourcePins'][coverage.name],1024**2)
 material=dict(format='sabalan-original-independent-wal-window-input/v1',request=wanted,requestSha256=checksum,
  sealRawBase64=value['ownedOutputs']['seal']['rawBase64'],closureRawBase64=value['ownedOutputs']['closure']['rawBase64'],
  codecFile=str(codec),codecSha256=config['sourcePins'][codec.name],coverageFile=str(coverage),coverageSha256=config['sourcePins'][coverage.name],
  keyFile=config['recoveryPrivateKeyPath'],keySha256=config['recoveryPrivateKeySha256'],root=str(root))
 write(root/'request.json',frame(wanted));write(root/'seal.json',base64.b64decode(material['sealRawBase64'],validate=True));write(root/'capture.json',base64.b64decode(material['closureRawBase64'],validate=True))
 raw=frame(material);file=root/'input.json';write(file,raw)
 child=subprocess.Popen([config['nodeExecutable'],'--max-old-space-size=128',str(worker),str(file),hashlib.sha256(raw).hexdigest()],
   stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(9,10))
 buffers={};errors=[];threads=[]
 def pump(name,stream,limit):
  try:
   data=stream.read(limit+1);assert len(data)<=limit;buffers[name]=data
  except BaseException as error:errors.append(error)
  finally:stream.close()
 for name,stream,limit in [('out',child.stdout,2*1024**2),('err',child.stderr,65536)]:
  thread=threading.Thread(target=pump,args=(name,stream,limit));thread.start();threads.append(thread)
 status=child.wait()
 for thread in threads:thread.join(timeout=30)
 # Exited child plus inherited open pipe is UNKNOWN, never CLOSED_FAILED.
 assert not errors and all(not thread.is_alive() for thread in threads) and child.stdout.closed and child.stderr.closed,'WAL_WINDOW_ORIGINAL_PIPE_UNKNOWN'
 assert status==0,'WAL_WINDOW_ORIGINAL_VERIFIER_FAILED'
 output=buffers['out'];report=json.loads(output)
 assert report['requestSha256']==checksum and report['challenge']==wanted['challenge'] and report['windowSha256']==wanted['windowSha256']
 assert report['sourceIdentity']==wanted['sourceIdentity'] and report['objects']==wanted['objects']
 for key in ['independentRsaDecryptVerified','fullGcmAuthenticated','fullCipherReadbackVerified','exactContiguousWalVerified','allCiphertextsRetained']:assert report[key] is True
 assert report['physicalReplayQualified'] is False and report['productionAdmission'] is False
 write(root/'verification.json',output)
 return dict(event='WAL_WINDOW_RESULT',requestSha256=checksum,reportRawBase64=base64.b64encode(output).decode(),reportSha256=hashlib.sha256(output).hexdigest(),
  originalVerifierPid=child.pid,originalVerifierReturncode=child.returncode,originalVerifierSignal=None,originalPipesClosed=True,
  verifierSourceSha256=config['sourcePins'][worker.name],remoteDirectory=str(root),productionAdmission=False)


def store_certificate_original(config,value,root,read):
 checksum=value['requestSha256'];assert root.name==checksum
 wanted=json.loads((root/'request.json').read_bytes());assert digest(wanted)==checksum
 item=value['certificate'];raw=base64.b64decode(item['rawBase64'],validate=True)
 assert 0<len(raw)<=65536 and len(raw)==item['bytes'] and hashlib.sha256(raw).hexdigest()==item['sha256']
 public=Path(config['bundleRoot'])/'online-qualification-public-key.pem'
 assert config['sourcePins'][public.name]=='e61a06dfe5562a2375cb3051178ad9760857a7a01ea8b88f094a6e6123fdbc48'
 read(public,config['sourcePins'][public.name],4096)
 material=dict(format='sabalan-original-independent-wal-window-certificate-input/v1',request=wanted,certificateRawBase64=item['rawBase64'],publicKeyFile=str(public),publicKeySha256=config['sourcePins'][public.name])
 data=frame(material);file=root/'certificate-input.json';write(file,data)
 worker=Path(config['bundleRoot'])/'independent-wal-window.worker.cjs';read(worker,config['sourcePins'][worker.name],1024**2)
 child=subprocess.Popen([config['nodeExecutable'],'--max-old-space-size=128',str(worker),str(file),hashlib.sha256(data).hexdigest()],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(9,10))
 out,err=child.communicate();assert child.returncode==0 and len(out)<=65536 and len(err)<=65536 and child.stdout.closed and child.stderr.closed
 observed=json.loads(out);assert observed['certificateSha256']==item['sha256'] and observed['requestSha256']==checksum
 target=root/'certificate.json';write(target,raw)
 # Append-only per-window index; final release coverage must explicitly retain
 # these directory IDs before any point retention owner can consider pruning.
 point=config.get('onlinePhysicalPoint');source_owner=json.loads((root/'original-source.json').read_bytes());point=point if point and point.get('sourceRuntimeId')==source_owner['sourceRuntimeId'] else None
 base_point=None
 if point:
  sealed_raw=read(Path(point['sealedFile']),point['sealedSha256']);read(Path(point['manifestFile']),point['manifestSha256']);sealed=json.loads(sealed_raw)
  cipher_inventory=[dict(name=row['name'],bytes=row['cipherBytes'],sha256=row['cipherSha256']) for row in sealed['objects']]
  base_point=dict(sealedManifestSha256=point['sealedSha256'],plaintextManifestSha256=point['manifestSha256'],cipherInventorySha256=digest(cipher_inventory),directory=point['root'])
 index=dict(format='sabalan-independent-certified-wal-dependency/v1' if point else 'sabalan-independent-certified-wal-prepoint-dependency/v1',sourceOwner=source_owner,certificateAcceptedAt=observed['acceptedAt'],basePoint=base_point,requestSha256=checksum,windowSha256=wanted['windowSha256'],deploymentId=wanted['deploymentId'],releaseId=wanted['releaseId'],sourceIdentity=wanted['sourceIdentity'],
  objects=[dict(**row,path=str(root/'ciphertexts'/row['name'])) for row in wanted['objects']],certificateFile=str(target),certificateSha256=item['sha256'],certificateBytes=len(raw),
  requestFile=str(root/'request.json'),sealFile=str(root/'seal.json'),captureFile=str(root/'capture.json'),verificationFile=str(root/'verification.json'),productionAdmission=False)
 write(root/'dependency.json',frame(index))
 repository=Path('/srv/sabalanerp-recovery/checkpoints')/('online-'+point['captureId']) if point else None;published=None
 if repository is not None and repository.exists():published=promote_window_repository(config,root,repository,repository)
 return dict(**(dict(repositoryDependencyFile=published['file'],repositoryDependencySha256=published['sha256']) if published else {}),event='WAL_WINDOW_CERTIFICATE_STORED',requestSha256=checksum,certificateSha256=item['sha256'],certificateBytes=len(raw),remoteCertificateFile=str(target),remoteDependencyFile=str(root/'dependency.json'),dependencySha256=hashlib.sha256(frame(index)).hexdigest(),
  originalCertificateVerifierPid=child.pid,originalCertificateVerifierReturncode=child.returncode,originalCertificateVerifierSignal=None,fsyncFileAndDirectory=True,fullReadbackVerified=True)


def run_standalone(config,helper,read):
 """One original two-lock window owner after the full restore has closed."""
 import sys
 root_parent=Path('/root/sabalan-recovery-private/native-qa/wal-windows')
 if not root_parent.exists():root_parent.mkdir(mode=0o700)
 assert root_parent.resolve(strict=True)==root_parent and root_parent.lstat().st_uid==0 and root_parent.lstat().st_mode&0o777==0o700
 fsync_parent(root_parent.parent)
 print(json.dumps(dict(event='INDEPENDENT_GUARDIAN_READY',operation=config['operation'],originalGuardianPid=os.getpid(),originalNodePid=None,standalone=True,productionAdmission=False)),flush=True)
 raw=sys.stdin.buffer.readline(2*1024**2+1);assert raw and len(raw)<=2*1024**2 and raw.endswith(b'\n')
 value=json.loads(raw);assert value['event']=='WAL_WINDOW_BEGIN';wanted=value['request'];total=request(wanted);checksum=digest(wanted);assert value['requestSha256']==checksum
 space=os.statvfs(root_parent);assert space.f_bavail*space.f_frsize>=total+MAX_PLAIN+64*1024**2
 memory=Path('/proc/meminfo').read_text();available=re.search(r'^MemAvailable:\s+(\d+) kB$',memory,re.M);assert available and int(available.group(1))*1024>=384*1024**2
 root=root_parent/checksum;root.mkdir(mode=0o700);(root/'ciphertexts').mkdir(mode=0o700);fsync_parent(root_parent)
 for row in wanted['objects']:
  transfer=dict(event='WAL_WINDOW_CIPHER',role=row['name'],requestSha256=checksum,path=str(root/'ciphertexts'/row['name']),bytes=row['bytes'],sha256=row['sha256'])
  helper.receive_owned(sys.stdin.buffer,Path(transfer['path']),transfer)
 verified=verify_original(config,value,root,read);print(json.dumps(verified),flush=True)
 print(json.dumps(dict(event='WAL_WINDOW_DRAIN_REQUEST',operation=config['operation'])),flush=True)
 drained=False;stored=None
 while not drained or stored is None:
  raw=sys.stdin.buffer.readline(131073);assert raw and len(raw)<=131072 and raw.endswith(b'\n');item=json.loads(raw)
  if item['event']=='WAL_WINDOW_PRODUCER_DRAINED':assert not drained;drained=True
  elif item['event']=='WAL_WINDOW_CERTIFICATE_ACK':
   assert stored is None and item['requestSha256']==checksum;stored=store_certificate_original(config,item,root,read);print(json.dumps(stored),flush=True)
  else:raise RuntimeError('ORIGINAL_STANDALONE_WAL_INPUT_REFUSED')
 print(json.dumps(dict(format='sabalan-original-independent-wal-window-launch/v1',operation=config['operation'],requestSha256=checksum,originalGuardianPid=os.getpid(),originalVerifierPid=verified['originalVerifierPid'],originalVerifierReturncode=0,originalCertificateVerifierPid=stored['originalCertificateVerifierPid'],originalCertificateVerifierReturncode=0,certificateSha256=stored['certificateSha256'],remoteDependencyFile=stored['remoteDependencyFile'],dependencySha256=stored['dependencySha256'],productionAdmission=False,**{'pass':True})),flush=True)


def promote_window_repository(config,root,repository,final_repository):
 point=config['onlinePhysicalPoint'];raw=(root/'dependency.json').read_bytes();dependency=json.loads(raw)
 if dependency['format']=='sabalan-independent-certified-wal-prepoint-dependency/v1':
  binding=json.loads((root/'point-binding.json').read_bytes());assert binding['originalDependencySha256']==hashlib.sha256(raw).hexdigest() and binding['sourceOwner']==dependency['sourceOwner'];dependency={**dependency,'format':'sabalan-independent-certified-wal-dependency/v1','basePoint':binding['basePoint']}
 assert dependency['format']=='sabalan-independent-certified-wal-dependency/v1' and dependency['basePoint']['sealedManifestSha256']==point['sealedSha256'] and dependency['basePoint']['plaintextManifestSha256']==point['manifestSha256']
 checksum=dependency['requestSha256'];assert re.fullmatch('[a-f0-9]{64}',checksum) and root.name==checksum
 target=repository/'wal-windows'/checksum;assert not target.exists() and target.parent.resolve(strict=True)==target.parent;target.mkdir(mode=0o700);(target/'ciphertexts').mkdir(mode=0o700);fsync_parent(target.parent)
 allowed={'input.json','request.json','seal.json','capture.json','verification.json','certificate-input.json','certificate.json','dependency.json','original-source.json','ciphertexts'}
 if (root/'point-binding.json').exists():allowed.add('point-binding.json')
 assert set(path.name for path in root.iterdir())==allowed
 files=[];transitions=[]
 for name in sorted(allowed-{'ciphertexts','dependency.json'}):
  source=root/name;assert source.resolve(strict=True)==source and source.stat().st_uid==0 and source.stat().st_nlink==1 and not source.stat().st_mode&0o077 and source.stat().st_size<=2*1024**2
  content=source.read_bytes();write(target/name,content);files.append(dict(relativePath=name,bytes=len(content),sha256=hashlib.sha256(content).hexdigest()))
 write(target/'original-dependency.json',raw)
 expected_names={row['name'] for row in dependency['objects']};assert set(path.name for path in (root/'ciphertexts').iterdir())==expected_names
 for row in dependency['objects']:
  source=root/'ciphertexts'/row['name'];destination=target/'ciphertexts'/row['name'];assert str(source)==row['path'] and source.resolve(strict=True)==source
  fd=os.open(source,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
  try:
   before=os.fstat(fd);assert stat.S_ISREG(before.st_mode) and before.st_uid==0 and before.st_nlink==1 and before.st_size==row['bytes'] and before.st_dev==target.stat().st_dev and not before.st_mode&0o077
   def digest_fd():
    os.lseek(fd,0,0);h=hashlib.sha256()
    while data:=os.read(fd,262144):h.update(data)
    return h.hexdigest()
   assert digest_fd()==row['sha256'];assert (before.st_dev,before.st_ino,before.st_size)==(source.stat().st_dev,source.stat().st_ino,source.stat().st_size)
   os.rename(source,destination);fsync_parent(source.parent);fsync_parent(destination.parent)
   assert digest_fd()==row['sha256'] and (os.fstat(fd).st_dev,os.fstat(fd).st_ino)==(destination.stat().st_dev,destination.stat().st_ino) and os.fstat(fd).st_nlink==1
   transitions.append(dict(sourcePath=str(source),destinationRelativePath='ciphertexts/'+row['name'],device=before.st_dev,inode=before.st_ino,bytes=row['bytes'],sha256=row['sha256'],method='SAME_DEVICE_OWNED_RENAME_FULL_READBACK'))
  finally:os.close(fd)
 custody=dict(format='sabalan-online-wal-repository-custody/v1',requestSha256=checksum,sourceDirectory=str(root),destinationDirectory=str(final_repository/'wal-windows'/checksum),transitions=transitions,productionAdmission=False);custody_raw=frame(custody);write(target/'custody.json',custody_raw)
 index=dict(format='sabalan-online-certified-wal-dependency/v1',certificateAcceptedAt=dependency['certificateAcceptedAt'],basePoint=dependency['basePoint'],requestSha256=checksum,windowSha256=dependency['windowSha256'],deploymentId=dependency['deploymentId'],releaseId=dependency['releaseId'],sourceIdentity=dependency['sourceIdentity'],objects=[dict(name=row['name'],relativePath='ciphertexts/'+row['name'],bytes=row['bytes'],sha256=row['sha256']) for row in dependency['objects']],files=files,originalDependencyFile='original-dependency.json',originalDependencySha256=hashlib.sha256(raw).hexdigest(),custodyFile='custody.json',custodySha256=hashlib.sha256(custody_raw).hexdigest(),certificateFile='certificate.json',certificateSha256=dependency['certificateSha256'],productionAdmission=False)
 index_raw=frame(index);write(target/'dependency.json',index_raw);seal_repository_modes(target)
 verify_repository_objects(target,[dict(row,kind='WAL',name=row['name']) for row in index['objects']]+files)
 assert (target/'dependency.json').read_bytes()==index_raw
 write(root/'repository-publication.json',frame(dict(format='sabalan-online-wal-repository-publication/v1',requestSha256=checksum,destinationDirectory=str(final_repository/'wal-windows'/checksum),dependencySha256=hashlib.sha256(index_raw).hexdigest())))
 return dict(file=str(final_repository/'wal-windows'/checksum/'dependency.json'),sha256=hashlib.sha256(index_raw).hexdigest(),requestSha256=checksum,relativeDirectory='wal-windows/'+checksum,originalDependencySha256=hashlib.sha256(raw).hexdigest(),certificateSha256=dependency['certificateSha256'])


def promote_closed_windows(config,repository,final_repository):
 parent=Path('/root/sabalan-recovery-private/native-qa/wal-windows');result=[]
 if not parent.exists():return result
 children=list(parent.iterdir());assert len(children)<=10000
 for root in children:
  assert re.fullmatch('[a-f0-9]{64}',root.name) and root.resolve(strict=True)==root and root.is_dir()
  file=root/'dependency.json'
  # Missing closure/index cannot be treated as empty or safe to forget.
  assert file.is_file(),'UNCLASSIFIED_OR_INCOMPLETE_WAL_WINDOW'
  value=json.loads(file.read_bytes())
  binding=json.loads((root/'point-binding.json').read_bytes()) if (root/'point-binding.json').exists() else None
  base_point=value['basePoint'] or (binding['basePoint'] if binding else None)
  if base_point and base_point['sealedManifestSha256']==config['onlinePhysicalPoint']['sealedSha256']:
   assert not (root/'repository-publication.json').exists();result.append(promote_window_repository(config,root,repository,final_repository))
 return result


def promote_physical_repository(config,source,read):
 import pwd
 point=config['onlinePhysicalPoint'];capture=point['captureId'];assert re.fullmatch('[a-f0-9]{64}',capture)
 base=Path('/srv/sabalanerp-recovery/checkpoints');assert base.resolve(strict=True)==base
 account=pwd.getpwnam('sabalan-backup');assert account.pw_uid==997 and account.pw_gid==997
 assert base.lstat().st_uid==997 and base.lstat().st_gid==997 and base.lstat().st_mode&0o777==0o700
 final=base/('online-'+capture);pending=base/('.online-'+capture+'-'+config['operation']+'.pending')
 assert not final.exists() and not pending.exists()
 sources=source['publicationInputs'];metadata_bytes=sum(sources[key]['bytes'] for key in ('physicalReport','originalProducer'))+sum(row['bytes'] for row in sources['imageArchiveReceipts'].values())+Path(point['sealedFile']).stat().st_size+Path(point['manifestFile']).stat().st_size+sum(Path(row['metadataPath']).stat().st_size for row in sources['imageCipherSources'].values())
 space=os.statvfs(base);assert space.f_bavail*space.f_frsize>=metadata_bytes*3+64*1024**2,'REPOSITORY_METADATA_COPY_CAPACITY'
 intent=dict(format='sabalan-online-repository-promotion-intent/v1',captureId=capture,sourcePointDirectory=point['root'],destinationDirectory=str(final),pendingDirectory=str(pending),sealedManifestSha256=point['sealedSha256'],physicalCompletionSha256=source['physicalCompletionSha256'],imageSources=sources['imageCipherSources'],componentSources=point['cipherPaths'],originalGuardianPid=os.getpid(),productionAdmission=False)
 write(Path(point['root'])/'repository-promotion-intent.json',frame(intent));pending.mkdir(mode=0o700);fsync_parent(base)
 before_device=base.stat().st_dev;objects=[];transitions=[];sources=source['publicationInputs']
 def bytes_object(kind,name,relative,raw,expected):
  assert hashlib.sha256(raw).hexdigest()==expected;target=pending/relative
  if not target.parent.exists():target.parent.mkdir(mode=0o700)
  write(target,raw);objects.append(dict(kind=kind,name=name,relativePath=relative,bytes=len(raw),sha256=expected))
 def raw_owned(value):
  raw=base64.b64decode(value['rawBase64'],validate=True);assert len(raw)==value['bytes'] and hashlib.sha256(raw).hexdigest()==value['sha256'];return raw
 def move_cipher(kind,name,file,relative,count,checksum):
  file=Path(file);assert file.resolve(strict=True)==file and file.is_relative_to(Path('/root/sabalan-recovery-private'))
  fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
  try:
   before=os.fstat(fd);assert stat.S_ISREG(before.st_mode) and before.st_uid==0 and before.st_nlink==1 and not before.st_mode&0o077 and before.st_size==count and before.st_dev==before_device
   pin=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_uid,s.st_mode,s.st_nlink)
   def hash_fd():
    os.lseek(fd,0,0);h=hashlib.sha256()
    while data:=os.read(fd,262144):h.update(data)
    return h.hexdigest()
   assert hash_fd()==checksum and pin(before)==pin(os.fstat(fd))==pin(file.lstat())
   target=pending/relative
   if not target.parent.exists():target.parent.mkdir(mode=0o700)
   assert not target.exists();os.rename(file,target);fsync_parent(file.parent);fsync_parent(target.parent)
   after=os.fstat(fd);named=target.lstat();assert (after.st_dev,after.st_ino,after.st_size)==(before.st_dev,before.st_ino,count)==(named.st_dev,named.st_ino,named.st_size)
   assert after.st_nlink==1 and hash_fd()==checksum and not file.exists()
   transitions.append(dict(kind=kind,name=name,sourcePath=str(file),destinationRelativePath=relative,device=before.st_dev,inode=before.st_ino,bytes=count,sha256=checksum,method='SAME_DEVICE_OWNED_RENAME_FULL_READBACK',originalSourceUid=before.st_uid,originalSourceMode=oct(stat.S_IMODE(before.st_mode))))
   objects.append(dict(kind=kind,name=name,relativePath=relative,bytes=count,sha256=checksum))
  finally:os.close(fd)
 sealed_file=Path(point['sealedFile']);manifest_file=Path(point['manifestFile']);sealed_raw=read(sealed_file,point['sealedSha256']);manifest_raw=read(manifest_file,point['manifestSha256'])
 assert hashlib.sha256(sealed_raw).hexdigest()==point['sealedSha256'] and hashlib.sha256(manifest_raw).hexdigest()==point['manifestSha256']
 sealed=json.loads(sealed_raw);inventory=[dict(name=row['name'],bytes=row['cipherBytes'],sha256=row['cipherSha256']) for row in sealed['objects']]
 assert digest(inventory)==source['cipherInventorySha256'] and set(point['cipherPaths'])==set(row['name'] for row in inventory)
 bytes_object('SEALED_MANIFEST','sealed','sealed.json',sealed_raw,point['sealedSha256']);bytes_object('PLAINTEXT_MANIFEST','manifest','manifest.json',manifest_raw,point['manifestSha256'])
 producer=raw_owned(sources['originalProducer']);bytes_object('PRODUCER','producer','producer.json',producer,sources['originalProducer']['sha256'])
 report_raw=raw_owned(sources['physicalReport']);report=json.loads(report_raw);assert report['physicalAndThreeApplicationsQualified'] is True and report['pass'] is True and report['continuousWalQualified'] is False
 bytes_object('PHYSICAL_REPORT','original-physical-report','physical-report.json',report_raw,sources['physicalReport']['sha256'])
 for row in inventory:
  assert re.fullmatch('[A-Za-z0-9_.-]{1,160}',row['name']) and row['name'] not in ('.','..')
  move_cipher('COMPONENT',row['name'],point['cipherPaths'][row['name']],'components/'+row['name']+'.sabrec',row['bytes'],row['sha256'])
 images={}
 assert set(sources['imageCipherSources'])==set(sources['images'])==set(sources['sourceImages'])==set(sources['imageGraphs'])=={'backend','frontend','inquiry'}
 for role in ('backend','frontend','inquiry'):
  selected=sources['imageCipherSources'][role];graph=sources['imageGraphs'][role]
  assert graph['config']==sources['images'][role] and graph['index']==sources['sourceImages'][role]
  stages=[row for row in report['imageStages'] if row['role']==role];assert len(stages)==1
  ready=stages[0]['ready'];assert ready['image']==graph['config'] and ready['sourceImage']==graph['index'] and ready['decryption']['fullGcmAuthenticated'] is True and ready['decryption']['plaintextSha256']==graph['archiveSha256'] and ready['expandedMeasurement']['expandedLayerIdentityVerified'] is True
  assert stages[0]['closed']['encryptedSourcePreserved'] is True
  metadata_file=Path(selected['metadataPath']);assert metadata_file.resolve(strict=True)==metadata_file and metadata_file.is_relative_to(Path('/root/sabalan-recovery-private'))
  metadata_raw=read(metadata_file,selected['metadataSha256']);assert hashlib.sha256(metadata_raw).hexdigest()==selected['metadataSha256']
  encryption=json.loads(metadata_raw)['encryption']['images'][role]
  assert encryption['cipherBytes']==selected['bytes'] and encryption['cipherSha256']==selected['sha256'] and encryption['sourceSha256']==graph['archiveSha256'] and encryption['sourceImageId']==graph['index']
  receipt=raw_owned(sources['imageArchiveReceipts'][role]);bytes_object('IMAGE_ARCHIVE_RECEIPT',role,'images/'+role+'-archive-receipt.json',receipt,sources['imageArchiveReceipts'][role]['sha256'])
  bytes_object('IMAGE_ENCRYPTION_METADATA',role,'images/'+role+'-encryption.json',metadata_raw,selected['metadataSha256'])
  relative='images/'+role+'.sabrec';move_cipher('IMAGE_ARCHIVE',role,selected['path'],relative,selected['bytes'],selected['sha256'])
  images[role]=dict(sourceImageId=graph['index'],configImageId=graph['config'],archiveGraph=graph,cipherRelativePath=relative,cipherBytes=selected['bytes'],cipherSha256=selected['sha256'],archiveReceiptRelativePath='images/'+role+'-archive-receipt.json',archiveReceiptSha256=sources['imageArchiveReceipts'][role]['sha256'])
 # Every original source proof remains historical at its original QA path.
 # Only exact owned encrypted payloads move; this NEW map records the custody
 # transition and is never substituted into the prior physical token.
 custody=dict(format='sabalan-online-repository-custody/v1',captureId=capture,physicalCompletionSha256=source['physicalCompletionSha256'],sourcePointDirectory=point['root'],destinationDirectory=str(final),destinationUid=997,destinationGid=997,destinationFileMode='0600',transitions=transitions,productionAdmission=False)
 custody_raw=frame(custody);write(pending/'publication-custody.json',custody_raw)
 return dict(pending=pending,final=final,objects=objects,images=images,custody=custody,custodySha256=hashlib.sha256(custody_raw).hexdigest(),physicalReportSha256=sources['physicalReport']['sha256'])


def verify_repository_objects(directory,objects):
 assert directory.resolve(strict=True)==directory
 seen=set()
 for row in objects:
  relative=row['relativePath'];assert isinstance(relative,str) and relative not in seen and not relative.startswith('/') and '..' not in Path(relative).parts and '\\' not in relative
  seen.add(relative);file=directory/relative;assert file.resolve(strict=True)==file
  fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
  try:
   before=os.fstat(fd);assert stat.S_ISREG(before.st_mode) and before.st_uid==997 and before.st_gid==997 and before.st_mode&0o777==0o600 and before.st_nlink==1 and before.st_size==row['bytes']
   h=hashlib.sha256()
   while data:=os.read(fd,262144):h.update(data)
   pin=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_uid,s.st_gid,s.st_mode,s.st_nlink)
   assert h.hexdigest()==row['sha256'] and pin(before)==pin(os.fstat(fd))==pin(file.lstat())
  finally:os.close(fd)
 return len(seen)


def seal_repository_modes(directory):
 for file in directory.rglob('*'):
  assert file.resolve(strict=True)==file and not file.is_symlink()
  if file.is_file():os.chown(file,997,997);os.chmod(file,0o600)
 for child in sorted([path for path in directory.rglob('*') if path.is_dir()],key=lambda p:len(p.parts),reverse=True):os.chown(child,997,997);os.chmod(child,0o700);fsync_parent(child)
 os.chown(directory,997,997);os.chmod(directory,0o700);fsync_parent(directory)


def promote_repository_original(config,source,read):
 assert source['format']=='sabalan-original-physical-repository-promotion-input/v1'
 point=config['onlinePhysicalPoint'];assert source['sealedManifestSha256']==point['sealedSha256'] and source['plaintextManifestSha256']==point['manifestSha256']
 promoted=promote_physical_repository(config,source,read);pending=promoted['pending'];final=promoted['final']
 (pending/'wal-windows').mkdir(mode=0o700)
 initial_windows=promote_closed_windows(config,pending,final)
 material=dict(format='sabalan-online-recovery-material/v1',captureId=point['captureId'],sealedManifestSha256=point['sealedSha256'],plaintextManifestSha256=point['manifestSha256'],cipherInventorySha256=source['cipherInventorySha256'],physicalCompletionSha256=source['physicalCompletionSha256'],physicalReportSha256=promoted['physicalReportSha256'],sourceDatabase=source['publicationInputs']['sourceDatabase'],restorePoint=source['publicationInputs']['restorePoint'],objects=promoted['objects'],images=promoted['images'],custodyFile='publication-custody.json',custodySha256=promoted['custodySha256'],walWindowDirectory='wal-windows',initialWalWindows=initial_windows,productionAdmission=False)
 material_raw=frame(material);write(pending/'recovery-material.json',material_raw);seal_repository_modes(pending);verify_repository_objects(pending,promoted['objects'])
 os.rename(pending,final);fsync_parent(final.parent);assert (final/'recovery-material.json').read_bytes()==material_raw
 descriptor=dict(format='sabalan-online-checkpoint-directory/v1',captureId=point['captureId'],repository='independent-recovery',mountPath='/mnt/sabalanerp-independent-recovery/online-'+point['captureId'],sftpPath='/checkpoints/online-'+point['captureId'],sealedManifestSha256=point['sealedSha256'],plaintextManifestSha256=point['manifestSha256'],cipherInventorySha256=source['cipherInventorySha256'],materialIndexSha256=hashlib.sha256(material_raw).hexdigest())
 write(Path(point['root'])/'repository-publication.json',frame(dict(format='sabalan-online-repository-publication/v1',destinationDirectory=str(final),materialIndexSha256=descriptor['materialIndexSha256'],custodySha256=promoted['custodySha256'],physicalCompletionSha256=source['physicalCompletionSha256'])))
 return dict(format='sabalan-original-independent-physical-repository-promotion/v1',repositoryDescriptor=descriptor,sealedManifestSha256=point['sealedSha256'],plaintextManifestSha256=point['manifestSha256'],cipherInventorySha256=source['cipherInventorySha256'],physicalCompletionSha256=source['physicalCompletionSha256'],repositoryDirectory=str(final),productionMountDirectory=descriptor['mountPath'],materialIndexRawBase64=base64.b64encode(material_raw).decode(),materialIndexSha256=descriptor['materialIndexSha256'],custodyRawBase64=base64.b64encode(frame(promoted['custody'])).decode(),custodySha256=promoted['custodySha256'],allRetainedCiphertextsRehashed=True,fsyncFileAndDirectory=True,fullReadbackVerified=True,originalGuardianPid=os.getpid(),productionAdmission=False)


def publish_physical_metadata(config,source):
 point=config['onlinePhysicalPoint'];assert source['format']=='sabalan-original-physical-metadata-publication-input/v1'
 assert source['sealedManifestSha256']==point['sealedSha256'] and source['plaintextManifestSha256']==point['manifestSha256']
 directory=Path('/srv/sabalanerp-recovery/checkpoints')/('online-'+point['captureId']);assert directory.resolve(strict=True)==directory
 material_file=directory/'recovery-material.json';material_raw=material_file.read_bytes();assert hashlib.sha256(material_raw).hexdigest()==source['materialIndexSha256'];material=json.loads(material_raw)
 assert material['format']=='sabalan-online-recovery-material/v1' and material['captureId']==point['captureId'] and material['physicalCompletionSha256']==source['physicalCompletionSha256']
 for key in ['sealedManifestSha256','plaintextManifestSha256','cipherInventorySha256']:assert material[key]==source[key]
 verify_repository_objects(directory,material['objects'])
 custody_raw=(directory/material['custodyFile']).read_bytes();assert hashlib.sha256(custody_raw).hexdigest()==material['custodySha256']
 raw=base64.b64decode(source['canonicalMetadataRawBase64'],validate=True);assert 0<len(raw)<=8*1024**2
 metadata=json.loads(raw);canonical_sha=digest(metadata);assert canonical_sha==source['canonicalMetadataSha256']
 assert metadata['captureMethod']=='ONLINE_COHERENT_WAL' and metadata['physicalPoint']==dict(sealedManifestSha256=point['sealedSha256'],plaintextManifestSha256=point['manifestSha256'],cipherInventorySha256=source['cipherInventorySha256'],restorePoint=material['restorePoint'])
 assert metadata['remotePath']=='/mnt/sabalanerp-independent-recovery/online-'+point['captureId'] and metadata['repositoryDirectory']==source['repositoryDescriptor']
 envelope=frame(dict(**metadata,canonicalMetadata=metadata,canonicalMetadataSha256=canonical_sha));write(directory/'canonical-checkpoint.json',envelope)
 index=dict(material,format='sabalan-online-recovery-point/v1',canonicalMetadataSha256=canonical_sha,canonicalMetadataFile='canonical-checkpoint.json',canonicalMetadataFileSha256=hashlib.sha256(envelope).hexdigest(),materialIndexFile='recovery-material.json',materialIndexSha256=source['materialIndexSha256'])
 index_raw=frame(index);write(directory/'point.json',index_raw)
 for file in [directory/'canonical-checkpoint.json',directory/'point.json']:os.chown(file,997,997);os.chmod(file,0o600)
 fsync_parent(directory);assert (directory/'canonical-checkpoint.json').read_bytes()==envelope and (directory/'point.json').read_bytes()==index_raw
 return dict(format='sabalan-original-independent-physical-metadata-publication/v1',canonicalMetadataSha256=canonical_sha,sealedManifestSha256=point['sealedSha256'],plaintextManifestSha256=point['manifestSha256'],cipherInventorySha256=source['cipherInventorySha256'],physicalCompletionSha256=source['physicalCompletionSha256'],repositoryPromotionSha256=source['repositoryPromotionSha256'],repositoryDescriptor=source['repositoryDescriptor'],remoteMetadataFile=str(directory/'canonical-checkpoint.json'),remoteMetadataSha256=hashlib.sha256(envelope).hexdigest(),remoteMetadataBytes=len(envelope),metadataRawBase64=base64.b64encode(envelope).decode(),repositoryDirectory=str(directory),productionMountDirectory=metadata['remotePath'],pointIndexRawBase64=base64.b64encode(index_raw).decode(),pointIndexSha256=hashlib.sha256(index_raw).hexdigest(),materialIndexSha256=source['materialIndexSha256'],custodyRawBase64=base64.b64encode(custody_raw).decode(),custodySha256=material['custodySha256'],allRetainedCiphertextsRehashed=True,fsyncFileAndDirectory=True,fullReadbackVerified=True,originalGuardianPid=os.getpid(),productionAdmission=False)


def verify_point_original(config,directory):
 raw=(directory/'point.json').read_bytes();index=json.loads(raw);assert index['format']=='sabalan-online-recovery-point/v1'
 verify_repository_objects(directory,index['objects'])
 for name,checksum in [(index['materialIndexFile'],index['materialIndexSha256']),(index['canonicalMetadataFile'],index['canonicalMetadataFileSha256']),(index['custodyFile'],index['custodySha256'])]:
  file=directory/name;assert file.resolve(strict=True)==file and hashlib.sha256(file.read_bytes()).hexdigest()==checksum
 return raw,index


def run_public_verifier(config,root,material,read):
 public=Path(config['bundleRoot'])/'online-qualification-public-key.pem';read(public,config['sourcePins'][public.name],4096)
 worker=Path(config['bundleRoot'])/'independent-wal-window.worker.cjs';read(worker,config['sourcePins'][worker.name],1024**2)
 material=dict(material,publicKeyFile=str(public),publicKeySha256=config['sourcePins'][public.name]);raw=frame(material);file=root/'public-verifier-input.json';write(file,raw)
 child=subprocess.Popen([config['nodeExecutable'],'--max-old-space-size=128',str(worker),str(file),hashlib.sha256(raw).hexdigest()],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(9,10))
 out,err=child.communicate();assert child.returncode==0 and len(out)<=65536 and len(err)<=65536 and child.stdout.closed and child.stderr.closed
 value=json.loads(out);assert value['productionAdmission'] is False
 return value,dict(pid=child.pid,code=child.returncode,signal=None)


def certify_point_original(config,source,read):
 assert source['format']=='sabalan-original-physical-certification-input/v1';point=config['onlinePhysicalPoint'];directory=Path('/srv/sabalanerp-recovery/checkpoints')/('online-'+point['captureId'])
 point_raw,index=verify_point_original(config,directory);assert hashlib.sha256(point_raw).hexdigest()==source['pointIndexSha256'] and index['materialIndexSha256']==source['materialIndexSha256'] and index['canonicalMetadataSha256']==source['canonicalMetadataSha256']
 private=Path(point['root'])/'certification-ack';private.mkdir(mode=0o700)
 verified,child=run_public_verifier(config,private,dict(format='sabalan-original-independent-point-certificates-input/v1',certificates=source['certificates'],expected=source['expected']),read)
 accepted=verified['acceptedAt'];files={'physical':'physical-verification.json','repository':'repository-promotion.json','metadataPublication':'publication-verification.json'};descriptors={}
 for role,name in files.items():
  raw=frame(source['certificates'][role]);write(directory/name,raw);os.chown(directory/name,997,997);os.chmod(directory/name,0o600)
  descriptors[role]=dict(relativePath=name,sha256=hashlib.sha256(raw).hexdigest(),acceptedAt=accepted)
 certification=dict(format='sabalan-online-recovery-point-certification/v1',pointIndexSha256=source['pointIndexSha256'],materialIndexSha256=source['materialIndexSha256'],canonicalMetadataSha256=source['canonicalMetadataSha256'],certificates=descriptors)
 raw=frame(certification);write(directory/'certification.json',raw);os.chown(directory/'certification.json',997,997);os.chmod(directory/'certification.json',0o600);fsync_parent(directory)
 for role,name in files.items():assert hashlib.sha256((directory/name).read_bytes()).hexdigest()==descriptors[role]['sha256']
 assert (directory/'certification.json').read_bytes()==raw
 return dict(format='sabalan-original-independent-physical-certification-ack/v1',pointIndexSha256=source['pointIndexSha256'],materialIndexSha256=source['materialIndexSha256'],canonicalMetadataSha256=source['canonicalMetadataSha256'],remoteCertificationFile=str(directory/'certification.json'),certificationRawBase64=base64.b64encode(raw).decode(),certificationSha256=hashlib.sha256(raw).hexdigest(),certificates=descriptors,originalPublicVerifier=child,allIndexedObjectsRehashed=True,fullReadbackVerified=True,fsyncFileAndDirectory=True,productionAdmission=False)


def verify_window_repository(directory):
 file=directory/'dependency.json';raw=file.read_bytes();index=json.loads(raw);assert index['format']=='sabalan-online-certified-wal-dependency/v1'
 verify_repository_objects(directory,index['objects']+index['files'])
 for key,checksum in [(index['originalDependencyFile'],index['originalDependencySha256']),(index['custodyFile'],index['custodySha256']),(index['certificateFile'],index['certificateSha256'])]:
  assert hashlib.sha256((directory/key).read_bytes()).hexdigest()==checksum
 return raw,index


def persist_terminal_original(config,source,read):
 assert source['format']=='sabalan-original-terminal-coverage-persistence-input/v1';point=config['onlinePhysicalPoint'];directory=Path('/srv/sabalanerp-recovery/checkpoints')/('online-'+point['captureId'])
 point_raw,index=verify_point_original(config,directory);assert hashlib.sha256(point_raw).hexdigest()==source['pointIndexSha256'] and index['canonicalMetadataSha256']==source['canonicalMetadataSha256']
 certification=(directory/'certification.json').read_bytes();assert hashlib.sha256(certification).hexdigest()==source['certificationSha256']
 raw=base64.b64decode(source['terminalRawBase64'],validate=True);assert len(raw)==source['terminalBytes'] and hashlib.sha256(raw).hexdigest()==source['terminalResultSha256']
 result=json.loads(raw);assert result['format']=='sabalan-original-terminal-wal-coverage/v1' and result['phase']=='COMPLETE' and result['allOriginalChildrenClosed'] is True and result['finalIntervalCompletion'] is True and result['captureId']==point['captureId']
 actual=[];windows=directory/'wal-windows';children=list(windows.iterdir());assert 0<len(children)<=10000
 for child in children:
  assert re.fullmatch('[a-f0-9]{64}',child.name) and child.resolve(strict=True)==child and child.is_dir()
  dependency_raw,dependency=verify_window_repository(child);actual.append(dict(requestSha256=child.name,dependencySha256=hashlib.sha256(dependency_raw).hexdigest()))
  matches=[row for row in result['windows'] if row['requestSha256']==child.name];assert len(matches)==1 and matches[0]['windowSha256']==dependency['windowSha256'] and matches[0]['certificateSha256']==dependency['certificateSha256']
 assert len(result['windows'])==len(actual);assert sorted(source['envelope']['decision']['windows'],key=lambda row:row['requestSha256'])==sorted(actual,key=lambda row:row['requestSha256'])
 private=Path(point['root'])/'terminal-coverage-ack';private.mkdir(mode=0o700)
 verified,child=run_public_verifier(config,private,dict(format='sabalan-original-independent-terminal-certificate-input/v1',envelope=source['envelope'],expected=source['expected']),read)
 write(directory/'terminal-result.json',raw);os.chown(directory/'terminal-result.json',997,997);os.chmod(directory/'terminal-result.json',0o600)
 accepted=dict(format='sabalan-accepted-online-terminal-coverage/v1',acceptedAt=verified['acceptedAt'],envelope=source['envelope']);accepted_raw=frame(accepted);write(directory/'terminal-coverage.json',accepted_raw);os.chown(directory/'terminal-coverage.json',997,997);os.chmod(directory/'terminal-coverage.json',0o600);fsync_parent(directory)
 assert (directory/'terminal-result.json').read_bytes()==raw and (directory/'terminal-coverage.json').read_bytes()==accepted_raw
 return dict(format='sabalan-original-independent-terminal-coverage-ack/v1',pointIndexSha256=source['pointIndexSha256'],canonicalMetadataSha256=source['canonicalMetadataSha256'],terminalResultSha256=source['terminalResultSha256'],remoteTerminalCoverageFile=str(directory/'terminal-coverage.json'),terminalCoverageRawBase64=base64.b64encode(accepted_raw).decode(),terminalCoverageSha256=hashlib.sha256(accepted_raw).hexdigest(),windows=actual,originalPublicVerifier=child,allIndexedObjectsRehashed=True,allWindowObjectsRehashed=True,fullReadbackVerified=True,fsyncFileAndDirectory=True,productionAdmission=False)


def receive_physical_point(config,source,helper,read):
 assert source['format']=='sabalan-original-independent-physical-point-transfer-input/v1';r=source['request'];assert r['format']=='sabalan-original-physical-point-transfer-request/v1' and re.fullmatch('[a-f0-9]{64}',r['captureId']) and re.fullmatch('[a-f0-9]{32}',source['operation'])
 capture=r['captureId'];root=Path('/root/sabalan-recovery-private/native-qa')/('online-point-'+capture)
 assert not root.exists() and root.parent.resolve(strict=True)==root.parent
 metadata={}
 for key in ('producer','plaintextManifest','sealedManifest'):
  value=source['ownedOutputs'][key];raw=base64.b64decode(value['rawBase64'],validate=True);assert len(raw)==value['bytes'] and 0<len(raw)<=8*1024**2 and hashlib.sha256(raw).hexdigest()==value['sha256'];metadata[key]=raw
 sealed=json.loads(metadata['sealedManifest']);manifest=json.loads(metadata['plaintextManifest']);producer=json.loads(metadata['producer'])
 assert sealed['operation']==manifest['operation']==producer['captureId']==capture and sealed['manifestSha256']==producer['manifestSha256']==hashlib.sha256(metadata['plaintextManifest']).hexdigest()
 assert re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,62}',source['postgresUser'])
 native=json.loads(base64.b64decode(producer['captureClosure']['nativeRawBase64'],validate=True));assert native['phase']=='QUIESCENT' and native['nativeStatus']==0 and native['nativeReaped'] is True and native['databaseQuiet'] is True
 boot=native['guardian']['bootId'].strip().lower();assert hashlib.sha256(boot.encode()).hexdigest()==source['sourceHost']['kernelBootIdSha256']
 for key in ('machineUuidSha256','kernelBootIdSha256'):assert re.fullmatch('[a-f0-9]{64}',source['sourceHost'][key])
 inventory=[dict(name=row['name'],bytes=row['cipherBytes'],sha256=row['cipherSha256']) for row in sealed['objects']]
 assert digest(inventory)==source['cipherInventorySha256'] and 15<=len(inventory)<=8192 and len({row['name'] for row in inventory})==len(inventory)
 declared=[dict(name=row['name'],sourcePath=row['cipherFile'],bytes=row['cipherBytes'],sha256=row['cipherSha256']) for row in sealed['objects']];assert r['objects']==declared
 total=sum(row['bytes'] for row in inventory);assert total<=16*1024**3;space=os.statvfs(root.parent);assert space.f_bavail*space.f_frsize>=total+sum(len(raw) for raw in metadata.values())*2+64*1024**2
 root.mkdir(mode=0o700);(root/'ciphertexts').mkdir(mode=0o700);fsync_parent(root.parent)
 write(root/'producer.json',metadata['producer']);write(root/'manifest.json',metadata['plaintextManifest']);write(root/'sealed.json',metadata['sealedManifest'])
 cipher_paths={};proofs=[];checksum=digest(r)
 for row in inventory:
  assert re.fullmatch('[A-Za-z0-9_.-]{1,160}',row['name']) and row['name'] not in ('.','..') and type(row['bytes']) is int and 0<row['bytes']<=4*1024**3 and re.fullmatch('[a-f0-9]{64}',row['sha256'])
  target=root/'ciphertexts'/(row['name']+'.sabrec');wanted=dict(event='PHYSICAL_POINT_CIPHER',role=row['name'],requestSha256=checksum,path=str(target),bytes=row['bytes'],sha256=row['sha256'])
  proofs.append(helper.receive_owned(__import__('sys').stdin.buffer,target,wanted));cipher_paths[row['name']]=str(target)
 point=dict(sourceRuntimeId=source['sourceRuntimeId'],captureId=capture,postgresUser=source['postgresUser'],root=str(root),sealedFile=str(root/'sealed.json'),manifestFile=str(root/'manifest.json'),producerFile=str(root/'producer.json'),sealedSha256=hashlib.sha256(metadata['sealedManifest']).hexdigest(),manifestSha256=hashlib.sha256(metadata['plaintextManifest']).hexdigest(),producerSha256=hashlib.sha256(metadata['producer']).hexdigest(),sourceHost=source['sourceHost'],cipherPaths=cipher_paths)
 initial_bindings=bind_original_prepoint_windows(source,point,read)
 restored=dict(config);restored['operation']=source['operation'];restored['onlinePhysicalPoint']=point
 for key in ('checkpointMetadataPath','checkpointArchivePath','checkpointMetadataSha256','checkpointMetadataUid','checkpointArchiveUid','checkpointMetadataMode','checkpointArchiveMode'):restored.pop(key,None)
 import copy
 restored['images']=copy.deepcopy(config['images'])
 for role in ('backend','frontend','inquiry'):
  t=restored['images'][role]['transfer'];assert t['stagedFromOriginalSsh'] is True;t['cipherPath']='/root/sabalan-recovery-private/native-qa/full-restore-'+source['operation']+'/staged-ciphers/'+role+'.sabrec'
 config_raw=frame(restored);config_file=root/'full-restore-input.json';write(config_file,config_raw)
 result=dict(format='sabalan-original-independent-physical-point-transfer/v1',requestSha256=checksum,challenge=r['challenge'],captureId=capture,onlinePhysicalPoint=point,cipherInventorySha256=source['cipherInventorySha256'],configurationFile=str(config_file),configurationRawBase64=base64.b64encode(config_raw).decode(),configurationSha256=hashlib.sha256(config_raw).hexdigest(),transferProofs=proofs,sourceOriginalPid=source['sourceOriginalPid'],sourceRuntimeId=source['sourceRuntimeId'],initialWindowBindings=initial_bindings,fullCipherReadbackVerified=True,fsyncFileAndDirectory=True,productionAdmission=False)
 write(root/'original-transfer.json',frame(result));return result
