"""Data-boundary fixtures only, never a production baseline or live lease."""
import runpy,pathlib,unittest,copy
ROOT=pathlib.Path(__file__).resolve().parents[2]
M=runpy.run_path(str(ROOT/'deploy/scripts/original-complete-production-admission.py'),run_name='source_projection_unit')
class ExactProductionRestartTests(unittest.TestCase):
 def fixture(self):
  before=[dict(id=str(i)*64,project='sabalanerp',service=name,image='sha256:'+str(i)*64,restartCount=0,startedAt='2026-10-20T00:00:00Z',status='running',health='healthy')for i,name in enumerate(['backend','frontend','inquiry','nginx','postgres','clamav'],1)]
  before +=[dict(id='7'*64,project='sabalanerp',service='preparation-a',image='sha256:'+'7'*64,restartCount=0,startedAt='2026-10-20T00:00:00Z',status='exited',health='unhealthy'),dict(id='8'*64,project='sabalanerp',service='preparation-b',image='sha256:'+'8'*64,restartCount=0,startedAt='2026-10-20T00:00:00Z',status='exited',health='unhealthy')]
  before[0].update(restartCount=4,startedAt='2026-10-26T06:04:29.230523694Z');after=copy.deepcopy(before);after[0].update(restartCount=21,startedAt='2026-10-27T18:00:37.843913269Z');backend=dict(containerId='1'*64,restartCount=21,startedAt=after[0]['startedAt']);return before,after,backend
 def test_exact_observed_delta_requires_all_six_healthy(self):
  old,new,b=self.fixture();self.assertTrue(M['validate_restart_projection'](old,new,b));new[5]['health']='unhealthy'
  with self.assertRaises(AssertionError):M['validate_restart_projection'](old,new,b)
 def test_unknown_restart_or_foreign_incarnation_change_refuses(self):
  for edit in[lambda a:a[0].update(restartCount=22),lambda a:a[1].update(startedAt='2026-10-28T00:00:00Z'),lambda a:a[0].update(image='sha256:'+'a'*64),lambda a:a[5].update(id='a'*64)]:
   old,new,b=self.fixture();edit(new)
   with self.assertRaises(AssertionError):M['validate_restart_projection'](old,new,b)
class NextRestartTests(unittest.TestCase):
 fixture=ExactProductionRestartTests.fixture
 def next_fixture(self):
  before,old,b21=self.fixture();after=copy.deepcopy(old);after[0].update(restartCount=22,startedAt='2026-10-31T06:04:48.465160924Z');b22={**b21,'restartCount':22,'startedAt':after[0]['startedAt'],'image':after[0]['image'],'project':'sabalanerp','service':'backend','healthStatus':'healthy','status':'running','exitCode':0,'oomKilled':False};return before,after,b21,b22
 def test_exact_next_restart_only_preserves_every_other_row_and_field(self):
  self.assertTrue(M['validate_backend22_projection'](*self.next_fixture()))
 def test_unknown_restart_incarnation_configuration_or_health_refuses(self):
  for edit in [lambda a:a[0].update(restartCount=23),lambda a:a[0].update(startedAt='2026-10-31T06:05:00Z'),lambda a:a[0].update(image='sha256:'+'a'*64),lambda a:a[1].update(restartCount=1),lambda a:a[5].update(health='unhealthy'),lambda a:a[0].update(unobserved=True)]:
   args=list(self.next_fixture());edit(args[1])
   with self.assertRaises(AssertionError):M['validate_backend22_projection'](*args)
  for edit in [lambda a:a.update(restartCount=23),lambda a:a.update(healthStatus='unhealthy'),lambda a:a.update(oomKilled=True),lambda a:a.update(containerId='a'*64),lambda a:a.update(image='sha256:'+'a'*64),lambda a:a.update(project='foreign')]:
   args=list(self.next_fixture());edit(args[3])
   with self.assertRaises(AssertionError):M['validate_backend22_projection'](*args)
 def test_actual_observation_keeps_original_output_and_closure_provenance(self):
  native=M['observed_backend22']();self.assertTrue(native['readOnly']);self.assertFalse(native['runtimeAccepted'])
  namespace=M['observed_backend22'].__globals__;prior=namespace['NEXT_DIAGNOSTIC']
  try:
   namespace['NEXT_DIAGNOSTIC']={**prior,'sha256':'a'*64}
   with self.assertRaises(AssertionError):M['observed_backend22']()
  finally:namespace['NEXT_DIAGNOSTIC']=prior
class CurrentRestartTests(unittest.TestCase):
 next_fixture=NextRestartTests.next_fixture
 fixture=ExactProductionRestartTests.fixture
 def current_fixture(self):
  before,after,b21,b22=self.next_fixture();after[0].update(restartCount=24,startedAt='2026-10-31T08:41:12.469838113Z');b24={**b22,'restartCount':24,'startedAt':after[0]['startedAt']};return before,after,b21,b22,b24
 def test_only_exact24_with_closed_original_observation_can_project(self):
  self.assertTrue(M['validate_backend24_projection'](*self.current_fixture()))
  native=M['observed_runtime'](M['CURRENT_DIAGNOSTIC']);self.assertEqual(native['containers']['backend']['restartCount'],24);self.assertTrue(native['readOnly']);self.assertFalse(native['runtimeAccepted'])
  with self.assertRaises(AssertionError):M['observed_runtime']({**M['CURRENT_DIAGNOSTIC'],'sha256':'a'*64})
 def test_intermediate_future_foreign_or_unhealthy_state_never_projects(self):
  for edit in [lambda a:a[0].update(restartCount=23),lambda a:a[0].update(restartCount=25),lambda a:a[0].update(startedAt='2026-10-31T08:41:13Z'),lambda a:a[0].update(image='sha256:'+'a'*64),lambda a:a[0].update(id='a'*64),lambda a:a[1].update(restartCount=1),lambda a:a[5].update(health='unhealthy'),lambda a:a[0].update(unobserved=True)]:
   args=list(self.current_fixture());edit(args[1])
   with self.assertRaises(AssertionError):M['validate_backend24_projection'](*args)
  for edit in [lambda a:a.update(restartCount=23),lambda a:a.update(restartCount=25),lambda a:a.update(healthStatus='unhealthy'),lambda a:a.update(status='exited'),lambda a:a.update(oomKilled=True),lambda a:a.update(exitCode=137),lambda a:a.update(containerId='a'*64),lambda a:a.update(image='sha256:'+'a'*64),lambda a:a.update(project='foreign')]:
   args=list(self.current_fixture());edit(args[4])
   with self.assertRaises(AssertionError):M['validate_backend24_projection'](*args)
 def test_historical_baseline_never_becomes_current_admission(self):
  reference={'file':'D:/sabalanerp-online-qa/source-install-healthy-baseline-20261031T093104222772Z.json','sha256':'13821911c0209ef31f64cc0bd654a723d6c625dbf56398c9ae005f282c81eb90'}
  with self.assertRaisesRegex(AssertionError,'FRESH_HEALTHY_BASELINE_REQUIRED'):M['current_spec'](reference)

class NovemberRestartTests(unittest.TestCase):
 fixture=ExactProductionRestartTests.fixture
 next_fixture=NextRestartTests.next_fixture
 current_fixture=CurrentRestartTests.current_fixture
 def november_fixture(self):
  before,after,b21,b22,b24=self.current_fixture();after[0].update(restartCount=25,startedAt='2026-11-01T07:04:18.342321471Z');b25={**b24,'restartCount':25,'startedAt':after[0]['startedAt']};return before,after,b21,b22,b24,b25
 def test_exact25_requires_closed_diagnostic_and_all_prior_projections(self):
  self.assertTrue(M['validate_backend25_projection'](*self.november_fixture()))
  native=M['observed_runtime'](M['NOVEMBER_DIAGNOSTIC']);self.assertEqual(native['containers']['backend']['restartCount'],25);self.assertTrue(native['allOriginalChildrenClosed']);self.assertFalse(native['runtimeAccepted'])
  with self.assertRaises(AssertionError):M['observed_runtime']({**M['NOVEMBER_DIAGNOSTIC'],'sha256':'a'*64})
 def test_unknown_incarnations_health_and_unrelated_fields_refuse(self):
  edits=[lambda a:a[0].update(restartCount=24),lambda a:a[0].update(restartCount=26),lambda a:a[0].update(startedAt='2026-11-01T07:04:19Z'),lambda a:a[0].update(image='sha256:'+'a'*64),lambda a:a[0].update(id='a'*64),lambda a:a[1].update(restartCount=1),lambda a:a[5].update(health='unhealthy'),lambda a:a[0].update(extra=True)]
  for edit in edits:
   args=list(self.november_fixture());edit(args[1])
   with self.assertRaises(AssertionError):M['validate_backend25_projection'](*args)
  for edit in [lambda a:a.update(restartCount=26),lambda a:a.update(healthStatus='unhealthy'),lambda a:a.update(status='exited'),lambda a:a.update(oomKilled=True),lambda a:a.update(exitCode=137),lambda a:a.update(containerId='a'*64),lambda a:a.update(image='sha256:'+'a'*64),lambda a:a.update(project='foreign')]:
   args=list(self.november_fixture());edit(args[5])
   with self.assertRaises(AssertionError):M['validate_backend25_projection'](*args)
  args=list(self.november_fixture());args[4]['oomKilled']=True
  with self.assertRaises(AssertionError):M['validate_backend25_projection'](*args)
 def test_actual_captured_projection_and_original_bytes_without_current_admission(self):
  import hashlib,json,datetime
  file=pathlib.Path('D:/sabalanerp-online-qa/source-install-healthy-baseline-20261101T082857844279Z.json');reference={'file':str(file),'sha256':hashlib.sha256(file.read_bytes()).hexdigest()}
  # Fixed captured content; a new baseline at this path cannot authorize itself.
  self.assertEqual(reference['sha256'],'2ac95bcbf3c4757a918d463c4376df5bee9393982b78ce881a84f62b84b8bde2')
  envelope=json.loads(file.read_bytes());original=json.loads(pathlib.Path(envelope['original']['file']).read_bytes());contract=runpy.run_path('D:/sabalanerp-online-qa/C29-installed45cab-healthy-baseline-source-r2-exact-bytes-20261024/baseline-contract.py')
  # Explicit canonical fixture-clock seam authenticates captured content only.
  # Runtime current_spec still has no clock override and enforces real freshness.
  captured=contract['validate_original_baseline'](envelope,original,now=datetime.datetime.fromisoformat(envelope['result']['completedAt']))
  parent=runpy.run_path(M['PARENT']['file']);_,old,_=parent['observed']()
  diagnostics=[M['observed_runtime'](M[key])['containers']['backend']for key in ['DIAGNOSTIC','NEXT_DIAGNOSTIC','CURRENT_DIAGNOSTIC','NOVEMBER_DIAGNOSTIC']]
  self.assertTrue(M['validate_backend25_projection'](old['currentEight'],captured['expectedEight'],*diagnostics));self.assertFalse(captured['productionAdmission'])
  with self.assertRaisesRegex(AssertionError,'FRESH_HEALTHY_BASELINE_REQUIRED'):contract['validate_original_baseline'](envelope,original,now=datetime.datetime.fromisoformat(captured['completedAt'])+datetime.timedelta(seconds=601))

class BoundedCurrentRestartTests(unittest.TestCase):
 fixture=ExactProductionRestartTests.fixture
 next_fixture=NextRestartTests.next_fixture
 current_fixture=CurrentRestartTests.current_fixture
 november_fixture=NovemberRestartTests.november_fixture
 def current_fixture27(self):
  args=list(self.november_fixture());args[1][0].update(restartCount=27,startedAt='2026-11-01T12:13:13.652064434Z');return (*args,{**args[-1],'restartCount':27,'startedAt':args[1][0]['startedAt']})
 def test_only_exact_observed27_preserves_complete_prior_lineage(self):
  self.assertTrue(M['validate_backend27_projection'](*self.current_fixture27()))
  native=M['observed_current_runtime']();self.assertEqual(native['containers']['backend']['restartCount'],27);self.assertEqual(native['beforeEight'],native['afterEight']);self.assertTrue(native['recoveryBoundaryBefore']['clear']);self.assertTrue(native['recoveryBoundaryAfter']['clear'])
 def test_actual_captured_projection_is_historical_and_never_fresh_admission(self):
  parent=runpy.run_path(M['PARENT']['file']);_,old,_=parent['observed']();native=M['observed_current_runtime']()
  diagnostics=[M['observed_runtime'](M[key])['containers']['backend']for key in ['DIAGNOSTIC','NEXT_DIAGNOSTIC','CURRENT_DIAGNOSTIC','NOVEMBER_DIAGNOSTIC']]
  self.assertTrue(M['validate_backend27_projection'](old['currentEight'],native['beforeEight'],*diagnostics,native['containers']['backend']))
  with self.assertRaisesRegex(AssertionError,'FRESH_HEALTHY_BASELINE_REQUIRED'):M['current_spec']({'file':'D:/sabalanerp-online-qa/source-install-healthy-baseline-20261101T121343421373Z.json','sha256':'ae8887b5fcd76a1511d40d47b1c0df43279ef5e08853a17f3caa98380f93aa74'})
 def test_future_intermediate_unrelated_and_unhealthy_changes_refuse(self):
  for edit in [lambda a:a[0].update(restartCount=26),lambda a:a[0].update(restartCount=28),lambda a:a[0].update(startedAt='2026-11-01T12:13:14Z'),lambda a:a[1].update(restartCount=1),lambda a:a[0].update(image='sha256:'+'a'*64),lambda a:a[5].update(health='unhealthy'),lambda a:a[0].update(extra=True)]:
   args=list(self.current_fixture27());edit(args[1])
   with self.assertRaises(AssertionError):M['validate_backend27_projection'](*args)
  for edit in [lambda a:a.update(restartCount=28),lambda a:a.update(oomKilled=True),lambda a:a.update(exitCode=137),lambda a:a.update(healthStatus='unhealthy')]:
   args=list(self.current_fixture27());edit(args[-1])
   with self.assertRaises(AssertionError):M['validate_backend27_projection'](*args)

class ObservedRestart28Tests(BoundedCurrentRestartTests):
 def current_fixture28(self):
  args=list(self.current_fixture27());args[1][0].update(restartCount=28,startedAt='2026-11-02T05:19:06.28844193Z');return (*args,{**args[-1],'restartCount':28,'startedAt':args[1][0]['startedAt']})
 def test_exact28_observation_preserves_lineage_and_is_not_admission(self):
  self.assertTrue(M['validate_backend28_projection'](*self.current_fixture28()))
  observed=M['observed_restart28']();self.assertEqual(observed['containers']['backend']['restartCount'],28);self.assertFalse(observed['runtimeAccepted']);self.assertTrue(observed['canonicalConfigurationGateMatches'])
 def test_unknown_future_health_identity_and_other_service_changes_refuse28(self):
  for edit in [lambda a:a[0].update(restartCount=29),lambda a:a[0].update(startedAt='2026-11-02T05:19:07Z'),lambda a:a[0].update(image='sha256:'+'a'*64),lambda a:a[1].update(restartCount=1),lambda a:a[5].update(health='unhealthy')]:
   args=list(self.current_fixture28());edit(args[1])
   with self.assertRaises(AssertionError):M['validate_backend28_projection'](*args)
  for field,value in [('oomKilled',True),('exitCode',137),('healthStatus','unhealthy'),('containerId','a'*64)]:
   args=list(self.current_fixture28());args[-1][field]=value
   with self.assertRaises(AssertionError):M['validate_backend28_projection'](*args)
 def test_observation_refuses_changed_pin_and_original_closure(self):
  import json,hashlib,tempfile
  namespace=M['observed_restart28'].__globals__;prior=namespace['RESTART28_DIAGNOSTIC']
  try:
   namespace['RESTART28_DIAGNOSTIC']={**prior,'sha256':'a'*64}
   with self.assertRaises(AssertionError):M['observed_restart28']()
   record=json.loads(pathlib.Path(prior['file']).read_bytes())
   with tempfile.TemporaryDirectory(prefix='restart28-rejected-proof-')as directory:
    for domain,key,value in [('original','code',1),('original','stdoutEof',False),('original','observationFaultTotal',1),('diagnostic','canonicalConfigurationGateMatches',False),('diagnostic','runtimeAccepted',True)]:
     changed=copy.deepcopy(record);changed[domain][key]=value;raw=(json.dumps(changed)+'\n').encode();file=pathlib.Path(directory)/(domain+'-'+key+'.json');file.write_bytes(raw)
     namespace['RESTART28_DIAGNOSTIC']={'file':str(file.resolve()),'sha256':hashlib.sha256(raw).hexdigest()}
     with self.assertRaises(AssertionError):M['observed_restart28']()
  finally:namespace['RESTART28_DIAGNOSTIC']=prior

class SourceRestartDiagnosticTests(unittest.TestCase):
 def helper(self):return runpy.run_path(str(ROOT/'deploy/scripts/original-source-runtime-diagnostics.py'),run_name='bounded_log_metadata_unit')
 def test_conservation_failure_exports_safe_witness_and_stays_negative(self):
  import io,contextlib,json
  m=self.helper();before=[{'id':'a'*64,'restartCount':27}];after=[{'id':'a'*64,'restartCount':28}];stream=io.StringIO()
  with contextlib.redirect_stdout(stream),self.assertRaisesRegex(AssertionError,'SOURCE_RUNTIME_CONSERVATION_FAILED'):
   m['require_runtime_conservation'](before,after,{'a'*64:'b'*64},{'a'*64:'c'*64},[{'sha256':'d'*64}],[{'sha256':'d'*64}])
  witness=json.loads(stream.getvalue());self.assertEqual(witness['checks'],{'containerCensusUnchanged':False,'configurationUnchanged':False,'protectedFilesUnchanged':True});self.assertEqual(witness['beforeEight'],before);self.assertEqual(witness['afterEight'],after);self.assertFalse(witness['productionAdmission']);self.assertFalse(witness['runtimeAccepted'])
  stream=io.StringIO()
  with contextlib.redirect_stdout(stream):m['require_runtime_conservation'](before,before,{}, {}, [], [])
  self.assertEqual(stream.getvalue(),'')
 def test_configuration_changed_field_exports_no_values_or_field_digests(self):
  import json
  m=self.helper();before=[{'Id':'a'*64,'Config':{'Env':['PASSWORD=PRIVATE_BEFORE']},'HostConfig':{'Memory':128},'Mounts':[],'NetworkSettings':{}}];after=copy.deepcopy(before);after[0]['Config']['Env']=['PASSWORD=PRIVATE_AFTER']
  changes=m['configuration_changed_fields'](before,after)
  self.assertEqual(changes,{'a'*64:['Config.Env']});self.assertNotIn('PRIVATE_',json.dumps(changes));self.assertNotIn('PASSWORD',json.dumps(changes));self.assertEqual(m['configuration_changed_fields'](before,before),{})
 def test_mount_enumeration_order_is_not_configuration_but_all_mount_values_are(self):
  m=self.helper();before=[{'Id':'a'*64,'Config':{'Env':['PASSWORD=PRIVATE_BEFORE']},'HostConfig':{},'NetworkSettings':{},'Mounts':[{'Source':'/private/a','Destination':'/a','RW':False},{'Source':'/private/b','Destination':'/b','RW':True}]}];after=copy.deepcopy(before);after[0]['Mounts'].reverse()
  self.assertEqual(m['configuration_snapshot'](before),m['configuration_snapshot'](after))
  for key,value in [('Source','/other'),('Destination','/other'),('RW',False),('unknownField','must-not-be-ignored')]:
   changed=copy.deepcopy(after);changed[0]['Mounts'][0][key]=value;self.assertNotEqual(m['configuration_snapshot'](before),m['configuration_snapshot'](changed))
  duplicate=copy.deepcopy(before);duplicate[0]['Mounts'].append(copy.deepcopy(duplicate[0]['Mounts'][0]))
  with self.assertRaisesRegex(AssertionError,'DUPLICATE_MOUNT_DESTINATION'):m['configuration_snapshot'](duplicate)
 def test_shutdown_classification_exports_only_fixed_literals(self):
  import json
  m=self.helper();secret='PRIVATE_CREDENTIAL_VALUE'
  raw=('2026-11-01T12:13:13Z Received SIGTERM; draining connections before shutdown. '+secret+'\n2026-11-01T12:13:14Z Backend startup blocked: '+secret+'\n2026-11-01T12:13:15Z ? Server running on port 5000 '+secret+'\n2026-11-01T12:13:16Z Received UNKNOWN; '+secret).encode()
  value=m['safe_log'](raw);labels={match['classification']for row in value['safeMatches']for match in row['matches']}
  self.assertTrue({'CONTROLLED_SHUTDOWN','BACKEND_STARTUP_BLOCKED','BACKEND_LISTENING'}<=labels);self.assertNotIn(secret,json.dumps(value));self.assertFalse(value['rawTextExported'])
 def test_readiness_does_not_replace_recovery_boundary_metadata(self):
  m=self.helper();value={'state':{'mode':'NORMAL','operationPresent':False},'markers':{name:False for name in ['pending-restore.json','deployment-maintenance.json','restart-inquiry','inquiry-stopped']},'activeCounts':{name:0 for name in ['CREATING','VALIDATING','RESTORING']}}
  self.assertTrue(m['recovery_boundary_clear'](value))
  for mutate in [lambda v:v['state'].update(mode='MAINTENANCE'),lambda v:v['state'].update(operationPresent=True),lambda v:v['markers'].update({'pending-restore.json':True}),lambda v:v['activeCounts'].update(RESTORING=1)]:
   changed=copy.deepcopy(value);mutate(changed);self.assertFalse(m['recovery_boundary_clear'](changed))
 def test_actual_node_probe_owns_client_through_readonly_and_failure_closure(self):
  import tempfile,json,subprocess
  probe=self.helper()['RECOVERY_METADATA_PROBE']
  for mode in ['valid','state-missing','query-failure','not-readonly','invalid-date-type','invalid-message','invalid-operation','marker-created']:
   with self.subTest(mode=mode),tempfile.TemporaryDirectory(prefix='source-recovery-metadata-')as name:
    directory=pathlib.Path(name);state=directory/'state.json';trace=directory/'client-closed.json'
    if mode!='state-missing':
     value=dict(mode='NORMAL',updatedAt=2026 if mode=='invalid-date-type'else'2026-11-01T12:00:00Z')
     if mode=='invalid-message':value['message']=42
     if mode=='invalid-operation':value['operationId']=42
     state.write_text(json.dumps(value),encoding='utf-8')
    program=r"""const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');const directory=process.argv[1],trace=process.argv[2],mode=process.argv[3];let readonly=false,queries=0,disconnects=0;
class PrismaClient{async $transaction(work,options){assert.equal(options.isolationLevel,'RepeatableRead');const result=await work({$executeRawUnsafe:async sql=>{assert.equal(sql,'SET TRANSACTION READ ONLY');readonly=true;},$queryRawUnsafe:async()=>[{mode:mode==='not-readonly'?'off':'on'}],recoveryOperation:{count:async()=>{assert.equal(readonly,true);queries++;if(mode==='query-failure')throw Error('PRIVATE_CREDENTIAL_VALUE');return 0;},aggregate:async()=>({_max:{updatedAt:null,restoreStartedAt:null,completedAt:null}})},recoveryAuditEvent:{findMany:async args=>{assert.equal(JSON.stringify(args.select),JSON.stringify({eventType:true,createdAt:true}));return[];}}});if(mode==='marker-created')fs.writeFileSync(require('node:path').join(directory,'pending-restore.json'),'private fixture');return result;}async $disconnect(){disconnects++;fs.writeFileSync(trace,JSON.stringify({disconnects,queries,readonly,fixtureOnly:true,realSqlExecuted:false}));}}
// Linux named/fd stat identity is modeled on Windows; bytes, process and pipes are real.
const fixtureFs=Object.create(fs);fixtureFs.fstatSync=()=>fs.lstatSync(require('node:path').join(directory,'state.json'),{bigint:true});const scopedRequire=name=>name==='@prisma/client'?{PrismaClient}:name==='node:fs'?fixtureFs:require(name);vm.runInNewContext(PROBE,{require:scopedRequire,process:{env:{RECOVERY_COORDINATION_DIR:directory},cwd:()=>directory,stdout:process.stdout,stderr:process.stderr,set exitCode(value){process.exitCode=value;}},console,Buffer});
""".replace('PROBE',json.dumps(probe))
    child=subprocess.Popen(['C:/Program Files/nodejs/node.exe','-e',program,str(directory),str(trace),mode],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    out,err=child.communicate();self.assertLess(len(out)+len(err),65536);self.assertEqual(child.returncode,0 if mode=='valid'else 1);self.assertTrue(child.stdout.closed and child.stderr.closed)
    closed=json.loads(trace.read_bytes());self.assertEqual(closed['disconnects'],1);self.assertFalse(closed['realSqlExecuted']);self.assertEqual(closed['queries'],{'valid':3,'state-missing':0,'query-failure':1,'not-readonly':0,'invalid-date-type':0,'invalid-message':0,'invalid-operation':0,'marker-created':3}[mode]);self.assertNotIn(b'PRIVATE_CREDENTIAL_VALUE',out+err)
    if mode=='valid':
     value=json.loads(out);self.assertTrue(value['transactionReadOnly']);self.assertFalse(value['contentsReturned']);self.assertEqual(closed['queries'],3);self.assertNotIn(name.encode(),out)
    else:self.assertEqual(err,b'READONLY_RECOVERY_METADATA_REFUSED\n')

class PreparationSourceTests(unittest.TestCase):
 def test_actual_canonical_preparation_renders_without_any_production_input(self):
  m=runpy.run_path(str(ROOT/'deploy/scripts/prepare-original-complete-production-inputs.py'),run_name='pure_prepare_test');source=m['render_preparation_source']('D:/sabalanerp-online-qa/source-install-healthy-baseline-UNIT-NOT-LIVE.json');compile(source,'bounded-canonical-preparation','exec');self.assertIn('original-complete-production-admission.py',source);self.assertIn('419-complete-production-source-',source);self.assertNotIn("admission=(ROOT/'scripts/lib/source-a-current-admission.py').read_bytes()",source)
if __name__=='__main__':unittest.main()
