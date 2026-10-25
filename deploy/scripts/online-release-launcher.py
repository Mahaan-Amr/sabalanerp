#!/usr/bin/env python3
"""Own the real protected deploy and host signer from their first Popen.
Private os.pipe descriptors, never status-file approval, connect the ORIGINAL
maintenance boundary. An ambiguous reply retains these SAME handles forever.
"""
import base64, hashlib, fcntl, importlib.util, json, os, pathlib, queue, re, secrets, selectors, stat, subprocess, sys, threading, time
ROOT=pathlib.Path(__file__).resolve().parents[2]
originals=[]; logs=[]; frame_buffers={}
continuous_context_lock=threading.Lock();continuous_context_sequence=0
wal_transport_lock=threading.Lock()
continuous_request_fd=None;continuous_response_fd=None
original_master_port=None;checkpoint_producer=None;continuous_owner=None
class OriginalInputEOF(Exception):pass
class OriginalPredeployAborted(Exception):pass

class OriginalMasterPort:
 def __init__(self):
  self.writer_lock=threading.Lock();self.lock=threading.Lock();self.pending={};self.error=None;self.terminalClosing=False;self.closed=False
  self.thread=threading.Thread(target=self.read,name='original-master-response',daemon=False);self.thread.start()
 def expect(self,key):
  with self.lock:
   require(self.error is None and key not in self.pending);result=queue.Queue(maxsize=1);self.pending[key]=result;return result
 def receive(self,result):
  value=result.get();require(not isinstance(value,BaseException));return value
 def read(self):
  try:
   while True:
    value=frame(0,67108864);kind=value.get('format');decision=value.get('decision',{})
    if kind=='sabalan-signed-original-wal-window-verification/v1':key=('wal',decision.get('challenge'))
    elif kind=='sabalan-original-physical-point-verification-response/v1':key=('point',value.get('challenge'))
    elif kind=='sabalan-signed-physical-checkpoint-publication/v1':key=('metadata',decision.get('canonicalMetadataSha256'))
    elif kind=='sabalan-signed-online-terminal-coverage/v1':key=('terminal',decision.get('challenge'))
    elif kind=='sabalan-original-online-qualification-response/v1':key=('qualification',value.get('checkpointSha256'))
    else:raise RuntimeError('ORIGINAL_MASTER_REPLY_KIND_UNPROVEN')
    with self.lock:
     require(key in self.pending);target=self.pending.pop(key)
    target.put(value)
  except OriginalInputEOF as error:
   with self.lock:
    if self.terminalClosing and not self.pending:self.closed=True;return
    self.error=error
    for target in self.pending.values():target.put(error)
    self.pending.clear()
  except BaseException as error:
   with self.lock:
    self.error=error
    for target in self.pending.values():target.put(error)
    self.pending.clear()

def require(value):
 if not value:raise RuntimeError('ONLINE_ORIGINAL_LAUNCHER_UNPROVEN')
def encoded(value):return json.dumps(value,separators=(',',':'),sort_keys=True).encode()+b'\n'
def private(file):
 file=pathlib.Path(file);require(file.is_absolute() and file.resolve()==file)
 fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  before=os.fstat(fd);require(stat.S_ISREG(before.st_mode) and before.st_uid==0 and before.st_nlink==1 and before.st_mode&0o777==0o600 and 0<before.st_size<=8388608)
  data=bytearray()
  while len(data)<before.st_size:
   chunk=os.read(fd,min(262144,before.st_size-len(data)));require(chunk);data.extend(chunk)
  identity=lambda st:(st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns,st.st_uid,st.st_mode,st.st_nlink)
  require(not os.read(fd,1) and identity(before)==identity(os.fstat(fd))==identity(os.lstat(file)))
  return json.loads(data)
 finally:os.close(fd)

def prebuilt_release_arguments(selection):
 # This is content selection only. The original controller pipes, checkpoint,
 # independent restore and signed issuer still own every admission decision.
 require(isinstance(selection,dict) and set(selection)=={'file','sha256'})
 file=pathlib.Path(selection['file']);require(file.is_absolute() and file.resolve()==file and re.fullmatch('[a-f0-9]{64}',selection['sha256']))
 raw=immutable(file);value=file.lstat();require(value.st_mode&0o777==0o400 and hashlib.sha256(raw).hexdigest()==selection['sha256'])
 return ['--prebuilt-release',str(file),selection['sha256']]
def write(fd,data):
 offset=0
 while offset<len(data):
  count=os.write(fd,data[offset:]);require(count>0);offset+=count

def frame(fd,maximum=16384):
 data=frame_buffers.pop(fd,bytearray())
 while True:
  newline=data.find(b'\n')
  if newline>=0:
   require(newline<maximum);frame_buffers[fd]=data[newline+1:];return json.loads(data[:newline])
  require(len(data)<maximum)
  chunk=os.read(fd,min(65536,maximum-len(data)))
  if not chunk:
   require(not data)
   raise OriginalInputEOF()
  data.extend(chunk)

def receive_qualification_files(response,evidence,financial=False):
 # Metadata and each <=512KiB frame belong to this SAME original stdin. No
 # status file, parallel reader or generic command can fill a partial artifact.
 require(isinstance(response.get('files'),dict) and 1<=len(response['files'])<=128)
 if financial:
  names=['workerstdout','workerstderr','workeroriginal','outeractive','outerfinal','privateproof','sourcecheckpoint','currentmaterial','currentcompiled','currentimage','currentinspect','certificate']
  require(set(response['files'])=={'protected-financial-source.json',*['protected-financial-'+n+'.json' for n in names]})
 evidence=pathlib.Path(evidence);require(not evidence.exists() and evidence.parent.resolve()==evidence.parent)
 evidence.mkdir(mode=0o700);st=evidence.lstat();require(stat.S_ISDIR(st.st_mode) and st.st_uid==0 and st.st_mode&0o777==0o700)
 total=0
 for name,entry in sorted(response['files'].items()):
  require(re.fullmatch(r'[a-z0-9][a-z0-9_.-]{0,95}',name) and set(entry)=={'sha256','bytes'})
  maximum=65536 if name=='protected-financial-certificate.json' else 8388608 if name=='protected-financial-source.json' else 33554432 if name=='protected-financial-currentcompiled.json' else 41943040 if name=='protected-financial-workerstdout.json' else 16777216 if name.startswith('protected-financial-') else 8388608
  require(type(entry['bytes'])is int and (entry['bytes']>=0 if name=='protected-financial-workerstderr.json' else entry['bytes']>0) and entry['bytes']<=maximum and re.fullmatch('[a-f0-9]{64}',entry['sha256']))
  total+=entry['bytes'];require(total<=268435456)
  fd=os.open(evidence/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400);digest=hashlib.sha256();offset=0
  try:
   while offset<entry['bytes']:
    part=frame(0,524288)
    require(set(part)=={'format','sequence','file','offset','rawBase64'} and part['format']=='sabalan-original-qualification-chunk/v1' and type(part['sequence'])is int and part['sequence']==1 and part['file']==name and type(part['offset'])is int and part['offset']==offset)
    raw=base64.b64decode(part['rawBase64'],validate=True);require(base64.b64encode(raw).decode()==part['rawBase64'] and 0<len(raw)<=262144 and offset+len(raw)<=entry['bytes'])
    write(fd,raw);digest.update(raw);offset+=len(raw)
   require(offset==entry['bytes'] and digest.hexdigest()==entry['sha256']);os.fsync(fd)
  finally:os.close(fd)
  target=evidence/name;before=target.lstat();require(stat.S_ISREG(before.st_mode) and before.st_uid==0 and before.st_nlink==1 and before.st_mode&0o777==0o400 and before.st_size==entry['bytes'])
  readback=hashlib.sha256()
  with target.open('rb') as stream:
   for raw in iter(lambda:stream.read(262144),b''):readback.update(raw)
  require(readback.hexdigest()==entry['sha256'] and (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(target.lstat().st_dev,target.lstat().st_ino,target.lstat().st_size,target.lstat().st_mtime_ns,target.lstat().st_ctime_ns))
 directory=os.open(evidence,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(directory)
 finally:os.close(directory)
 return evidence

def project_original_control_result(sequence,command,result):
 require(type(sequence)is int and sequence>0 and isinstance(result,dict))
 value=dict(sequence=sequence,status='COMPLETED',command=command,releaseAcceptanceGranted=False)
 if command=='READ_CYCLE_PLAN':value['cyclePlan']=result['cyclePlan']
 elif command=='RETIRE_EXPIRED_BUILDS':value['retirement']=result['retirement']
 elif command=='READ_CLIENT_DETACH_BARRIER':
  value.update(clientDetachBarrier=result['clientDetachBarrier'],launcherCustody=result['launcherCustody'])
 elif command=='BUILD_PUBLICATION_REGISTRY':
  plan=result['publicationPlan']
  require(isinstance(plan,dict) and set(plan)=={'registry','expectedPublicationSha256','releaseId','previousReleaseId','rollback'})
  require(isinstance(plan['registry'],dict) and plan['registry'].get('format')=='sabalan-browser-routing/v2')
  require(plan['expectedPublicationSha256'] is None or isinstance(plan['expectedPublicationSha256'],str) and re.fullmatch('[a-f0-9]{64}',plan['expectedPublicationSha256']))
  require(isinstance(plan['releaseId'],str) and re.fullmatch('[a-zA-Z0-9_-]{8,128}',plan['releaseId']))
  require(plan['previousReleaseId'] is None or isinstance(plan['previousReleaseId'],str) and re.fullmatch('[a-zA-Z0-9_-]{8,128}',plan['previousReleaseId']))
  require(type(plan['rollback'])is bool)
  value['publicationPlan']=plan
 elif command=='PREPARE_RETAINED_ROLLBACK':
  plan=result['rollbackPlan']
  require(isinstance(plan,dict) and set(plan)=={'releaseId','jobsRuntimeIds'})
  require(isinstance(plan['releaseId'],str) and re.fullmatch('[a-zA-Z0-9_-]{8,128}',plan['releaseId']))
  require(isinstance(plan['jobsRuntimeIds'],list) and len(plan['jobsRuntimeIds'])==1 and isinstance(plan['jobsRuntimeIds'][0],str) and re.fullmatch('[a-f0-9]{64}',plan['jobsRuntimeIds'][0]))
  value['rollbackPlan']=dict(releaseId=plan['releaseId'],jobsRuntimeIds=[plan['jobsRuntimeIds'][0]])
 elif command=='CREATE_CHECKPOINT':
  require(result.get('checkpointCommitted') is True)
  value['checkpointCommitted']=result['checkpointCommitted']
 elif command=='QUALIFY_NEXT':
  require(result.get('originalOnlineQualificationBound') is True)
  value['originalOnlineQualificationBound']=result['originalOnlineQualificationBound']
 runtime_commands={'PREPARE_INQUIRY','START_INQUIRY','STOP_INQUIRY','START_RUNTIME','WAIT_READY','PREPARE_DRAIN','WAIT_PREPARED','SHUTDOWN','WAIT_CLOSED'}
 if command in runtime_commands and result.get('runtimeId') is not None:
  require(isinstance(result['runtimeId'],str) and re.fullmatch('[a-f0-9]{64}',result['runtimeId']))
  value['runtimeId']=result['runtimeId']
 if command=='PREPARE_INQUIRY':require('runtimeId'in value)
 return value

def original_controller_response(fd,command):
 large={'OBSERVE_PROTECTED_FINANCIAL_REQUEST','OBSERVE_BOOTSTRAP_REQUEST','OBSERVE_ONLINE_REQUEST','BUILD_BOOTSTRAP_MATERIAL','BUILD_ONLINE_MATERIAL',
  'PREPARE_CHECKPOINT_CAPTURE','PREPARE_CHECKPOINT_PUBLICATION','READ_CONTINUOUS_CONTEXT','PREPARE_FINISH_CONTEXT',
  'READ_CYCLE_PLAN','RETIRE_EXPIRED_BUILDS','READ_CLIENT_DETACH_BARRIER','BUILD_PUBLICATION_REGISTRY'}
 return frame(fd,8388608 if command in large else 16384)

def verify_original_wal_window(request,sealed_host_directory,capture_id):
 # Only the SAME original in-memory receiver manager calls this fixed port.
 # Keep every opened source inode until the original Windows response arrives.
 with wal_transport_lock:
  require(re.fullmatch(r'[a-f0-9]{64}',capture_id))
  directory=pathlib.Path(sealed_host_directory)
  require(directory.is_absolute() and directory.resolve()==directory and directory.is_dir())
  st=directory.stat();require(st.st_uid==0 and not st.st_mode&0o077)
  held=[]
  def opened(file,maximum):
   require(file.resolve()==file)
   fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
   before=os.fstat(fd);held.append((fd,before,file));require(stat.S_ISREG(before.st_mode) and before.st_uid==0 and before.st_nlink==1 and not before.st_mode&0o077 and 0<before.st_size<=maximum)
   return fd,before
  def pin(st):return (st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns,st.st_uid,st.st_mode,st.st_nlink)
  def raw(file):
   fd,before=opened(file,1048576);data=bytearray()
   while part:=os.read(fd,65536):data.extend(part);require(len(data)<=1048576)
   require(len(data)==before.st_size and pin(before)==pin(os.fstat(fd))==pin(file.lstat()));return bytes(data)
  seal_raw=raw(directory/'seal-state.json');closure_raw=raw(directory.parent/'capture-state.json');seal=json.loads(seal_raw)
  require(hashlib.sha256(seal_raw).hexdigest()==request['windowSha256'] and seal['captureSha256']==hashlib.sha256(closure_raw).hexdigest())
  require([dict(name=row['name'],bytes=row['encryptedBytes'],sha256=row['encryptedSha256']) for row in seal['objects']]==request['objects'])
  require(original_master_port is not None);reply=original_master_port.expect(('wal',request['challenge']))
  original_master_port.writer_lock.acquire()
  write(1,b'SABALAN_ORIGINAL_WAL_WINDOW_REQUEST '+encoded(dict(request=request,sourceRuntimeId=checkpoint_producer.config['capture']['runtimeId'],captureId=capture_id,sealRawBase64=base64.b64encode(seal_raw).decode(),closureRawBase64=base64.b64encode(closure_raw).decode())))
  sources=[]
  for row in request['objects']:
   require(re.fullmatch(r'[A-Za-z0-9_.-]{1,160}',row['name']) and row['name'] not in ('.','..'))
   file=directory/row['name'];fd,before=opened(file,67108864);require(before.st_size==row['bytes'])
   digest=hashlib.sha256();count=0
   while part:=os.read(fd,262144):digest.update(part);count+=len(part);require(count<=row['bytes']);write(1,part)
   require(count==row['bytes'] and digest.hexdigest()==row['sha256'] and pin(before)==pin(os.fstat(fd))==pin(file.lstat()))
   sources.append((fd,before,file))
  request_sha=hashlib.sha256(json.dumps(request,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
  write(1,b'SABALAN_ORIGINAL_WAL_WINDOW_END '+encoded(dict(challenge=request['challenge'],requestSha256=request_sha)))
  original_master_port.writer_lock.release()
  response=original_master_port.receive(reply)
  require(response.get('format')=='sabalan-signed-original-wal-window-verification/v1' and response.get('decision',{}).get('requestSha256')==request_sha
   and response['decision'].get('challenge')==request['challenge'])
  for fd,before,file in sources:require(pin(before)==pin(os.fstat(fd))==pin(file.lstat()))
  for fd,before,file in held:
   require(pin(before)==pin(os.fstat(fd))==pin(file.lstat()));os.close(fd)
  return json.dumps(response,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()

def read_original_continuous_context(runtime_id,terminal=False):
 global continuous_context_sequence
 require(re.fullmatch('[a-f0-9]{64}',runtime_id) and controller is not None and controller.poll() is None)
 with continuous_context_lock:
  continuous_context_sequence+=1
  write(continuous_request_fd,encoded(dict(sequence=continuous_context_sequence,command='PREPARE_FINISH_CONTEXT' if terminal else 'READ_CONTINUOUS_CONTEXT',runtimeId=runtime_id)))
  result=frame(continuous_response_fd,1048576)
  require(result.get('sequence')==continuous_context_sequence and result.get('event')=='CONTEXT_OBSERVED' and controller.poll() is None)
  return result['result']

def immutable(file,maximum=16*1024*1024):
 file=pathlib.Path(file);require(file.is_absolute() and file.resolve()==file)
 fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  before=os.fstat(fd);require(stat.S_ISREG(before.st_mode) and before.st_uid==0 and before.st_nlink==1 and not before.st_mode&0o022 and 0<before.st_size<=maximum)
  raw=os.read(fd,maximum+1);identity=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode,s.st_uid,s.st_nlink)
  require(len(raw)==before.st_size and identity(before)==identity(os.fstat(fd))==identity(file.lstat()));return raw
 finally:os.close(fd)

def publish(file,raw,mode=0o400):
 fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
 try:write(fd,raw);os.fsync(fd)
 finally:os.close(fd)
 directory=os.open(pathlib.Path(file).parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(directory)
 finally:os.close(directory)

def original_module(file,sha,name):
 require(hashlib.sha256(immutable(file)).hexdigest()==sha)
 spec=importlib.util.spec_from_file_location(name,file);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)
 require(hashlib.sha256(immutable(file)).hexdigest()==sha);return module

class OriginalWalPorts:
 def __init__(self,plan,helper_root,producer):self.plan=plan;self.helper_root=helper_root;self.producer=producer
 def read_original_continuous_context(self,runtime_id):return read_original_continuous_context(runtime_id)
 def read_original_terminal_wal_context(self,runtime_id):return read_original_continuous_context(runtime_id,True)
 def verify_original_wal_window(self,request,directory):return verify_original_wal_window(request,directory,self.plan['captureId'])
 def read_original_qualification_public_key_path(self):return '/etc/sabalan/online/qualification-public-key.pem'
 def crypto(self,kind,values):
  input=dict(format='sabalan-original-host-checkpoint-crypto/v1',kind=kind,mapping=dict(host=self.plan['coordinationHost'],runtime=self.plan['coordinationRuntime']),
   lockFile=str(repository/'.deploy-state/deployment.lock'),**self.plan['hostCrypto'],**{kind:values})
  raw=encoded(input);file=self.helper_root/('crypto-'+secrets.token_hex(16)+'.json');publish(file,raw)
  receipt_raw=immutable(ROOT/'host-pack-receipt.json',8*1024*1024);require(hashlib.sha256(receipt_raw).hexdigest()==config['hostPackReceiptSha256']);receipt=json.loads(receipt_raw)
  closure=['deploy/scripts/online-checkpoint-host-crypto.cjs','deploy/scripts/online-release-host-crypto.cjs','deploy/scripts/seal-online-checkpoint.cjs','scripts/postgres-recovery-coverage.mjs']
  for relative in closure:require(hashlib.sha256(immutable(ROOT/relative)).hexdigest()==receipt['outputs'][relative]['sha256'])
  row=self.producer.command('original-host-crypto-'+kind,[str(node),str(ROOT/'deploy/scripts/online-checkpoint-host-crypto.cjs'),str(file),hashlib.sha256(raw).hexdigest()],inherited=(9,))
  result=self.producer.complete(row)
  for relative in closure:require(hashlib.sha256(immutable(ROOT/relative)).hexdigest()==receipt['outputs'][relative]['sha256'])
  require(0<len(result)<=8388608 if kind=='point' else 0<len(result)<=262144);return result
 def seal_original_wal_window(self,input):return self.crypto('wal',input)
 def seal_original_point(self,point):return self.crypto('point',dict(componentManifestFile=point['manifestRuntimeFile'],componentManifestSha256=point['manifestSha256'],operation=self.plan['captureId'],outputRoot=self.plan['runtimeRoot']+'/sealed-components'))

def construct_original_wal_owner(plan):
 global checkpoint_producer,continuous_owner
 require(checkpoint_producer is None and continuous_owner is None and original_master_port is not None)
 require(plan['project']=='sabalanerp' and plan['composeFile']==config['controllerConfig']['composeFile'])
 root=pathlib.Path(plan['producerRoot']);require(root.resolve()==root and list(root.iterdir())==[])
 receipt_raw=immutable(ROOT/'host-pack-receipt.json',8*1024*1024);require(hashlib.sha256(receipt_raw).hexdigest()==config['hostPackReceiptSha256']);receipt=json.loads(receipt_raw)
 helper_root=work/('checkpoint-helpers-'+plan['captureId']);helper_root.mkdir(mode=0o700)
 sources=dict(receiver='receive-postgres-wal.py',base='capture-postgres-base.py',owner='online-runtime-owner.py',capture='capture-coherent-components.py',supervisor='native-process-owner',coverage='online-checkpoint-coverage.py',reader='recovery-versioned-files.py',inventory='online-checkpoint-inventory.py',producer='online-checkpoint-producer.py')
 helpers={}
 for name,filename in sources.items():
  relative='deploy/scripts/'+filename;raw=immutable(ROOT/relative);require(hashlib.sha256(raw).hexdigest()==receipt['outputs'][relative]['sha256'])
  target=helper_root/filename;publish(target,raw,0o500 if name=='supervisor' else 0o400);helpers[name]=dict(file=str(target),sha256=hashlib.sha256(raw).hexdigest())
 for filename in ['continuous-online-wal-owner.py','online-checkpoint-host-crypto.cjs','online-release-host-crypto.cjs']:
  relative='deploy/scripts/'+filename;raw=immutable(ROOT/relative);require(hashlib.sha256(raw).hexdigest()==receipt['outputs'][relative]['sha256']);publish(helper_root/filename,raw)
 capture={key:plan[key]for key in ['runtimeId','scope','scopeFile','runtimeScopeFile','scopeSha256','nativeDirectoryHost','boundaryDirectoryHost']}
 value=dict(format='sabalan-original-online-checkpoint-producer/v1',project=plan['project'],root=str(root),runtimeRoot=plan['runtimeRoot'],lockFile=str(repository/'.deploy-state/deployment.lock'),
  operationId='online-'+plan['captureId'][:32],captureId=plan['captureId'],database=plan['database'],databaseUrl=plan['databaseUrl'],backend=plan['backend'],postgres=plan['postgres'],
  capture=capture,sources=plan['sources'],inquiry=plan['inquiry'],inquiryRuntimeIds=plan['inquiryRuntimeIds'],sealer=dict(entrySha256=plan['sealerEntrySha256'],stores=plan['sealerStores']),helpers=helpers,
  lease=plan['lease'],composeFile=plan['composeFile'],composeSha256=hashlib.sha256(immutable(plan['composeFile'])).hexdigest(),dockerSha256=hashlib.sha256(immutable('/usr/bin/docker',64*1024*1024)).hexdigest(),expectedContainerIds=plan['expectedContainerIds'],qualificationPublicKeySha256='e61a06dfe5562a2375cb3051178ad9760857a7a01ea8b88f094a6e6123fdbc48')
 raw=encoded(value);file=root/'producer-config.json';publish(file,raw)
 producer_module=original_module(helpers['producer']['file'],helpers['producer']['sha256'],'original_checkpoint_producer_'+plan['captureId'])
 checkpoint_producer=producer_module.create_original_producer(str(file),hashlib.sha256(raw).hexdigest())
 manager_file=helper_root/'continuous-online-wal-owner.py';manager=original_module(manager_file,hashlib.sha256(immutable(manager_file)).hexdigest(),'original_continuous_wal_'+plan['captureId'])
 ports=OriginalWalPorts(plan,helper_root,checkpoint_producer);continuous_owner=manager.startOriginalOnlineWalCoverage(checkpoint_producer,ports,producer_module)
 return ports

def runtime_host(plan,file):
 prefix=plan['coordinationRuntime'];require(file.startswith(prefix+'/') and pathlib.PurePosixPath(file).as_posix()==file)
 mapped=pathlib.Path(plan['coordinationHost'])/file[len(prefix)+1:];require(mapped.resolve()==mapped);return mapped

def transfer_original_physical_point(plan,point,sealed_raw):
 require(original_master_port is not None)
 sealed=json.loads(sealed_raw);manifest_raw=immutable(point['manifestFile'],8*1024*1024);require(hashlib.sha256(manifest_raw).hexdigest()==point['manifestSha256'])
 producer_raw=json.dumps(point,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
 source_host={}
 for field,file in [('machineUuidSha256','/sys/class/dmi/id/product_uuid'),('kernelBootIdSha256','/proc/sys/kernel/random/boot_id')]:
  value=pathlib.Path(file).read_text().strip().lower();require(re.fullmatch('[a-f0-9-]{36}',value) and value.replace('-','') not in ('0'*32,'f'*32));source_host[field]=hashlib.sha256(value.encode()).hexdigest()
 request=dict(format='sabalan-original-physical-point-transfer-request/v1',sequence=1,challenge=secrets.token_hex(32),runtimeId=plan['runtimeId'],captureId=plan['captureId'])
 header=dict(request=request,producerRawBase64=base64.b64encode(producer_raw).decode(),plaintextManifestRawBase64=base64.b64encode(manifest_raw).decode(),sealedManifestRawBase64=base64.b64encode(sealed_raw).decode(),sourceHost=source_host,postgresUser=plan['postgres']['user'])
 held=[];reply=original_master_port.expect(('point',request['challenge']))
 with original_master_port.writer_lock:
  write(1,b'SABALAN_ORIGINAL_PHYSICAL_POINT_REQUEST '+encoded(header))
  for row in sealed['objects']:
   file=runtime_host(plan,row['cipherFile']);fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);before=os.fstat(fd);held.append((fd,before,file))
   require(stat.S_ISREG(before.st_mode) and before.st_uid==0 and before.st_nlink==1 and not before.st_mode&0o077 and before.st_size==row['cipherBytes'])
   total=0;digest=hashlib.sha256()
   while raw:=os.read(fd,262144):total+=len(raw);require(total<=row['cipherBytes']);digest.update(raw);write(1,raw)
   require(total==row['cipherBytes'] and digest.hexdigest()==row['cipherSha256'])
  write(1,b'SABALAN_ORIGINAL_PHYSICAL_POINT_END '+encoded(dict(challenge=request['challenge'],requestSha256=hashlib.sha256(json.dumps(request,sort_keys=True,separators=(',',':')).encode()).hexdigest())))
 response=original_master_port.receive(reply)
 for fd,before,file in held:
  identity=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode,s.st_uid,s.st_nlink)
  require(identity(before)==identity(os.fstat(fd))==identity(file.lstat()));os.close(fd)
 require(response['challenge']==request['challenge'] and response['runtimeId']==plan['runtimeId']);return response

def publish_original_checkpoint(plan,ports,call):
 checkpoint=continuous_owner.checkpoint();point=checkpoint['point'];ports.seal_original_point(point)
 sealed_file=pathlib.Path(plan['producerRoot'])/'sealed-components/sealed.json';sealed_raw=immutable(sealed_file,8*1024*1024)
 response=transfer_original_physical_point(plan,point,sealed_raw)
 live=continuous_owner.tick();require(live is not None and live['phase']=='LIVE_ORIGINAL_OWNER')
 publication=call('PREPARE_CHECKPOINT_PUBLICATION',input=dict(runtimeId=plan['runtimeId'],reportRawBase64=response['reportRawBase64'],physicalCertificate=response['physicalCertificate'],repositoryPromotionCertificate=response['repositoryPromotionCertificate'],liveCoverage=live))['checkpointPublication']
 reply=original_master_port.expect(('metadata',publication['canonicalMetadataSha256']))
 with original_master_port.writer_lock:write(1,b'SABALAN_ORIGINAL_CHECKPOINT_METADATA_REQUEST '+encoded(dict(format='sabalan-original-checkpoint-metadata-request/v1',runtimeId=plan['runtimeId'],canonicalMetadataRawBase64=publication['canonicalMetadataRawBase64'],canonicalMetadataSha256=publication['canonicalMetadataSha256'])))
 certificate=original_master_port.receive(reply);call('COMMIT_CHECKPOINT_PUBLICATION',input=dict(runtimeId=plan['runtimeId'],certificate=certificate))
 point_index=immutable(pathlib.Path(response['repositoryPromotionCertificate']['decision']['repository']['mountPath'])/'point.json',8*1024*1024)
 return dict(runtimeId=plan['runtimeId'],canonicalMetadataSha256=publication['canonicalMetadataSha256'],pointIndexSha256=hashlib.sha256(point_index).hexdigest())

def finish_original_wal_cycle(checkpoint,call):
 context=read_original_continuous_context(checkpoint['runtimeId'],True);audit=continuous_owner.finish(context['context']['phase'])
 raw=json.dumps(audit,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode();challenge=secrets.token_hex(32)
 request=dict(format='sabalan-original-terminal-wal-publication-request/v1',sequence=1,challenge=challenge,runtimeId=checkpoint['runtimeId'],terminalRawBase64=base64.b64encode(raw).decode(),terminalResultSha256=hashlib.sha256(raw).hexdigest(),canonicalMetadataSha256=checkpoint['canonicalMetadataSha256'],pointIndexSha256=checkpoint['pointIndexSha256'])
 reply=original_master_port.expect(('terminal',challenge))
 with original_master_port.writer_lock:write(1,b'SABALAN_ORIGINAL_TERMINAL_WAL_REQUEST '+encoded(request))
 certificate=original_master_port.receive(reply);return call('FINISH_CYCLE',input=dict(runtimeId=checkpoint['runtimeId'],terminalAudit=audit,terminalCertificate=certificate))

def qualify_original_online_release(checkpoint,call,work):
 live=continuous_owner.tick();require(live is not None and live['phase']=='LIVE_ORIGINAL_OWNER')
 target=call('OBSERVE_ONLINE_REQUEST',input=dict(runtimeId=checkpoint['runtimeId'],liveCoverage=live))['qualificationRequest']
 request_sha=hashlib.sha256(json.dumps(target,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
 reply=original_master_port.expect(('qualification',checkpoint['canonicalMetadataSha256']))
 with original_master_port.writer_lock:write(1,b'SABALAN_ORIGINAL_ONLINE_QUALIFICATION_REQUEST '+encoded(target))
 response=original_master_port.receive(reply)
 require(set(response)=={'format','sequence','deploymentId','releaseId','manifestSha256','acceptanceSha256','checkpointSha256','files','requestSha256'}
  and response['sequence']==1 and response['deploymentId']==target['deploymentId'] and response['releaseId']==target['releaseId']
  and response['requestSha256']==request_sha and response['checkpointSha256']==checkpoint['canonicalMetadataSha256'])
 evidence=work/('qualified-online-'+secrets.token_hex(32));evidence.mkdir(mode=0o700);total=0
 require(isinstance(response['files'],dict) and 1<=len(response['files'])<=128)
 for name,entry in response['files'].items():
  require(re.fullmatch(r'[a-z0-9][a-z0-9_.-]{0,95}',name) and set(entry)=={'rawBase64','sha256','bytes'})
  raw=base64.b64decode(entry['rawBase64'],validate=True);total+=len(raw)
  require(0<len(raw)<=8388608 and len(raw)==entry['bytes'] and total<=33554432 and hashlib.sha256(raw).hexdigest()==entry['sha256'])
  publish(evidence/name,raw)
 for name,key in [('manifest.json','manifestSha256'),('acceptance.json','acceptanceSha256')]:require(hashlib.sha256(immutable(evidence/name,8388608)).hexdigest()==response[key])
 directory=os.open(evidence,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(directory)
 finally:os.close(directory)
 return call('BUILD_ONLINE_MATERIAL',input=dict(runtimeId=checkpoint['runtimeId'],evidenceDirectory=str(evidence),manifestSha256=response['manifestSha256'],acceptanceSha256=response['acceptanceSha256']))['onlineMaterial']

def child(argv,**kwargs):
 process=subprocess.Popen(argv,**kwargs);originals.append(process);return process

def log(stream,file):
 def pump():
  total=0
  with open(file,'xb',buffering=0) as target:
   os.chmod(file,0o600)
   while True:
    data=stream.read(65536)
    if not data:break
    total+=len(data)
    if total<=64*1024*1024:target.write(data)
    else:failures.append('ORIGINAL_LOG_BOUND')
   os.fsync(target.fileno())
 thread=threading.Thread(target=pump,daemon=False);logs.append(thread);thread.start()

failures=[]; controller=None; deploy=None; controller_sequence=0
launcher_configuration_sha256=None

def launcher_client_custody(mode):
 require(mode in ('BOOTSTRAP','FOLLOWING') and deploy is not None and deploy.poll()==0)
 require(controller is not None and controller.poll() is None and not failures)
 require(checkpoint_producer is None and continuous_owner is None and checkpoint_state is None and checkpoint_ports is None and online_material is None)
 require(original_master_port is not None)
 with original_master_port.lock:
  require(original_master_port.error is None and not original_master_port.pending)
 require(all(owner.children.closed() and continuous.terminal for owner,continuous,_,_ in closed_checkpoint_owners))
 own_pid=os.getpid();raw=pathlib.Path('/proc/'+str(own_pid)+'/stat').read_text();own_birth=raw[raw.rfind(')')+2:].split()[19]
 return dict(deployOriginalCode=0,pendingMasterReplies=0,checkpointProducerAbsent=True,continuousOwnerAbsent=True,
  checkpointContextAbsent=True,launcherPid=own_pid,launcherBirth=own_birth,configurationSha256=launcher_configuration_sha256)
try:
 require(sys.platform=='linux' and os.getuid()==0 and len(sys.argv)==3 and sys.argv[2]=='--owner-service' and stat.S_ISFIFO(os.fstat(0).st_mode))
 # Reserve our OWN descriptor before any original pipe/Popen can allocate it.
 # /dev/null is a placeholder only, never tested or represented as a lease.
 try:os.fstat(9)
 except OSError:pass
 else:raise RuntimeError('ONLINE_LAUNCHER_FD9_ALREADY_OWNED')
 placeholder=os.open('/dev/null',os.O_RDONLY|os.O_CLOEXEC)
 if placeholder!=9:
  os.dup2(placeholder,9,inheritable=False);os.close(placeholder)
 placeholder_identity=os.fstat(9)
 require(not any(key.startswith(('LD_','PYTHON','NODE_PRELOAD')) for key in os.environ))
 config=private(sys.argv[1]);require(config['format']=='sabalan-online-original-launcher/v1')
 launcher_configuration_sha256=hashlib.sha256(immutable(pathlib.Path(sys.argv[1]))).hexdigest()
 lifecycle_fd=int(os.environ['SABALAN_ORIGINAL_OWNER_READY_FD']);require(lifecycle_fd>2 and stat.S_ISFIFO(os.fstat(lifecycle_fd).st_mode))
 raw=pathlib.Path('/proc/'+str(os.getpid())+'/stat').read_text();own_birth=raw[raw.rfind(')')+2:].split()[19]
 # Mandatory inert phase: no deploy, controller, lease or maintenance mutation
 # exists until the original permanent service binds an actual update client.
 write(1,encoded(dict(format='sabalan-original-predeploy-ready/v1',launcherPid=os.getpid(),launcherBirth=own_birth,
  configurationSha256=launcher_configuration_sha256)))
 begin=frame(0)
 if begin.get('format')=='sabalan-original-abort-predeploy/v1':
  require(set(begin)=={'format','configurationSha256','instanceId'} and begin['configurationSha256']==launcher_configuration_sha256
   and re.fullmatch('[a-f0-9]{64}',begin['instanceId']) and deploy is None and controller is None and not originals and not logs)
  write(lifecycle_fd,encoded(dict(format='sabalan-original-predeploy-aborted/v1',launcherPid=os.getpid(),launcherBirth=own_birth,
   configurationSha256=launcher_configuration_sha256)))
  os.close(lifecycle_fd)
  raise OriginalPredeployAborted()
 require(set(begin)=={'format','configurationSha256','instanceId','clientNonce'} and begin['format']=='sabalan-original-begin-deploy/v1'
  and begin['configurationSha256']==launcher_configuration_sha256
  and re.fullmatch('[a-f0-9]{64}',begin['instanceId']) and re.fullmatch('[a-f0-9]{64}',begin['clientNonce']))
 repository=pathlib.Path(config['repositoryRoot']);require(repository.is_absolute() and repository.resolve()==repository and repository.is_dir()
  and pathlib.Path(config['controllerConfig']['composeFile']).parent==repository)
 node=pathlib.Path(config['nodeExecutable']);require(str(node) in ('/usr/bin/node','/usr/local/bin/node') and node.resolve().stat().st_uid==0)
 work=pathlib.Path(config['operationDirectory']);require(work.is_absolute() and not work.exists());work.mkdir(mode=0o700)
 lock_file=pathlib.Path(config['publicationLockFile']);require(lock_file.parent.resolve()==lock_file.parent)
 publication_fd=os.open(lock_file,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
 lock_stat=os.fstat(publication_fd);require(stat.S_ISREG(lock_stat.st_mode) and lock_stat.st_uid==0 and lock_stat.st_nlink==1 and lock_stat.st_size==0 and not lock_stat.st_mode&0o077)
 fcntl.flock(publication_fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 request_read,request_write=os.pipe();response_read,response_write=os.pipe()
 environment=dict(os.environ,DEPLOYMENT_ONLINE_BOOTSTRAP_REQUEST_FD=str(request_write),DEPLOYMENT_ONLINE_BOOTSTRAP_RESPONSE_FD=str(response_read),DEPLOYMENT_REPO_ROOT=str(repository))
 deploy_arguments=['/bin/sh',str(ROOT/'deploy/scripts/deploy.sh')]
 if 'prebuiltReleasePlan' in config:
  selected=prebuilt_release_arguments(config['prebuiltReleasePlan'])
  deploy_arguments.extend([selected[0],config['environmentFile'],*selected[1:]])
 else:deploy_arguments.append(config['environmentFile'])
 deploy=child(deploy_arguments,cwd=repository,env=environment,
  stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(request_write,response_read))
 os.close(request_write);os.close(response_read)
 log(deploy.stdout,work/'deploy.stdout');log(deploy.stderr,work/'deploy.stderr')
 bootstrap=None
 for index,command in enumerate(['FINANCIAL_PREPARE','BOOTSTRAP_PREPARE','BOOTSTRAP_GATES','BOOTSTRAP_PUBLISH','BOOTSTRAP_ACTIVATE','BOOTSTRAP_OPENED'],1):
  message=frame(request_read)
  require(set(message)=={'format','command','sequence','deploymentId','releaseId','targetCommit'} and message['format']=='sabalan-protected-bootstrap-boundary/v1' and message['command']==command and message['sequence']==index)
  require(re.fullmatch('[a-f0-9]{40}',message['targetCommit']) and deploy.poll() is None)
  if controller is None:
   # The session is not runtime authority: the SAME live deploy created it and
   # SQL independently verifies its exact still-owned lease/checkpoint.
   session=private(config['sessionFile'])
   require(session['deploymentId']==message['deploymentId'] and session['releaseId']==message['releaseId'] and session['targetCommit']==message['targetCommit'])
   host_config=dict(config['controllerConfig'],owner=dict(deploymentId=session['deploymentId'],releaseId=session['releaseId'],leaseToken=session['leaseToken']))
   if 'prebuiltReleasePlan' in config:host_config['prebuiltReleasePlan']=config['prebuiltReleasePlan']
   context_read,continuous_request_fd=os.pipe();continuous_response_fd,context_write=os.pipe()
   host_config['continuousContext']=dict(requestFd=context_read,responseFd=context_write)
   host_config['publicationLock']=dict(file=str(lock_file),descriptor=publication_fd,identity=dict(device=str(lock_stat.st_dev),inode=str(lock_stat.st_ino),ownerUid=0))
   controller_config=work/'controller-config.json';controller_config.write_bytes(encoded(host_config));os.chmod(controller_config,0o600)
   environment=dict(os.environ,DATABASE_URL=config['databaseUrl'])
   controller=child([str(node),str(ROOT/'deploy/scripts/online-release-controller-cli.mjs'),str(controller_config)],cwd=ROOT,env=environment,
    stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(publication_fd,context_read,context_write))
   os.close(context_read);os.close(context_write)
   log(controller.stderr,work/'controller.stderr')
  require(controller.poll() is None and not failures)
  def call(name,**fields):
   global controller_sequence
   controller_sequence+=1;write(controller.stdin.fileno(),encoded(dict(sequence=controller_sequence,command=name,**fields)))
   result=original_controller_response(controller.stdout.fileno(),name)
   require(result.get('sequence')==controller_sequence and result.get('event')==('CLOSED' if name=='CLOSE' else 'COMMAND_COMPLETED')
    and (controller.poll() in (None,0) if name=='CLOSE' else controller.poll() is None))
   return result
  if command=='FINANCIAL_PREPARE':
   target=call('OBSERVE_PROTECTED_FINANCIAL_REQUEST')['financialRequest']
   require(target['deploymentId']==message['deploymentId'] and target['releaseId']==message['releaseId'] and target['targetCommit']==message['targetCommit'])
   write(1,b'SABALAN_ORIGINAL_FINANCIAL_REQUEST '+encoded(target))
   response=frame(0,65536)
   require(set(response)=={'format','sequence','deploymentId','releaseId','requestSha256','sourceSha256','binding','files'} and response['format']=='sabalan-original-protected-financial-response/v1'
    and type(response['sequence'])is int and response['sequence']==1 and response['deploymentId']==message['deploymentId'] and response['releaseId']==message['releaseId']
    and response['requestSha256']==hashlib.sha256(json.dumps(target,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest())
   evidence=receive_qualification_files(response,work/'financial-evidence',True)
   require(hashlib.sha256((evidence/'protected-financial-source.json').read_bytes()).hexdigest()==response['sourceSha256'])
   call('PREPARE_PROTECTED_FINANCIAL',input=dict(evidenceDirectory=str(evidence),sourceSha256=response['sourceSha256'],binding=response['binding']))
  elif command=='BOOTSTRAP_PREPARE':
   target=call('OBSERVE_BOOTSTRAP_REQUEST')['qualificationRequest']
   require(target['deploymentId']==message['deploymentId'] and target['releaseId']==message['releaseId'] and target['targetCommit']==message['targetCommit'])
   # Only this SAME original SSH/stdin conversation can supply the later
   # signed package. The controller independently verifies its fixed trust.
   write(1,b'SABALAN_ORIGINAL_QUALIFICATION_REQUEST '+encoded(target))
   response=frame(0,65536)
   require(set(response)=={'format','sequence','deploymentId','releaseId','manifestSha256','acceptanceSha256','checkpointSha256','files'}
    and response['format']=='sabalan-original-protected-qualification-response/v2' and type(response['sequence'])is int and response['sequence']==1
    and response['deploymentId']==message['deploymentId'] and response['releaseId']==message['releaseId']
    and response['checkpointSha256']==hashlib.sha256(json.dumps(target['checkpoint'],sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest())
   evidence=receive_qualification_files(response,work/'qualified-evidence')
   require(hashlib.sha256((evidence/'manifest.json').read_bytes()).hexdigest()==response['manifestSha256']
    and hashlib.sha256((evidence/'acceptance.json').read_bytes()).hexdigest()==response['acceptanceSha256'])
   directory=os.open(evidence,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
   try:os.fsync(directory)
   finally:os.close(directory)
   bootstrap=call('BUILD_BOOTSTRAP_MATERIAL',input=dict(evidenceDirectory=str(evidence),manifestSha256=response['manifestSha256'],acceptanceSha256=response['acceptanceSha256']))['bootstrapMaterial']
   bootstrap['applicationsByHost']=config['applicationsByHost']
   require(bootstrap['registration']['previousReleaseId'] is None)
   bootstrap_input={key:bootstrap[key] for key in ('registration','paths','httpRuntimes')}
   if 'frontendSnapshot' in config:
    selection=config['frontendSnapshot']
    require(isinstance(selection,dict) and set(selection)=={'file','sha256'} and isinstance(selection['file'],str) and pathlib.Path(selection['file']).is_absolute() and re.fullmatch('[a-f0-9]{64}',selection['sha256']))
    bootstrap_input['frontendSnapshot']=selection
   call(command,input=bootstrap_input)
  elif command=='BOOTSTRAP_GATES':
   call('RUN_PRODUCTION_GATES',input=dict(releaseId=message['releaseId']))
  elif command=='BOOTSTRAP_PUBLISH':
   call('START_EDGE',input=dict(applicationsByHost=bootstrap['applicationsByHost']))
   call(command)
  elif command=='BOOTSTRAP_ACTIVATE':
   for runtime in bootstrap['httpRuntimes']:call(command,runtimeId=runtime['runtimeId'])
  else:
   require(bootstrap['jobsRuntimeId'])
   call('START_RUNTIME',input=dict(runtimeId=bootstrap['jobsRuntimeId']))
   call('WAIT_READY',runtimeId=bootstrap['jobsRuntimeId'])
  write(response_write,encoded(dict(format='sabalan-protected-bootstrap-boundary-result/v1',command=command,sequence=index,
   deploymentId=message['deploymentId'],releaseId=message['releaseId'],status='COMPLETED')))
 # This original launcher is a persistent controller, not a one-shot deploy
 # wrapper. Serving originals still own native locks after deploy completes.
 deploy.wait()
 require(deploy.returncode==0 and controller.poll() is None and not failures)
 (work/'protected-install-result.json').write_bytes(encoded(dict(format='sabalan-original-protected-install/v1',deployOriginalCode=deploy.returncode,
  originalHostControllerRetained=True,applicationChildrenStillOwned=True,productionAdmissionClaimed=False)))
 os.chmod(work/'protected-install-result.json',0o600)
 # The SAME launcher now owns the standard host deployment mutex as well.
 # No later deploy process may steal old actors or contend with its FD20.
 deployment_lock=os.open(repository/'.deploy-state/deployment.lock',os.O_RDWR|os.O_NOFOLLOW)
 fcntl.flock(deployment_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 reserved=os.fstat(9);require((reserved.st_dev,reserved.st_ino,reserved.st_mode)==(placeholder_identity.st_dev,placeholder_identity.st_ino,placeholder_identity.st_mode))
 os.dup2(deployment_lock,9,inheritable=True)
 if deployment_lock!=9:os.close(deployment_lock)
 deployment_lock=9
 call('FOLLOWING_READY')
 original_master_port=OriginalMasterPort();checkpoint_state=None;checkpoint_ports=None;closed_checkpoint_owners=[];online_material=None
 # Root-only local control, outside every application mount. This is an input
 # channel to the STILL-LIVE original controller, not a saved ownership record.
 request_path=work/'control-request.fifo';response_path=work/'control-response.fifo'
 os.mkfifo(request_path,0o600);os.mkfifo(response_path,0o600)
 write(lifecycle_fd,encoded(dict(format='sabalan-original-operation-ready/v1',launcherPid=os.getpid(),launcherBirth=own_birth,
  configurationSha256=launcher_configuration_sha256,deployOriginalCode=0)))
 admin_sequence=0
 allowed={'ACQUIRE_NEXT','DRAIN_CURRENT_JOBS','READ_CYCLE_PLAN','RETIRE_EXPIRED_BUILDS','CREATE_CHECKPOINT','QUALIFY_NEXT','PREPARE_EXPANSION','RUN_EXPANSION','REGISTER','REGISTER_RETAINED','PROVISION_CARRIERS','START_EDGE','APPEND_EDGE_ENDPOINTS','STOP_EDGE','START_RUNTIME','WAIT_READY','PREPARE_DRAIN','WAIT_PREPARED','SHUTDOWN','WAIT_CLOSED','TRANSITION','PUBLISH','RUN_PRODUCTION_GATES','FINISH_CYCLE','PREPARE_INQUIRY','START_INQUIRY','STOP_INQUIRY','PREPARE_RETAINED_ROLLBACK','BUILD_PUBLICATION_REGISTRY','READ_CLIENT_DETACH_BARRIER','QUIESCENT_SERVICE_EXIT'}
 while True:
  request_fd=os.open(request_path,os.O_RDONLY|os.O_NOFOLLOW)
  try:
   st=os.fstat(request_fd);require(stat.S_ISFIFO(st.st_mode) and st.st_uid==0 and st.st_mode&0o777==0o600)
   command=frame(request_fd,8388608)
  finally:os.close(request_fd)
  require(command.get('sequence')==admin_sequence+1 and command.get('command') in allowed and original_master_port.error is None)
  admin_sequence+=1
  client_sequence=command.get('clientSequence')
  require(client_sequence is None or type(client_sequence)is int and client_sequence>0)
  fields={key:value for key,value in command.items() if key not in ('sequence','command','clientSequence')}
  if command['command']=='CREATE_CHECKPOINT':
   require(not fields and checkpoint_state is None and continuous_owner is None)
   call('DRAIN_CURRENT_JOBS')
   plan=call('PREPARE_CHECKPOINT_CAPTURE')['checkpointCapture'];checkpoint_ports=construct_original_wal_owner(plan)
   checkpoint_state=publish_original_checkpoint(plan,checkpoint_ports,call);result=dict(checkpointCommitted=True)
  elif command['command']=='QUALIFY_NEXT':
   require(not fields and checkpoint_state is not None and continuous_owner is not None and online_material is None)
   online_material=qualify_original_online_release(checkpoint_state,call,work);result=dict(originalOnlineQualificationBound=True)
  elif command['command'] in ('PREPARE_EXPANSION','RUN_EXPANSION','REGISTER'):
   require(not fields and online_material is not None);result=call(command['command'],input=online_material['registration'])
  elif command['command']=='FINISH_CYCLE':
   require(not fields and checkpoint_state is not None and continuous_owner is not None)
   result=finish_original_wal_cycle(checkpoint_state,call)
   require(continuous_owner.terminal and checkpoint_producer.children.closed())
   closed_checkpoint_owners.append((checkpoint_producer,continuous_owner,checkpoint_state,checkpoint_ports))
   checkpoint_producer=None;continuous_owner=None;checkpoint_state=None;checkpoint_ports=None;online_material=None
  elif command['command']=='READ_CLIENT_DETACH_BARRIER':
   require(set(fields)=={'input'} and set(fields['input'])=={'mode'})
   custody=launcher_client_custody(fields['input']['mode'])
   result=call(command['command'],**fields)
   result['launcherCustody']=custody
  elif command['command']=='QUIESCENT_SERVICE_EXIT':
   require(set(fields)=={'input'} and set(fields['input'])=={'mode'})
   launcher_client_custody(fields['input']['mode'])
   call('PREPARE_CONTROLLER_CLOSE')
   os.close(continuous_request_fd);continuous_request_fd=None
   result=call('CLOSE')
   controller.stdin.close();controller.wait()
   require(controller.returncode==0 and not controller.stdout.read(1))
   require(all(process.poll() is not None for process in originals))
   with original_master_port.lock:
    require(original_master_port.error is None and not original_master_port.pending)
    original_master_port.terminalClosing=True
   write(lifecycle_fd,encoded(dict(format='sabalan-original-input-close-request/v1',launcherPid=os.getpid(),launcherBirth=own_birth,
    configurationSha256=launcher_configuration_sha256)))
   original_master_port.thread.join()
   require(original_master_port.closed and original_master_port.error is None)
  else:result=call(command['command'],**fields)
  admin_result=project_original_control_result(admin_sequence,command['command'],result)
  if client_sequence is not None:
   with original_master_port.writer_lock:
    control_wire=b'SABALAN_ORIGINAL_CLIENT_CONTROL_COMPLETED '+encoded(dict(sequence=client_sequence,command=command['command'],result=admin_result))
    require(len(control_wire)<=8388608)
    write(1,control_wire)
  response_fd=os.open(response_path,os.O_WRONLY|os.O_NOFOLLOW)
  try:write(response_fd,encoded(admin_result))
  finally:os.close(response_fd)
  if command['command']=='QUIESCENT_SERVICE_EXIT':
   for thread in logs:thread.join()
   break
except OriginalPredeployAborted:
 require(deploy is None and controller is None and not originals and not logs)
 sys.exit(0)
except BaseException:
 # Never terminate, adopt or lose an original on deadline, pipe or signature
 # ambiguity. The original deploy boundary keeps renewing its own lease.
 if checkpoint_producer is not None or (continuous_owner is not None and not continuous_owner.terminal):
  while True:time.sleep(1)
 for process in originals:
  if process.poll() is None:
   while True:time.sleep(1)
 for thread in logs:thread.join()
 sys.exit(1)
