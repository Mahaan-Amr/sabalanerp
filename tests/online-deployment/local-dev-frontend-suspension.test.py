"""Pure validators and actual guarded-call branches; no Docker/native qualification."""
import ast,base64,copy,hashlib,importlib.util,json,pathlib,types,unittest,subprocess,shutil
ROOT=pathlib.Path(__file__).resolve().parents[2]
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,ROOT/file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
m=load('local_dev_rules','deploy/scripts/local-dev-frontend-suspension.py');p=load('local_dev_producer','deploy/scripts/online-checkpoint-producer.py');o=load('local_dev_owner','deploy/scripts/local-online-checkpoint-owner.py')
SHA='a'*64

def fixture():
 values=[]
 for i,service in enumerate(sorted(m.SERVICES)):
  value=dict(Id=hex(i+1)[2:]*64,Image='sha256:'+str(i%9+1)*64,Config=dict(Labels={'com.docker.compose.project':'sabalanerp-local','com.docker.compose.service':service}),HostConfig=dict(Memory=1536),Mounts=[],State=dict(StartedAt='2026-10-24T00:00:00.000000001Z',FinishedAt='2026-10-24T00:01:00.000000001Z',Running=service!='frontend',Status='running'if service!='frontend'else'exited',Health=dict(Status='healthy'),Pid=12 if service!='frontend'else 0,ExitCode=0,OOMKilled=False,Dead=False,Error=''));values.append(value)
 dev=next(v for v in values if v['Config']['Labels']['com.docker.compose.service']=='frontend');identity=dict(id=dev['Id'],image=dev['Image'],startedAt=dev['State']['StartedAt'],configurationSha256=m.sha(m.canonical({k:dev[k]for k in ('Config','HostConfig','Mounts')})))
 receipt=dict(format='sabalan-local-dev-frontend-suspension/v1',project='sabalanerp-local',service='frontend',composeFile='D:/sabalanerp/docker-compose.local.yml',operation='b'*32,ownerSourceSha256=SHA,verifierSourceSha256=SHA,composeSha256=SHA,pendingSha256=SHA,frontend=identity,otherNine={s:{}for s in m.SERVICES-{'frontend'}},candidateReplacementReceipt=dict(file='D:/fixture/candidate.json',sha256=SHA),qualificationSlots={},stop=dict(argv=['stop','--time','60',dev['Id']],originalPid=12,code=0,signal=None,stdoutEof=True,stderrEof=True,spawnError=None,streamError=None,outputBoundExceeded=False,interrupted=False),stopped=dict(status='exited',running=False,pid=0,exitCode=0,oomKilled=False,dead=False,error='',finishedAt=dev['State']['FinishedAt']),productionAdmission=False,nativeClosureClaimed=False,restorationRequired=True)
 raw=json.dumps(receipt).encode();scope=dict(format='sabalan-local-dev-capture-suspension/v1',project='sabalanerp-local',service='frontend',selection=dict(file=r'D:\fixture\stopped.json',sha256=m.sha(raw)),receiptSha256=m.sha(raw),receiptRawBase64=base64.b64encode(raw).decode(),capture=dict(runtimeId='c'*64,scopeSha256='d'*64),productionAdmission=False)
 cfg=dict(project='sabalanerp-local',database=dict(name='qa_application_native_'+'e'*32),capture=dict(runtimeId='c'*64,scopeSha256='d'*64),composeSha256=SHA,helpers=dict(suspensionOwner=dict(sha256=SHA),suspensionVerifier=dict(sha256=SHA)),localDevSuspension=scope,expectedContainerIds=[v['Id']for v in values],composeFile='D:/sabalanerp/docker-compose.local.yml')
 rows=[dict(ID=v['Id'],Project='sabalanerp-local',Service=v['Config']['Labels']['com.docker.compose.service'],State=v['State']['Status'],Health='healthy')for v in values];return cfg,rows,dev

def mutate_receipt(cfg,change):
 v=json.loads(base64.b64decode(cfg['localDevSuspension']['receiptRawBase64']));change(v);raw=json.dumps(v).encode();s=cfg['localDevSuspension'];s['receiptRawBase64']=base64.b64encode(raw).decode();s['receiptSha256']=s['selection']['sha256']=m.sha(raw)

class Rules(unittest.TestCase):
 def test_actual_js_validator_accepts_independent_python_exact_query_digest_and_refuses_typo(self):
  expected=hashlib.md5(b'SELECT 1').hexdigest();self.assertEqual(expected,'b1698e52a0f16203489454196a0c6307')
  module=(ROOT/'scripts/lib/local-dev-frontend-suspension.mjs').as_uri();script="import {validateLocalDevRestoreSql as check} from "+json.dumps(module)+";const slots=[{host:'172.20.0.2',database:'sabalanerp'}];check({prepared:0,sessions:[{client:slots[0].host,database:slots[0].database,application:'sabalanerp-online-candidate',state:'idle',xact:false,queryMd5:process.argv[1]}]},slots);"
  for digest,success in [(expected,True),('b1698e52a0f16203489454196a0c630a7',False)]:
   child=subprocess.Popen([shutil.which('node'),'--input-type=module','-e',script,digest],stdout=subprocess.PIPE,stderr=subprocess.PIPE);out,err=child.communicate(timeout=15);self.assertEqual(child.returncode==0,success);self.assertTrue(child.stdout.closed and child.stderr.closed)
 def test_actual_backslash_publisher_path_maps_safely(self):
  self.assertEqual(str(m.native_file(r'D:\qa\stopped.json')).replace('\\','/'),'/mnt/host/d/qa/stopped.json')
  for path in ['D:/qa/../file','D:relative','//other/share','D:/qa//file']:
   with self.assertRaises(RuntimeError):m.native_file(path)
 def test_scope_rows_and_actual_inspected_stopped_identity(self):
  cfg,rows,dev=fixture();m.validate_rows(rows,cfg,False);m.validate_inspected(dev,cfg,False)
  for key,value in [('Running',True),('Pid',1),('ExitCode',137),('OOMKilled',True),('StartedAt','other')]:
   altered=copy.deepcopy(dev);altered['State'][key]=value
   with self.assertRaises(RuntimeError):m.validate_inspected(altered,cfg,False)
  altered=copy.deepcopy(dev);altered['HostConfig']['Memory']+=1
  with self.assertRaises(RuntimeError):m.validate_inspected(altered,cfg,False)
 def test_wrong_scope_capture_receipt_hash_and_source_refuse(self):
  for change in [lambda c:c.__setitem__('project','sabalanerp'),lambda c:c['capture'].__setitem__('runtimeId','f'*64),lambda c:c['localDevSuspension'].__setitem__('receiptSha256','f'*64),lambda c:c['helpers']['suspensionOwner'].__setitem__('sha256','f'*64),lambda c:c['helpers']['suspensionVerifier'].__setitem__('sha256','f'*64)]:
   cfg,_,_=fixture();change(cfg)
   with self.assertRaises((RuntimeError,KeyError)):m.validate_scope(cfg,False)
 def test_failed_nonEOF_wrongtarget_stop_or_any_other_unhealthy_refuse(self):
  for change in [lambda v:v['stop'].__setitem__('code',1),lambda v:v['stop'].__setitem__('stderrEof',False),lambda v:v['stop'].__setitem__('interrupted',True),lambda v:v.__setitem__('service','frontend-candidate'),lambda v:v['stopped'].__setitem__('exitCode',137)]:
   cfg,_,_=fixture();mutate_receipt(cfg,change)
   with self.assertRaises(RuntimeError):m.validate_scope(cfg,False)
  for service in m.SERVICES-{'frontend'}:
   cfg,rows,_=fixture();next(r for r in rows if r['Service']==service)['State']='exited'
   with self.assertRaises(RuntimeError):m.validate_rows(rows,cfg,False)
 def test_producer_default_and_production_census_remain_strict(self):
  cfg,rows,_=fixture()
  with self.assertRaises(RuntimeError):p.validate_census(rows,cfg['expectedContainerIds'],'sabalanerp-local')
  with self.assertRaises(RuntimeError):p.validate_census(rows,cfg['expectedContainerIds'],'sabalanerp',local_context=cfg)
  with self.assertRaises(RuntimeError):p.validate_census(rows,cfg['expectedContainerIds'],'sabalanerp-local',True,local_context=cfg)
  with self.assertRaises(RuntimeError):p.validate_configuration(dict(format='sabalan-original-online-checkpoint-producer/v1',project='sabalanerp',localDevSuspension=None))
 def test_actual_producer_docker_branch_checks_census_and_fresh_inspection_before_command(self):
  cfg,rows,dev=fixture();events=[];old=p.local_dev_validator;p.local_dev_validator=lambda c:types.SimpleNamespace(validate_rows=lambda r,c:m.validate_rows(r,c,False),validate_scope=lambda c:m.validate_scope(c,False),validate_inspected=lambda v,c:m.validate_inspected(v,c,False))
  old_runtime=p.host_runtime;p.host_runtime=lambda c:dict(docker=['genuine-docker'])
  def command(name,args,**kwargs):events.append(name);return(name,args)
  harness=types.SimpleNamespace(config=cfg,ownership=lambda:None,command=command,children=types.SimpleNamespace(finish=lambda child:json.dumps(rows if child[0]=='compose-ps'else[dev]).encode()))
  try:
   p.Producer.docker(harness,['inspect','target']);self.assertEqual(events,['compose-ps','local-dev-inspect','docker']);dev['State']['Pid']=9;events.clear()
   with self.assertRaises(RuntimeError):p.Producer.docker(harness,['inspect','target'])
   self.assertNotIn('docker',events)
  finally:p.local_dev_validator=old;p.host_runtime=old_runtime
 def test_actual_physical_guard_and_owner_census_execute_same_strict_scope_and_fresh_inspection(self):
  cfg,rows,dev=fixture();old=p.local_dev_validator;p.local_dev_validator=lambda c:types.SimpleNamespace(validate_rows=lambda r,c:m.validate_rows(r,c,False),validate_scope=lambda c:m.validate_scope(c,False),validate_inspected=lambda v,c:m.validate_inspected(v,c,False));events=[]
  class Children:
   def start(self,name,args,**kw):events.append(name);return name
   def finish(self,name):return json.dumps(rows if name.startswith('compose-ps')or name.startswith('census-')else[dev]).encode()
   def closed(self):return True
  children=Children();runtime=dict(docker=['genuine-docker']);namespace=dict(owner=children,runtime=runtime,value=cfg,json=json,validate_census=p.validate_census,inspect_local_dev_suspension=p.inspect_local_dev_suspension,require=p.require)
  tree=ast.parse((ROOT/'deploy/scripts/online-checkpoint-producer.py').read_text(encoding='utf8'));node=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='docker_guard');start=next(i for i,n in enumerate(node.body)if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='census'for t in n.targets));end=next(i for i,n in enumerate(node.body)if isinstance(n,ast.Expr)and isinstance(n.value,ast.Call)and isinstance(n.value.func,ast.Attribute)and n.value.func.attr=='execv');block=ast.fix_missing_locations(ast.Module(body=node.body[start:end],type_ignores=[]))
  harness=types.SimpleNamespace(assert_owned=lambda:None,runtime=runtime,base=cfg,children=children,p=p)
  try:
   exec(compile(block,'actual-physical-guard','exec'),namespace);o.OriginalLocalCheckpointOwner.census(harness);self.assertTrue(any(x.startswith('local-dev-inspect')for x in events));rows[0]['Project']='other'
   with self.assertRaises(RuntimeError):exec(compile(block,'actual-physical-guard','exec'),namespace)
   with self.assertRaises(RuntimeError):o.OriginalLocalCheckpointOwner.census(harness)
  finally:p.local_dev_validator=old
 def test_source_closure_has_each_verifier_and_no_configuration_only_waiver(self):
  entry=(ROOT/'deploy/scripts/local-online-checkpoint-entry.py').read_text(encoding='utf8');driver=(ROOT/'deploy/scripts/local-online-checkpoint-driver.py').read_text(encoding='utf8')
  for name in ['local-dev-frontend-suspension.py','scripts/lib/local-dev-frontend-suspension.mjs','scripts/run-local-dev-frontend-suspension.mjs']:self.assertIn(name,entry)
  for field in ['receiptRawBase64','receiptSha256','capture','ownerSourceSha256','verifierSourceSha256']:self.assertIn(field,(ROOT/'deploy/scripts/local-dev-frontend-suspension.py').read_text(encoding='utf8'))
  self.assertIn('suspensionVerifier',driver)
if __name__=='__main__':unittest.main()
