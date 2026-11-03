"""Bounded extension of the qualified retirement sequence.
Explicit canonical configuration return follows genuine Root/supervisor drain.
Native binding is rejected until the specific immutable guard is qualified.
No Docker/runtime authority is inferred from a fixture or JSON receipt.
"""
import argparse,ctypes,hashlib,json,os,stat,subprocess,sys,time,types
from pathlib import Path
CORE_FILE=Path('D:/sabalanerp-online-qa/held-owner-recovery-qualification-20261030/recovery.py')
CORE_SHA='e45cda7207ad84738a32ef02034333aeaa5419cb98f40c0821e63463e89527e2'
_raw=CORE_FILE.read_bytes();assert hashlib.sha256(_raw).hexdigest()==CORE_SHA,'QUALIFIED_CORE_CHANGED'
core=types.ModuleType('qualified_retirement_core');core.__file__=str(CORE_FILE)
exec(compile(_raw,str(CORE_FILE),'exec'),core.__dict__)
# Use the verified bytes above, never import/reopen the core after checking it.
Kernel=core.Kernel;finite=core.finite;durable=core.durable;ref=core.ref;checked=core.checked
validate_identity=core.validate_identity;descendants=core.descendants
revalidate_threads=core.revalidate_threads;wait_ended=core.wait_ended
lock_identity=core.lock_identity;ROOT_EXIT=core.ROOT_EXIT;LEASE_EXIT=core.LEASE_EXIT

def validate_static(plan):
    assert plan['profile']in ('fixture','production')
    if plan['profile']=='production':
        assert plan['format']=='sabalan-f282-held-canonical-return-plan/v1'and plan['operation']=='f28211a52244b8c71b752731cc15b1b6'
        native_guard(plan,'before')
    for item in plan['pins']:core.checked(item)
    if plan.get('planReference'):core.checked(plan['planReference'])
    assert not Path(plan['closedFile']).exists(),'ORIGINAL_ALREADY_CLOSED'
    assert Path(plan['commandsFile']).read_bytes()==b'','COMMAND_QUEUE_CHANGED'
    assert lock_identity(plan['lockFile'])==plan['lockIdentity'],'LOCK_IDENTITY_CHANGED'
    assert len(plan['rootThreads'])>0 and 'jobSelector'in plan
    assert plan['returnControllerSha256']==plan['returnProgram']['source']['sha256']
    core.checked(plan['returnProgram']['source'])
    assert plan['returnProgram']['runtime']in ('python','node','node-graph')
    programs=[plan['returnProgram'],plan['auditProgram'],*[step.get('program',step.get('prepareProgram'))for step in plan['returnSteps']]]
    for program in programs:
        core.checked(program['source'])
        for item in [*program.get('inputs',[]),*program.get('modules',[])]:core.checked(item)
    if plan['profile']=='fixture':
        negative=json.loads(core.checked(plan['negativeResult']))
        assert negative['phase']=='HELD'and negative['mutationIntent']is True and negative['retainedPreFsm']is True

def finite_verified(program,maximum=8*1024**2):
    """Execute the exact checked buffer, never re-open its pathname as code."""
    source=core.checked(program['source'])
    for item in program.get('inputs',[]):core.checked(item)
    file=program['source']['file'];arguments=program['arguments']
    assert isinstance(arguments,list)and all(isinstance(v,str)for v in arguments)
    if program['runtime']=='python':
        loader="import sys; raw=sys.stdin.buffer.read(); f=sys.argv[1]; sys.argv=sys.argv[1:]; exec(compile(raw,f,'exec'),{'__name__':'__main__','__file__':f})"
        argv=[program['executable'],'-I','-B','-c',loader,file,*arguments]
    elif program['runtime']=='node-graph':
        import base64
        modules=[]
        for row in program['modules']:
            raw=core.checked(row);modules.append({**row,'base64':base64.b64encode(raw).decode('ascii')})
        request={'format':'sabalan-fixed-recovery-byte-graph/v1','entry':program['entry'],'arguments':arguments,'modules':modules}
        envelope={'loader':base64.b64encode(source).decode('ascii'),'request':request}
        source_payload=json.dumps(envelope).encode('utf-8')
        loader="import fs from 'node:fs';const p=JSON.parse(fs.readFileSync(0,'utf8'));globalThis.__sabalanRecoveryByteGraph=p.request;await import('data:text/javascript;base64,'+p.loader);"
        argv=[program['executable'],'--experimental-vm-modules','--disable-warning=ExperimentalWarning','--input-type=module','-e',loader]
    else:
        assert program['runtime']=='node' 
        loader="import fs from 'node:fs';const raw=fs.readFileSync(0);process.argv=[process.execPath,...process.argv.slice(1)];await import('data:text/javascript;base64,'+raw.toString('base64'));"
        argv=[program['executable'],'--input-type=module','-e',loader,file,*arguments]
    payload=source_payload if program['runtime']=='node-graph'else source
    return finite_owned(argv,payload,maximum,source_sha=core.SHA(source),fixture_setup_failure=program.get('fixturePostSpawnFailure',False))

def finite_owned(argv,payload=None,maximum=8*1024**2,source_sha=None,fixture_setup_failure=False,environment=None,json_output=True):
    # Establish ownership and all fault storage before process creation. Every
    # path after Popen enters this finally and drains THIS original process.
    child=None;fault=None;faults=[];first=True;out=b'';err=b''
    try:
        child=subprocess.Popen(argv,stdin=subprocess.PIPE if payload is not None else subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=environment,creationflags=subprocess.CREATE_NO_WINDOW)
        if fixture_setup_failure:raise RuntimeError('OWNED_POST_SPAWN_SETUP_FAILURE')
    except BaseException as error:fault=error
    finally:
        if child is not None:
            while True:
                try:out,err=child.communicate(payload if first else None);break
                except BaseException as error:
                    fault=fault or error;first=False
    if child is None:raise fault
    if fault is not None:faults.append(type(fault).__name__)
    receipt={'originalPid':child.pid,'code':child.returncode,'stdoutEof':child.stdout.closed,'stderrEof':child.stderr.closed,'stdoutSha256':core.SHA(out),'stderrSha256':core.SHA(err),'stdoutBytes':len(out),'stderrBytes':len(err),'communicationFaults':faults,'executedSha256':source_sha,'sourcePathExecuted':False}
    if not(child.returncode==0 and receipt['stdoutEof']and receipt['stderrEof']and len(out)<=maximum and len(err)<=maximum and not faults and (not err if json_output else True)):raise core.AuditFailure(receipt)
    return (json.loads(out)if json_output else out),receipt


def validate_root_threads(k,plan):
    rows=plan['rootThreads'];pid=plan['identity']['processes']['root']['pid'];assert {r['tid']for r in k.table(True)if r['pid']==pid}=={r['tid']for r in rows},'ROOT_THREADS_CHANGED'
    handles={}
    for row in rows:
        h,actual=k.thread(row['tid']);assert actual==row and actual['ownerPid']==pid and not k.ended(h),'ROOT_THREAD_IDENTITY_CHANGED';handles[row['tid']]=h
    return handles

def revalidate_root_threads(k,plan,handles):
    pid=plan['identity']['processes']['root']['pid'];assert {r['tid']for r in k.table(True)if r['pid']==pid}==set(handles),'ROOT_THREAD_SET_CHANGED'
    for row in plan['rootThreads']:
        h=handles[row['tid']];assert not k.ended(h)and k.thread_record(h,row['tid'])==row,'ROOT_THREAD_CHANGED_DURING_AUDIT'

def same_live_return_guard(k,plan,handles,readers,root_threads):
    for role in ('root','supervisor'):
        assert k.ended(handles[role])and k.exit_code(handles[role])==ROOT_EXIT,'RETURN_ORIGINAL_CHAIN_NOT_ENDED'
    assert all(k.ended(h)for h in [*readers,*root_threads.values()]),'RETURN_READER_OR_ROOT_THREAD_OPEN'
    for role,h in handles.items():
        if role not in ('lease','leaseConsole'):assert k.ended(h),'RETURN_ORIGINAL_OWNER_OPEN:'+role
    assert not k.ended(handles['lease']),'RETURN_SAME_LEASE_NOT_LIVE'
    descendants(k,plan);k.exclusive_lock(plan);k.verify_anchor(plan,handles)
    assert not Path(plan['commandsFile']).read_bytes(),'RETURN_COMMAND_QUEUE_CHANGED'
    for item in plan['pins']:core.checked(item)
    if plan.get('planReference'):core.checked(plan['planReference'])

def canonical_return(k,plan,handles,readers,root_threads,before,event):
    """Both mutations remain in the owner of the original kernel handles."""
    returned=None;originals=[]
    for index,step in enumerate(plan['returnSteps']):
        assert step['before']==('before'if index==0 else'after-inquiry')
        if plan['profile']=='fixture':
            prepared={'prepared':True,'stage':step['before']}
        else:
            prepared,prepared_original=finite_verified(step['prepareProgram'])
            assert prepared['format']=='sabalan-f282-readonly-return-preparation/v1'and prepared['prepared']is True and prepared['stage']==step['before']and prepared['mutationDispatched']is False
            event('RETURN_READONLY_PREPARED',stage=step['before'],prepared=prepared,original=prepared_original)
        same_live_return_guard(k,plan,handles,readers,root_threads)
        if plan['profile']=='production':
            event('NATIVE_NEGATIVE_GUARD',stage=step['before'],proof=native_guard(plan,'after-drain'))
            action=step['action'];assert action['executable']=='C:/Users/mahan/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
            assert core.SHA(json.dumps(action['arguments'],separators=(',',':')).encode())==prepared['commandSha256']
            assert core.SHA(json.dumps(action['environment'],separators=(',',':')).encode())==prepared['environmentSha256']
            assert_native_capacity()
            same_live_return_guard(k,plan,handles,readers,root_threads)
        event('CANONICAL_STEP_INTENT',stage=step['after'],databaseCopied=False,kernelLeaseJobAndOriginalDrainVerified=True)
        if plan['profile']=='fixture':returned,original=finite_verified(step['program'])
        else:
            environment={key:value for key,value in os.environ.items()if not key.startswith('ONLINE_ACCEPTANCE_')};environment.update(action['environment'])
            returned,original=finite_owned([action['executable'],*action['arguments']],environment=environment,json_output=False)
        originals.append(original);event('CANONICAL_STEP_CHILD_CLOSED',stage=step['after'],original=original)
        assert not k.ended(handles['lease']),'LEASE_ENDED_DURING_RETURN'
        audited,audit_original=finite_verified(plan['auditProgram'])
        assert audited['safe']is True and audited['allOriginalChildrenClosed']is True and audited['conservation']==before['conservation'],'CANONICAL_STEP_CONSERVATION_FAILED'
        assert audited.get('stage',step['after'])==step['after']and audited['canonicalReturnVerified']==(index==len(plan['returnSteps'])-1)
        event('CANONICAL_STEP_AUDITED',stage=step['after'],audit=audited,original=audit_original)
        same_live_return_guard(k,plan,handles,readers,root_threads)
    assert len(plan['returnSteps'])==2
    return {'format':'sabalan-owned-canonical-config-return/v1','operation':plan['operation'],'complete':True,'allOriginalChildrenClosed':True,'databaseCopied':False,'exactPredecessorModelsVerified':True,'originalSqliteUnchanged':True},originals

def native_guard(plan,stage):
    originals=[]
    def run_read_only(argv,cwd):
        # Git supports -C; using the retained collector avoids subprocess.run's
        # implicit exception kill and keeps genuine EOF/fault custody.
        assert argv[0]=='git'
        output,receipt=finite_owned(['git','-C',str(cwd),*argv[1:]],maximum=1024**2,json_output=False)
        originals.append(receipt);assert receipt['stderrBytes']==0,'READ_ONLY_GIT_STDERR'
        return output
    reference=plan['nativeGuard'];raw=core.checked(reference);module=types.ModuleType('same_operation_negative_guard');module.__file__=reference['file'];exec(compile(raw,reference['file'],'exec'),module.__dict__)
    result=module.check(plan,stage,run_read_only);result['originalReadOnlyChildren']=originals;return result

def assert_native_capacity():
    import shutil
    settings=json.loads(Path('C:/Users/mahan/AppData/Roaming/Docker/settings-store.json').read_bytes());assert Path(settings['CustomWslDistroDir']).resolve()==Path('E:/DockerData').resolve(),'DOCKER_BACKING_DESTINATION_CHANGED'
    vhd=Path('E:/DockerData/disk/docker_data.vhdx');assert vhd.resolve(strict=True)==vhd
    for drive,reserve in [('C:/',12*1024**3),('D:/',16*1024**3),('E:/',16*1024**3)]:assert shutil.disk_usage(drive).free>=reserve+512*1024**2,'ROLLBACK_BACKING_CAPACITY_FLOOR_REFUSED:'+drive

def execute(plan,journal,approved_operation):
    assert approved_operation==plan['operation'],'EXPLICIT_OPERATION_APPROVAL_REQUIRED'
    assert plan['profile']in ('fixture','production')
    journal=Path(journal);assert not journal.exists()
    if plan['profile']=='production':
        validate_static(plan)
        assert str(journal)==plan['journalDirectory'];prepared,_=finite_verified(plan['privateJournalProgram'])
        assert prepared['privateJournalPrepared']is True and prepared['allOriginalChildrenClosed']is True and Path(prepared['directory'])==journal
    else:journal.mkdir()
    serial=0
    def event(name,**data):
        nonlocal serial
        serial+=1;durable(journal/(str(serial).zfill(2)+'-'+name+'.json'),{'event':name,'monotonic':time.monotonic(),'operation':plan['operation'],'qualificationAccepted':False,**data})
    k=Kernel();root_ended=False;lease_ended=False
    try:
        validate_static(plan);handles,readers,thread_handles=validate_identity(k,plan,True);root_thread_handles=validate_root_threads(k,plan)
        before,original=finite_verified(plan['auditProgram']);assert before['safe']is True and before['allOriginalChildrenClosed']is True and before['canonicalReturnVerified']is False
        event('AUDIT_BEFORE',audit=before,original=original)
        k.exclusive_lock(plan)
        validate_static(plan);descendants(k,plan)
        thread_proof=revalidate_threads(k,plan,thread_handles)
        assert not any(k.ended(h)for h in handles.values()),'CHAIN_CHANGED_BEFORE_ACTION';revalidate_root_threads(k,plan,root_thread_handles)
        if Path(plan['identity']['processes']['root']['image']).name.lower()=='node.exe':
            assert plan.get('jobSelector'),'NODE_JOB_PRESERVATION_REQUIRED'
            k.preserve_job_in_lease(plan,handles,event)
            if plan.get('fixtureCrashAfterAnchor'):os._exit(86)
            if plan.get('fixtureRejectAfterAnchor'):raise AssertionError('OWNED_POST_ANCHOR_FAILURE')
            validate_static(plan);descendants(k,plan);thread_proof=revalidate_threads(k,plan,thread_handles);revalidate_root_threads(k,plan,root_thread_handles)
            k.verify_anchor(plan,handles)
        event('ROOT_TERMINATION_INTENT',identity=plan['identity']['processes']['root'],threadRevalidation=thread_proof,exitCode=ROOT_EXIT,forced=True)
        k.terminate(handles['root'],ROOT_EXIT);wait_ended(k,handles['root']);assert k.exit_code(handles['root'])==ROOT_EXIT;root_ended=True
        for h in root_thread_handles.values():wait_ended(k,h)
        event('ROOT_ENDED',exitCode=ROOT_EXIT,forced=True,rootThreadsEnded=plan['rootThreads'],samplerNaturalDrainClaimed=False,exclusiveLock=k.exclusive_lock(plan))
        assert not k.ended(handles['lease']),'LEASE_DIED_WITH_ROOT'
        if k.anchor:k.verify_anchor(plan,handles)
        if plan.get('fixtureCrashAfterRoot'):os._exit(86)
        wait_ended(k,handles['supervisor'],plan.get('closureWaitSeconds',30))
        assert k.exit_code(handles['supervisor'])==ROOT_EXIT,'SUPERVISOR_EXIT_UNKNOWN'
        for h in readers:wait_ended(k,h)
        closed=json.loads(Path(plan['closedFile']).read_bytes())
        assert closed['originalPid']==plan['identity']['processes']['root']['pid']and closed['code']==ROOT_EXIT and closed['pipesClosed']is True and closed['readerErrors']==[] and closed['supervisorHeld']is False and closed['commandsSent']==0
        for name in ('stdout','stderr'):
            row=closed['logs'][name];raw=(Path(plan['closedFile']).parent/(name+'.log')).read_bytes()
            assert all(row.get(key)is True for key in ('closed','pipeClosed','logSynced','logClosed'))and row['truncated']is False
            assert row['bytesSeen']==row['bytesRetained']==len(raw)
        if plan['profile']=='production':event('NATIVE_DRAIN_GUARD',proof=native_guard(plan,'after-drain'))
        event('SUPERVISOR_AND_READERS_ENDED',closed=ref(plan['closedFile']),logHashes={n:ref(Path(plan['closedFile']).parent/(n+'.log'))for n in ('stdout','stderr')},readerKernelHandlesEnded=True,readers=plan['identity']['readers'],supervisorKernelExit=k.exit_code(handles['supervisor']),forcedRootNotNatural=True,exclusiveLock=k.exclusive_lock(plan))
        for role,h in handles.items():
            if role not in ('root','supervisor','lease','leaseConsole'):wait_ended(k,h)
        assert not k.ended(handles['lease']),'LEASE_ENDED_TOO_EARLY'
        for r in plan['pins']:checked(r)
        descendants(k,plan)
        event('CANONICAL_RETURN_INTENT',commandSha256=plan['returnControllerSha256'],databaseCopied=False)
        returned,return_original=canonical_return(k,plan,handles,readers,root_thread_handles,before,event)
        assert returned['format']=='sabalan-owned-canonical-config-return/v1'and returned['operation']==plan['operation']and returned['complete']is True,'CANONICAL_RETURN_NOT_COMPLETE'
        assert returned['allOriginalChildrenClosed']is True and returned['databaseCopied']is False and returned['exactPredecessorModelsVerified']is True and returned['originalSqliteUnchanged']is True,'CANONICAL_RETURN_NOT_PROVEN'
        event('CANONICAL_RETURN_FINISHED',returned=returned,original=return_original)
        if plan.get('fixtureCrashAfterReturn'):os._exit(86)
        assert not k.ended(handles['lease']),'LEASE_ENDED_DURING_RETURN'
        after,original=finite_verified(plan['auditProgram']);assert after['safe']is True and after['allOriginalChildrenClosed']is True and after['conservation']==before['conservation'],'RESOURCE_CONSERVATION_FAILED'
        assert after['canonicalReturnVerified']is True,'CANONICAL_RETURN_AUDIT_REQUIRED'
        event('AUDIT_AFTER',audit=after,original=original,endedControlExitCodes={role:k.exit_code(h)for role,h in handles.items()if role not in('lease','leaseConsole')},exclusiveLock=k.exclusive_lock(plan))
        descendants(k,plan)
        for r in plan['pins']:checked(r)
        assert lock_identity(plan['lockFile'])==plan['lockIdentity'],'LOCK_FILE_IDENTITY_CHANGED'
        if k.anchor:k.verify_anchor(plan,handles)
        assert not k.ended(handles['lease'])and not Path(plan['commandsFile']).read_bytes()
        event('LEASE_TERMINATION_INTENT',identity=plan['identity']['processes']['lease'],exitCode=LEASE_EXIT,forced=True)
        k.terminate(handles['lease'],LEASE_EXIT);wait_ended(k,handles['lease']);assert k.exit_code(handles['lease'])==LEASE_EXIT;lease_ended=True
        if 'leaseConsole'in handles:wait_ended(k,handles['leaseConsole'])
        assert lock_identity(plan['lockFile'])==plan['lockIdentity'],'LOCK_FILE_REMOVED_OR_CHANGED'
        event('LEASE_ENDED',exitCode=LEASE_EXIT,forced=True,lockFilePreserved=True,releasedLock=k.released_lock(plan))
        event('ABNORMAL_RETIREMENT_FINISHED',rootForced=True,leaseForced=True,normalOwnerRelease=False,negativeAttemptPreserved=True)
        return 0
    except BaseException as error:
        event('REJECTED_OR_HELD',errorType=type(error).__name__,reason=str(error)if isinstance(error,AssertionError)else'IO_OR_KERNEL_UNKNOWN',auditOriginal=getattr(error,'receipt',None),rootEnded=root_ended,leaseEnded=lease_ended,retainedTargetJobReference=k.anchor,newRecoveryObligation=bool(k.anchor and not lease_ended),normalOwnerRelease=False)
        return 1
    finally:k.close()

def main():
    assert not sys.flags.optimize,'ASSERTIONS_REQUIRED'
    p=argparse.ArgumentParser();p.add_argument('plan');p.add_argument('sha256');p.add_argument('--journal',required=True);p.add_argument('--approved-operation',required=True);a=p.parse_args()
    plan=json.loads(core.checked({'file':str(Path(a.plan).resolve()),'sha256':a.sha256}))
    if plan['profile']=='production':
        assert Path(a.plan).resolve().parent==Path('D:/sabalanerp-online-qa/held-f282-native-material-r3-20261101')
        assert a.approved_operation=='f28211a52244b8c71b752731cc15b1b6'
        def no_fixture_keys(value):
            if isinstance(value,dict):
                assert not any(key.startswith('fixture')for key in value),'FIXTURE_CONTROL_IN_NATIVE_PLAN'
                for item in value.values():no_fixture_keys(item)
            elif isinstance(value,list):
                for item in value:no_fixture_keys(item)
        no_fixture_keys(plan)
    plan['planReference']={'file':str(Path(a.plan).resolve()),'sha256':a.sha256}
    return execute(plan,a.journal,a.approved_operation)
if __name__=='__main__':raise SystemExit(main())
