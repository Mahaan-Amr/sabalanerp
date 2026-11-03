"""Data-only exact observed restart successor. Never repairs or admits an
unhealthy service. Fresh original baseline + unchanged full config guard remain.
"""
import copy,hashlib,json,pathlib,runpy
Q=pathlib.Path('D:/sabalanerp-online-qa')
PARENT={'file':str(Q/'ticket413-fourth-restart-preflight-source-source-install-healthy-baseline-20261026T062857223649Z/current-admission.py'),'sha256':'7d52f6f9e9beaba0582032219e449db3b2a117ca0c42a9d80ed6f1b26d788a4c'}
DIAGNOSTIC={'file':str(pathlib.Path(__file__).resolve().parents[2]/'reports/qa/issue-419-c3-bindings-20261026/SOURCE-RUNTIME-DIAGNOSTIC-75d5ffe4adc2b666a248b13ef22d869d.json'),'sha256':'6a925b7299a26df8659f7b8d65c7a317d7d960458686ca1ea11fc5f61654e467'}
NEXT_DIAGNOSTIC={'file':str(pathlib.Path(__file__).resolve().parents[2]/'reports/qa/issue-419-c3-bindings-20261026/SOURCE-RUNTIME-DIAGNOSTIC-8e296439617dc57afa9ab0bdcfa7e05f.json'),'sha256':'bf0ec0c3bd8ca90b77eedc3b060abfb9626e100e7d4c0004c4141f3c464ae223'}
CURRENT_DIAGNOSTIC={'file':str(pathlib.Path(__file__).resolve().parents[2]/'reports/qa/issue-419-c3-bindings-20261026/SOURCE-RUNTIME-DIAGNOSTIC-d3eb2685da605f009b2b5361083bd07c.json'),'sha256':'dd7ef9d3f295c604464b3d104c07ea827f62a0e4553280f7c1787ae79b249aed'}
NOVEMBER_DIAGNOSTIC={'file':str(pathlib.Path(__file__).resolve().parents[2]/'reports/qa/issue-419-c3-bindings-20261026/SOURCE-RUNTIME-DIAGNOSTIC-016e219f84bed9eb343af5692af8d09b.json'),'sha256':'cfe0df3422ea770133876fb7928ff246ade4e74bf37b4b63bd280ee41b08f55e'}
BOUNDED_CURRENT_DIAGNOSTIC={'file':str(pathlib.Path(__file__).resolve().parents[2]/'reports/qa/issue-419-c3-bindings-20261026/SOURCE-RUNTIME-DIAGNOSTIC-63bdf02bbaf17e1ab51b3388866925f8.json'),'sha256':'d0b03a01eeba39377ac6edf9416a5d14db899984a09d306e926dbc6458150f42'}
RESTART28_DIAGNOSTIC={'file':str(pathlib.Path(__file__).resolve().parents[2]/'reports/qa/issue-419-c3-bindings-20261026/SOURCE-RUNTIME-DIAGNOSTIC-d52c-boundary-20261102.json'),'sha256':'99854ef095b8814c7d5da0ceea089fcc5876fa918524bb6a0a9591fcf6ab69fc'}
def checked(ref):
 p=pathlib.Path(ref['file']);a=p.lstat();assert p.resolve(strict=True)==p and p.is_file()and not p.is_symlink()and a.st_nlink==1
 raw=p.read_bytes();b=p.lstat();assert(a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(b.st_ino,b.st_size,b.st_mtime_ns,b.st_ctime_ns)and hashlib.sha256(raw).hexdigest()==ref['sha256'];return raw
def validate_restart_projection(before,after,backend):
 assert len(before)==len(after)==8;old={r['id']:r for r in before};new={r['id']:r for r in after};assert set(old)==set(new)
 main=[r for r in after if r['project']=='sabalanerp'and r['service']in['backend','frontend','inquiry','nginx','postgres','clamav']];assert len(main)==6 and all(r['status']=='running'and r['health']=='healthy'for r in main)
 for identity,row in old.items():
  now=new[identity]
  if row['project']=='sabalanerp'and row['service']=='backend':
   assert identity==backend['containerId']and row['restartCount']==4 and row['startedAt']=='2026-10-26T06:04:29.230523694Z'
   assert now['restartCount']==backend['restartCount']==21 and now['startedAt']==backend['startedAt']=='2026-10-27T18:00:37.843913269Z'
   assert {k:v for k,v in row.items()if k not in['restartCount','startedAt']}=={k:v for k,v in now.items()if k not in['restartCount','startedAt']}
  else:assert now==row
 return True

def validate_backend22_projection(before,after,previous_backend,current_backend):
 # Expected projections are data only; never edit the genuine fresh baseline
 # or feed a fabricated envelope to its canonical verifier.
 expected=copy.deepcopy(before)
 row=next(r for r in expected if r['project']=='sabalanerp'and r['service']=='backend')
 row.update(restartCount=21,startedAt='2026-10-27T18:00:37.843913269Z')
 validate_restart_projection(before,expected,previous_backend)
 assert current_backend['containerId']==previous_backend['containerId']==row['id']
 assert current_backend['image']==row['image']and current_backend['project']=='sabalanerp'and current_backend['service']=='backend'
 assert current_backend['restartCount']==22 and current_backend['startedAt']=='2026-10-31T06:04:48.465160924Z'
 assert current_backend['status']=='running'and current_backend['healthStatus']=='healthy'and current_backend['exitCode']==0 and current_backend['oomKilled']is False
 row.update(restartCount=22,startedAt=current_backend['startedAt'])
 assert after==expected,'ONLY_EXACT_OBSERVED_RESTART22_ALLOWED'
 return True

def observed_runtime(reference):
 record=json.loads(checked(reference))
 assert record['diagnosticOnly']is True and record['qualificationAccepted']is False and record['leaseClosed']is True
 assert record['originalChildren']['allOriginalChildrenClosed']is True and record['originalChildren']['interrupted']is False
 assert len(record['children'])==2
 for child in record['children']:assert child['code']==0 and child['signal']is None and child['stdoutEof']is True and child['stderrEof']is True and child['killed']is False and child['outputBoundExceeded']is False
 assert hashlib.sha256(record['children'][0]['stdout'].encode()).hexdigest()==record['sourceSha256']
 native=json.loads(record['children'][1]['stdout']);assert native==record['observation']
 assert native['readOnly']is True and native['runtimeAccepted']is False and native['allOriginalChildrenClosed']is True
 for child in native['originalChildren']:assert child['code']==0 and child['stdoutEof']is True and child['stderrEof']is True and child['observationFault']is None
 for child in native['kernelChildren']:assert child['code']==0 and child['pipesClosed']is True and child['observationFault']is None
 return native

def observed_backend22():
 return observed_runtime(NEXT_DIAGNOSTIC)

def validate_backend24_projection(before,after,previous_backend,backend22,current_backend):
 # Preserve the complete previous projection and accept neither an intermediate
 # restart23 nor an arbitrary future restart. Diagnostics never prove its cause.
 expected=copy.deepcopy(before)
 row=next(r for r in expected if r['project']=='sabalanerp'and r['service']=='backend')
 row.update(restartCount=22,startedAt='2026-10-31T06:04:48.465160924Z')
 validate_backend22_projection(before,expected,previous_backend,backend22)
 assert current_backend['containerId']==backend22['containerId']==row['id']
 assert current_backend['image']==row['image']and current_backend['project']=='sabalanerp'and current_backend['service']=='backend'
 assert current_backend['restartCount']==24 and current_backend['startedAt']=='2026-10-31T08:41:12.469838113Z'
 assert current_backend['status']=='running'and current_backend['healthStatus']=='healthy'and current_backend['exitCode']==0 and current_backend['oomKilled']is False
 row.update(restartCount=24,startedAt=current_backend['startedAt'])
 assert after==expected,'ONLY_EXACT_OBSERVED_RESTART24_ALLOWED'
 return True
def validate_backend25_projection(before,after,previous_backend,backend22,backend24,current_backend):
 # Validate the complete prior lineage before projecting the one observed
 # restart. This never edits the genuine baseline or relaxes its full guards.
 expected=copy.deepcopy(before)
 row=next(r for r in expected if r['project']=='sabalanerp'and r['service']=='backend')
 row.update(restartCount=24,startedAt='2026-10-31T08:41:12.469838113Z')
 validate_backend24_projection(before,expected,previous_backend,backend22,backend24)
 assert current_backend['containerId']==backend24['containerId']==row['id']
 assert current_backend['image']==row['image']and current_backend['project']=='sabalanerp'and current_backend['service']=='backend'
 assert current_backend['restartCount']==25 and current_backend['startedAt']=='2026-11-01T07:04:18.342321471Z'
 assert current_backend['status']=='running'and current_backend['healthStatus']=='healthy'and current_backend['exitCode']==0 and current_backend['oomKilled']is False
 row.update(restartCount=25,startedAt=current_backend['startedAt'])
 assert after==expected,'ONLY_EXACT_OBSERVED_RESTART25_ALLOWED'
 return True

def validate_backend27_projection(before,after,previous_backend,backend22,backend24,backend25,current_backend):
 expected=copy.deepcopy(before);row=next(r for r in expected if r['project']=='sabalanerp'and r['service']=='backend')
 row.update(restartCount=25,startedAt='2026-11-01T07:04:18.342321471Z')
 validate_backend25_projection(before,expected,previous_backend,backend22,backend24,backend25)
 assert current_backend['containerId']==backend25['containerId']==row['id']
 assert current_backend['image']==row['image']and current_backend['project']=='sabalanerp'and current_backend['service']=='backend'
 assert current_backend['restartCount']==27 and current_backend['startedAt']=='2026-11-01T12:13:13.652064434Z'
 assert current_backend['status']=='running'and current_backend['healthStatus']=='healthy'and current_backend['exitCode']==0 and current_backend['oomKilled']is False
 row.update(restartCount=27,startedAt=current_backend['startedAt']);assert after==expected,'ONLY_EXACT_OBSERVED_RESTART27_ALLOWED'
 return True

def observed_current_runtime():
 native=observed_runtime(BOUNDED_CURRENT_DIAGNOSTIC)
 assert native['beforeEight']==native['afterEight']and len(native['beforeEight'])==8
 assert native['configurationBeforeSha256']==native['configurationAfterSha256']and native['protectedBeforeSha256']==native['protectedAfterSha256']
 assert native['configurationComparison']=='ALL_FIELDS_ONLY_REALIZED_MOUNT_ENUMERATION_SORTED'
 for value in [native['recoveryBoundaryBefore'],native['recoveryBoundaryAfter']]:
  assert value['transactionReadOnly']is True and value['contentsReturned']is False and value['clear']is True
  assert value['state']['mode']=='NORMAL'and value['state']['operationPresent']is False
  assert value['markers']==dict.fromkeys(['pending-restore.json','deployment-maintenance.json','restart-inquiry','inquiry-stopped'],False)
  assert value['activeCounts']==dict.fromkeys(['CREATING','VALIDATING','RESTORING'],0)
 return native

def observed_restart28():
 # This exact observation is historical data, never a current healthy baseline.
 record=json.loads(checked(RESTART28_DIAGNOSTIC));row=record['original'];native=record['diagnostic']
 assert record['programSha256']=='d4d5d07e998b8422ece7502a5e880b4e718fd3b07ca8b9453451ac5379ff077e'
 assert row['phase']=='sourcePreflight'and row['code']==0 and row['signal']is None
 assert row['stdoutEof']and row['stderrEof']and row['stderrBytes']==0 and not row['localInterrupted']and not row['cancellations']
 assert row['observationFaultTotal']==0 and not row['observationFaults']and not row['observationFaultLogOverflow']and row['installedSshHeldAcrossSameOriginal']is True
 assert json.loads(checked(row['stdout']))==native and checked(row['stderr'])==b''
 assert native['diagnosticOnly']is True and native['readOnly']is True and native['runtimeAccepted']is False and native['productionAdmission']is False and native['allOriginalChildrenClosed']is True
 assert native['canonicalConfigurationGateMatches']is True and native['canonicalConfigurationGateChangedFields']=={} and native['diagnosisDoesNotReplaceAdmission']is True
 assert native['beforeEight']==native['afterEight']and len(native['beforeEight'])==8
 assert native['configurationBeforeSha256']==native['configurationAfterSha256']and native['protectedBeforeSha256']==native['protectedAfterSha256']
 assert native['configurationComparison']=='ALL_FIELDS_ONLY_REALIZED_MOUNT_ENUMERATION_SORTED'
 for child in native['originalChildren']:assert child['code']==0 and child['stdoutEof']and child['stderrEof']and child['observationFault']is None
 for child in native['kernelChildren']:assert child['code']==0 and child['pipesClosed']and child['observationFault']is None
 for value in [native['recoveryBoundaryBefore'],native['recoveryBoundaryAfter']]:
  assert value['transactionReadOnly']is True and value['contentsReturned']is False and value['clear']is True
  assert value['state']['mode']=='NORMAL'and value['state']['operationPresent']is False
  assert value['markers']==dict.fromkeys(['pending-restore.json','deployment-maintenance.json','restart-inquiry','inquiry-stopped'],False)
  assert value['activeCounts']==dict.fromkeys(['CREATING','VALIDATING','RESTORING'],0)
 return native

def validate_backend28_projection(before,after,previous_backend,backend22,backend24,backend25,backend27,current_backend):
 expected=copy.deepcopy(before);row=next(r for r in expected if r['project']=='sabalanerp'and r['service']=='backend')
 row.update(restartCount=27,startedAt='2026-11-01T12:13:13.652064434Z')
 validate_backend27_projection(before,expected,previous_backend,backend22,backend24,backend25,backend27)
 assert current_backend['containerId']==backend27['containerId']==row['id']
 assert current_backend['image']==row['image']and current_backend['project']=='sabalanerp'and current_backend['service']=='backend'
 assert current_backend['restartCount']==28 and current_backend['startedAt']=='2026-11-02T05:19:06.28844193Z'
 assert current_backend['status']=='running'and current_backend['healthStatus']=='healthy'and current_backend['exitCode']==0 and current_backend['oomKilled']is False
 row.update(restartCount=28,startedAt=current_backend['startedAt']);assert after==expected,'ONLY_EXACT_OBSERVED_RESTART28_ALLOWED'
 return True

def current_spec(reference,c=None):
 checked(PARENT);parent=runpy.run_path(PARENT['file'],run_name='unchanged_fourth_restart_admission');base,old_observation,owned=parent['observed']();c=c or owned
 diagnostic=json.loads(checked(DIAGNOSTIC));assert diagnostic['diagnosticOnly']is True and diagnostic['qualificationAccepted']is False and diagnostic['leaseClosed']is True and diagnostic['originalChildren']['allOriginalChildrenClosed']is True and diagnostic['originalChildren']['interrupted']is False
 observed=diagnostic['observation'];assert observed['readOnly']is True and observed['runtimeAccepted']is False and observed['allOriginalChildrenClosed']is True
 backend=observed['containers']['backend'];assert backend['healthStatus']=='healthy'and backend['project']=='sabalanerp'and backend['service']=='backend'
 # Diagnostic evidence binds only the exact backend restart fields. Its unhealthy
 # ClamAV row is never promoted; the new canonical baseline must prove all six.
 envelope=c.read(reference);fresh=parent['load'](parent['CONTRACT'],parent['CONTRACT_SHA'])['validate_original_baseline'](envelope,c.read(envelope['original']))
 next_observation=None;current_observation=None;november_observation=None;bounded_observation=None;restart28_observation=None
 restart_count=next(row for row in fresh['expectedEight']if row['project']=='sabalanerp'and row['service']=='backend')['restartCount']
 if restart_count in (27,28):
  next_observation=observed_backend22();current_observation=observed_runtime(CURRENT_DIAGNOSTIC);november_observation=observed_runtime(NOVEMBER_DIAGNOSTIC);bounded_observation=observed_current_runtime()
  for value in [next_observation,current_observation,november_observation,bounded_observation]:assert all(value['host'][key]==expected for key,expected in base['sourceHost'].items())
  lineage=[backend,*[value['containers']['backend']for value in [next_observation,current_observation,november_observation,bounded_observation]]]
  if restart_count==28:
   restart28_observation=observed_restart28();assert all(restart28_observation['host'][key]==value for key,value in base['sourceHost'].items())
   validate_backend28_projection(old_observation['currentEight'],fresh['expectedEight'],*lineage,restart28_observation['containers']['backend'])
  else:validate_backend27_projection(old_observation['currentEight'],fresh['expectedEight'],*lineage)
 elif restart_count in (22,24,25):
  next_observation=observed_backend22();assert all(next_observation['host'][key]==value for key,value in base['sourceHost'].items())
  if restart_count in (24,25):
   current_observation=observed_runtime(CURRENT_DIAGNOSTIC);assert all(current_observation['host'][key]==value for key,value in base['sourceHost'].items())
   if restart_count==25:
    november_observation=observed_runtime(NOVEMBER_DIAGNOSTIC);assert all(november_observation['host'][key]==value for key,value in base['sourceHost'].items())
    validate_backend25_projection(old_observation['currentEight'],fresh['expectedEight'],backend,next_observation['containers']['backend'],current_observation['containers']['backend'],november_observation['containers']['backend'])
   else:validate_backend24_projection(old_observation['currentEight'],fresh['expectedEight'],backend,next_observation['containers']['backend'],current_observation['containers']['backend'])
  else:validate_backend22_projection(old_observation['currentEight'],fresh['expectedEight'],backend,next_observation['containers']['backend'])
 else:validate_restart_projection(old_observation['currentEight'],fresh['expectedEight'],backend)
 assert fresh['protectedBefore']==fresh['protectedAfter']==base['protectedFiles']
 assert fresh['sourceHost']==base['sourceHost'];receipt={**reference,'original':envelope['original']};spec=copy.deepcopy(base)
 spec.update(expectedEight=fresh['expectedEight'],freshRuntimeBaseline=fresh,freshRuntimeBaselineReceipt=receipt)
 spec['observedPostCheckpointReconciliationTransition']['currentBaselineReceipt']=receipt
 spec['observedBackendRestart21Transition']={'observation':DIAGNOSTIC,'causeKnown':False,'observedDelta':17,'liveFullConfigurationGuardRequired':True,'productionAdmission':False}
 if next_observation is not None:spec['observedBackendRestart22Transition']={'observation':NEXT_DIAGNOSTIC,'causeKnown':False,'observedDelta':1,'liveFullConfigurationGuardRequired':True,'productionAdmission':False}
 if current_observation is not None:spec['observedBackendRestart24Transition']={'observation':CURRENT_DIAGNOSTIC,'causeKnown':False,'observedDelta':2,'liveFullConfigurationGuardRequired':True,'productionAdmission':False}
 if november_observation is not None:spec['observedBackendRestart25Transition']={'observation':NOVEMBER_DIAGNOSTIC,'causeKnown':False,'observedDelta':1,'liveFullConfigurationGuardRequired':True,'productionAdmission':False}
 if bounded_observation is not None:spec['observedBackendRestart27Transition']={'observation':BOUNDED_CURRENT_DIAGNOSTIC,'causeKnown':False,'observedDelta':2,'liveFullConfigurationGuardRequired':True,'liveRecoveryQuietRequired':True,'productionAdmission':False}
 if restart28_observation is not None:spec['observedBackendRestart28Transition']={'observation':RESTART28_DIAGNOSTIC,'causeKnown':False,'observedDelta':1,'liveFullConfigurationGuardRequired':True,'liveRecoveryQuietRequired':True,'productionAdmission':False}
 return spec
def validate_spec(spec):
 reference=spec['freshRuntimeBaselineReceipt'];assert spec==current_spec({'file':reference['file'],'sha256':reference['sha256']});return spec
validate_completed_source_install=validate_spec
