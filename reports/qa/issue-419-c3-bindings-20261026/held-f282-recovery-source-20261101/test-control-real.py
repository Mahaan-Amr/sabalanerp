"""Real owned Windows process chain; only private fixture files model state."""
import copy,hashlib,json,os,subprocess,sys,time,types,uuid
from pathlib import Path
HERE=Path(__file__).resolve().parent
raw=(HERE/'recovery-control.py').read_bytes();R=types.ModuleType('control_under_test');R.__file__=str(HERE/'recovery-control.py');exec(compile(raw,R.__file__,'exec'),R.__dict__)
RESULTS=[];HELPER_REFERENCE=R.ref(HERE/'recovery-control.py')
def run_case(name,mode='ok',edit=None,expected=0,root_expected=True,flags=()):
 d=HERE/('fixture-'+uuid.uuid4().hex);d.mkdir();[(d/flag).touch()for flag in flags];(d/'native-root').touch();(d/'resource').write_bytes(b'protected fixture original data\n');(d/'configuration').write_text('candidate');(d/'return-mode').write_text(mode);(d/'lock').touch();(d/'commands.jsonl').touch();R.durable(d/'negative.json',{'phase':'HELD','mutationIntent':True,'retainedPreFsm':True})
 errors=(d/'shell.stderr').open('wb');shell=subprocess.Popen(['C:/Users/mahan/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe','-NoProfile','-NonInteractive','-File',str(HERE/'fixture-shell.ps1'),str(d)],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=errors,creationflags=subprocess.CREATE_NO_WINDOW);k=R.Kernel();lease_handle=None
 try:
  deadline=time.monotonic()+12
  while not all((d/f).exists()for f in ['supervisor-ready.json','root-ready.json','lease-ready.json']):assert shell.poll()is None and time.monotonic()<deadline,'FIXTURE_START_FAILED';time.sleep(.02)
  sr=json.loads((d/'supervisor-ready.json').read_bytes());rr=json.loads((d/'root-ready.json').read_bytes());roles={'shell':shell.pid,'supervisor':sr['pid'],'root':rr['pid'],'lease':rr['lease']}
  for row in k.table():
   if row['name'].lower()=='conhost.exe':
    parent=next((role for role,pid in list(roles.items())if pid==row['parentPid']),None)
    if parent:roles[parent+'Console']=row['pid']
  identity=R.core.snapshot(k,roles);rootThreads=[]
  for row in k.table(True):
   if row['pid']==rr['pid']:
    _,thread=k.thread(row['tid']);rootThreads.append(thread)
  lease_handle,_=k.process(rr['lease']);plan={'profile':'fixture','operation':d.name,'identity':identity,'rootThreads':rootThreads,'jobSelector':k.job_selector(rr['pid']),'pins':[R.ref(HERE/n)for n in ['fixture.py','fixture-native-root.mjs','fixture-shell.ps1','fixture-return.py','fixture-post-up-audit.py']],'negativeResult':R.ref(d/'negative.json'),'closedFile':str(d/'original-closed.json'),'commandsFile':str(d/'commands.jsonl'),'lockFile':str(d/'lock'),'lockIdentity':R.lock_identity(d/'lock'),'auditProgram':{'runtime':'python','executable':sys.executable,'source':R.ref(HERE/'fixture-post-up-audit.py'),'arguments':[str(d)]},'returnCommand':[sys.executable,'-I','-B',str(HERE/'fixture-return.py'),str(d)],'returnProgram':{'runtime':'python','executable':sys.executable,'source':R.ref(HERE/'fixture-return.py'),'arguments':[str(d)]},'returnControllerSha256':R.core.SHA((HERE/'fixture-return.py').read_bytes()),'closureWaitSeconds':3}
  plan['returnSteps']=[{'before':'before'if index==0 else'after-inquiry','after':stage,'program':{**plan['returnProgram'],'arguments':[str(d),stage]}}for index,stage in enumerate(['after-inquiry','after'])]
  if edit:edit(plan,d)
  if name=='controller-mutation-during-audit':
   for step in plan['returnSteps']:step['program']['source']=plan['returnProgram']['source']
  R.durable(d/'plan.json',plan);command=[sys.executable,'-I','-B',str(HERE/'recovery-control.py'),str(d/'plan.json'),R.ref(d/'plan.json')['sha256'],'--journal',str(d/'journal'),'--approved-operation',plan['operation']]
  helper=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW);assert helper.returncode==expected,(name,helper.returncode,helper.stderr.decode());assert not helper.stderr,(name,helper.stderr.decode())
  events=[json.loads(f.read_bytes())for f in sorted((d/'journal').glob('*.json'))];names=[e['event']for e in events]
  if expected==0:
   assert names.index('ROOT_ENDED')<names.index('SUPERVISOR_AND_READERS_ENDED')<names.index('CANONICAL_RETURN_INTENT')<names.index('CANONICAL_RETURN_FINISHED')<names.index('AUDIT_AFTER')<names.index('LEASE_TERMINATION_INTENT')<names.index('ABNORMAL_RETIREMENT_FINISHED');assert k.ended(lease_handle)and k.exit_code(lease_handle)==98;assert(d/'configuration').read_text()=='baseline';assert shell.wait(timeout=10)==97
   replay=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW);assert replay.returncode!=0;assert len(list((d/'journal').glob('*.json')))==len(events)
  else:
   assert (k.ended(lease_handle)if name=='lease-lost-before-second-UP'else not k.ended(lease_handle)),'UNEXPECTED_LEASE_STATE';assert 'LEASE_TERMINATION_INTENT'not in names
   if name=='lease-lost-before-second-UP':assert names.count('CANONICAL_STEP_INTENT')==1
   assert ('ROOT_ENDED'in names)==root_expected
   if not root_expected and expected!=86:assert 'JOB_REFERENCE_INSERTION_INTENT'not in names
  assert(d/'resource').read_bytes()==b'protected fixture original data\n'and(d/'lock').exists()
  result={'case':name,'helperCode':helper.returncode,'events':names,'realNodeWorkerLeaseSupervisorReaders':True,'fixtureStateOnly':True,'protectedDataUnchanged':True,'leaseHeldOnFailure':expected!=0 and not k.ended(lease_handle),'leaseLossDetectedBeforeSecondMutation':name=='lease-lost-before-second-UP','productionTargeted':False};R.durable(d/'qualification.json',result);RESULTS.append({'case':name,'directory':str(d),'receipt':R.ref(d/'qualification.json')});print(json.dumps(result),flush=True)
 finally:
  # Test-owned natural teardown only. This file is never a native control port.
  (d/'cleanup').touch(exist_ok=True)
  if shell.poll()is None:shell.wait(timeout=15)
  if lease_handle:R.wait_ended(k,lease_handle,15)
  if shell.stdin:shell.stdin.close()
  errors.close();k.close()
run_case('returned-and-audited')
run_case('lease-lost-before-second-UP',expected=1,flags=('lease-loss-before-second',))
run_case('post-Popen-setup-fails-drains-original',edit=lambda p,d:p['returnSteps'][0]['program'].update(fixturePostSpawnFailure=True),expected=1)
run_case('return-fails-before','fail-before',expected=1)
run_case('partial-return','partial',expected=1)
run_case('wrong-birth',edit=lambda p,d:p['identity']['processes']['root'].update(birth100ns='1'),expected=1,root_expected=False)
run_case('wrong-root-thread',edit=lambda p,d:p['rootThreads'][0].update(birth100ns='1'),expected=1,root_expected=False)
run_case('supervisor-reader-held-open',expected=1,flags=('retain-pipe',))
run_case('reader-receipt-incomplete',expected=1,flags=('bad-reader-receipt',))
run_case('unknown-child-during-audit',expected=1,root_expected=False,flags=('extra-after-audit',))
run_case('audit-refuses-returned-baseline',expected=1,flags=('audit-after-fail',))
run_case('crash-after-anchor',edit=lambda p,d:p.update(fixtureCrashAfterAnchor=True),expected=86,root_expected=False)
run_case('crash-after-root',edit=lambda p,d:p.update(fixtureCrashAfterRoot=True),expected=86)
run_case('crash-after-canonical-return',edit=lambda p,d:p.update(fixtureCrashAfterReturn=True),expected=86)
run_case('plan-mutation-during-audit',expected=1,root_expected=False,flags=('mutate-plan-after-audit',))
run_case('controller-mutation-during-audit',edit=lambda p,d:( (d/'return-copy.py').write_bytes((HERE/'fixture-return.py').read_bytes()),p.update(returnProgram={'runtime':'python','executable':sys.executable,'source':R.ref(d/'return-copy.py'),'arguments':[str(d)]})),expected=1,root_expected=False,flags=('mutate-controller-after-audit',))
run_case('root-thread-created-during-audit',expected=1,root_expected=False,flags=('new-thread-after-audit',))
assert R.ref(HERE/'recovery-control.py')==HELPER_REFERENCE
summary={'format':'sabalan-owned-real-chain-control-qualification/v1','cases':RESULTS,'helper':HELPER_REFERENCE,'caseCount':len(RESULTS),'allTestChainsClosed':True,'nativeExecuted':False}
R.durable(HERE/('qualification-'+uuid.uuid4().hex+'.json'),summary);print(json.dumps({'qualificationCompleted':True,'caseCount':len(RESULTS),'allTestChainsClosed':True,'helper':HELPER_REFERENCE}),flush=True)
