#!/usr/bin/env python3
"""Same host/FD9 local QA lease owner; never accepted release or public authority."""
import hashlib,importlib.util,json,os,re,threading,time
from pathlib import Path

def require(v,code):
 if not v:raise RuntimeError('LOCAL_CHECKPOINT_OWNER_'+code)
def canonical(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def load(file,sha,name,producer):
 require(producer.source_sha(file)==sha,'SOURCE_CHANGED');s=importlib.util.spec_from_file_location(name,file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
class OriginalLocalCheckpointOwner:
 def __init__(self,producer_module,configuration_file,configuration_sha256,controller_source,controller_sha256,owner_directory):
  p=producer_module;raw=p.private_bytes(configuration_file,8*1024*1024,immutable=True);require(hashlib.sha256(raw).hexdigest()==configuration_sha256,'CONFIGURATION_CHANGED');base=json.loads(raw)
  require(base.get('project')=='sabalanerp-local'and'lease'not in base and re.fullmatch(r'qa_application_(?:native|restored)_[a-f0-9]{32}',base['database']['name']),'ISOLATED_FRESH_LEASE_REQUIRED')
  require(base['capture']['scope']['purpose']=='capture'and base['capture']['scope']['database']=={k:base['database'][k]for k in('name','systemIdentifier')},'ACTUAL_CAPTURE_SCOPE_REQUIRED')
  tmp=dict(base);p.validate_host_runtime(tmp);runtime=p.host_runtime(tmp);require(base['dockerSha256']==p.source_sha(runtime['docker'][0]),'DOCKER_PIN')
  self.p,self.base,self.runtime,self.raw,self.file=p,base,runtime,raw,Path(configuration_file);self.lock_identity=p.assert_host_lock(base);self.closed=False;self.held=False;self.producer=None;self.manager=None;self.sequence=0;self.mutex=threading.Lock()
  self.directory=Path(owner_directory);require(self.directory.is_absolute()and self.directory.resolve(strict=True)==self.directory and self.directory.stat().st_uid==0 and not self.directory.stat().st_mode&0o077 and list(self.directory.iterdir())==[],'FRESH_OWNER_ROOT_REQUIRED')
  self.children=p.OriginalChildren(self.directory,self.assert_owned,retained_fds=(9,));self.original_controllers=[]
  require(Path(controller_source).name=='local-online-checkpoint-controller.worker.cjs'and p.source_sha(controller_source)==controller_sha256,'CONTROLLER_SOURCE')
  rows=self.census();candidate=base['backend'];inspect=json.loads(self.docker(['inspect',candidate['containerId']]))[0];require(inspect['Image']==candidate['image']and inspect['State']['StartedAt']==candidate['startedAt']and inspect['Config']['Labels']['com.docker.compose.service']=='backend-candidate','SOURCE_BACKEND_CHANGED')
  mounts=[x for x in inspect['Mounts']if x['Destination']=='/app/online-runtime-acceptance'];require(len(mounts)==1 and mounts[0]['RW']and mounts[0]['Type']=='volume','ACTUAL_ACCEPTANCE_MOUNT_REQUIRED')
  mount=Path(mounts[0]['Source']);require(mount.resolve(strict=True)==mount and mount.is_dir(),'GENUINE_HOST_MOUNT_REQUIRED')
  operation=os.urandom(16).hex();host=mount/('local-checkpoint-owner-'+operation);host.mkdir(mode=0o700);self.controller_runtime='/app/online-runtime-acceptance/'+host.name+'/controller.cjs';p.publish(host/'controller.cjs',p.private_bytes(controller_source,1024*1024,immutable=True))
  self.census();self.controller=self.children.start('original-sql-controller',[*runtime['docker'],'exec','-i',candidate['containerId'],'node',self.controller_runtime],interactive=True,maximum=8*1024*1024)
  input={'format':'sabalan-original-local-checkpoint-controller/v1','database':base['database']['name'],'runtimeId':base['capture']['runtimeId'],'scopeSha256':base['capture']['scopeSha256'],'targetCommit':base['targetCommit']};self.controller.process.stdin.write(canonical(input));self.controller.process.stdin.flush();ready=self.receive();require(ready['event']=='LEASE_READY'and ready['sequence']==0,'ORIGINAL_LEASE_READY_REQUIRED');context=ready['context'];require(context['database']==base['database'],'ACTUAL_DATABASE_CHANGED');self.lease=context['lease'];p.lease_assertion(self.lease)
  # The configured lease is exclusively the response of this still-owned child.
  config={**base,'lease':self.lease};root=Path(config['root']);require(root.resolve(strict=True)==root and list(root.iterdir())==[],'FRESH_PRODUCER_ROOT_REQUIRED');file=root/'producer-config.json';data=canonical(config);p.publish(file,data);self.producer=p.create_original_producer(str(file),hashlib.sha256(data).hexdigest())
 def assert_owned(self):
  require(not self.closed and not self.held,'ORIGINAL_OWNER_HELD');require(self.p.private_bytes(self.file,8*1024*1024,immutable=True)==self.raw,'CONFIGURATION_CHANGED');require(self.p.assert_host_lock(self.base)==self.lock_identity,'FD9_CHANGED')
 def hold(self,reason):
  self.held=True
  try:self.p.publish(self.directory/'UNKNOWN.json',{'format':'sabalan-local-checkpoint-owner-unknown/v1','reason':reason})
  except BaseException:pass
  while True:time.sleep(1)
 def census(self):
  self.assert_owned();args=[*self.runtime['docker'],'compose','-f',self.base['composeFile'],'-p','sabalanerp-local','ps','--all','--no-trunc','--format','json'];child=self.children.start('census-'+os.urandom(8).hex(),args);raw=self.children.finish(child);rows=json.loads(raw)if raw.lstrip().startswith(b'[')else[json.loads(x)for x in raw.splitlines()if x];self.p.validate_census(rows,self.base['expectedContainerIds'],'sabalanerp-local');return rows
 def docker(self,args):
  self.census();child=self.children.start('docker-'+os.urandom(8).hex(),[*self.runtime['docker'],*args]);return self.children.finish(child)
 def receive(self):
  # Original bounded pump owns the pipe; no second reader or report adoption.
  consumed=getattr(self,'consumed',0)
  while True:
   self.assert_owned();raw=self.controller.stdout.read_bytes();require(len(raw)<=8*1024*1024,'CONTROLLER_OUTPUT_BOUND')
   index=raw.find(b'\n',consumed)
   if index>=0:self.consumed=index+1;value=json.loads(raw[consumed:index]);require(value.get('event')!='HELD','CONTROLLER_HELD');return value
   require(self.controller.process.poll()is None,'CONTROLLER_EOF_UNKNOWN');time.sleep(.01)
 def request(self,command):
  with self.mutex:
   self.assert_owned();require(self.controller.process.poll()is None,'ORIGINAL_CONTROLLER_CHANGED');self.sequence+=1;r={'command':command,'runtimeId':self.base['capture']['runtimeId'],'sequence':self.sequence};self.controller.process.stdin.write(canonical(r));self.controller.process.stdin.flush();result=self.receive();require(result['sequence']==self.sequence,'CONTROLLER_SEQUENCE');return result
 def read_original_continuous_context(self,runtime_id):
  require(runtime_id==self.base['capture']['runtimeId'],'RUNTIME_CHANGED');self.census();result=self.request('READ_CONTEXT');require(result['event']=='CONTEXT_OBSERVED','ORIGINAL_CONTEXT_REQUIRED');value=result['context'];require(value['lease']==self.lease and value['database']==self.base['database']and value['scopeSha256']==self.base['capture']['scopeSha256'],'CONTEXT_CHANGED');inspect=json.loads(self.docker(['inspect',self.base['backend']['containerId']]))[0];backend={'containerId':inspect['Id'],'image':inspect['Image'],'startedAt':inspect['State']['StartedAt']};require(backend=={key:self.base['backend'][key]for key in backend},'SOURCE_BACKEND_CHANGED');return {'format':'sabalan-original-continuous-checkpoint-context/v1','runtimeId':runtime_id,'scopeSha256':value['scopeSha256'],'phase':value['phase'],'targetCommit':self.base['targetCommit'],'lease':value['lease'],'sourceBackend':backend,'expectedContainerIds':list(self.base['expectedContainerIds']),'publicationSha256':None}
 def close_original(self):
  self.assert_owned();require(self.producer is not None and self.producer.children.closed(),'PRODUCER_CHILDREN_UNRESOLVED')
  if self.producer.role_created:require(self.manager is not None and(getattr(self.manager,'point_only_closed',False)or self.manager.terminal)and self.producer.native_closed,'ACTIVE_CAPTURE_OR_RECEIVER')
  response=self.request('CLOSE_ABORTED');require(response['event']=='CLOSED_ABORTED'and response['phase']=='ABORTED','ORIGINAL_CLOSE_REQUIRED');self.controller.process.stdin.close();self.children.finish(self.controller);require(self.children.closed(),'ORIGINAL_CONTROLLERS_UNRESOLVED');self.closed=True;return {'format':'sabalan-original-local-checkpoint-owner-closed/v1','phase':'ABORTED','originalControllerPid':self.controller.process.pid,'allOriginalChildrenClosed':True,'productionAdmission':False}
def create_original_local_checkpoint_owner(**kwargs):
 owner=OriginalLocalCheckpointOwner.__new__(OriginalLocalCheckpointOwner)
 try:
  owner.__init__(**kwargs);return owner
 except BaseException:
  if getattr(owner,'controller',None)is not None or any(x.process is not None and(x.process.poll()is None or any(t.is_alive()for t in x.threads))for x in getattr(getattr(owner,'children',None),'children',[])):
   owner.hold('ORIGINAL_CONTROLLER_CONSTRUCTION_UNRESOLVED')
  raise
