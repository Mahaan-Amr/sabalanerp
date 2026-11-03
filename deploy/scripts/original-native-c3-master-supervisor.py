"""External owner of the canonical C3 Root/master; credentials use anonymous stdin."""
import argparse, datetime, hashlib, json, os, stat, subprocess, sys, threading, time
from pathlib import Path
ROOT=Path('D:/sabalanerp-online-qa'); REPO=Path('C:/Users/mahan/.codex/worktrees/native-c3-execution-419/sabalanerp')
MASTER=REPO/'scripts/run-original-online-qualification-master.mjs'
COMMIT=None
PARENT_SOURCE_SHA256='19ee2f8c02c9d3194a8de2b0f308143fad2a3ffd8eb1843340d229ce83501617'
MAX_LOG=64*1024*1024; MAX_COMMANDS=8*1024*1024
sha=lambda b:hashlib.sha256(b).hexdigest()
def current(file):
    assert file.is_absolute() and file.resolve(strict=True)==file and not file.is_symlink()
    s=file.lstat();assert stat.S_ISREG(s.st_mode) and s.st_nlink==1
    return s

def pinned(file,digest):
    a=current(file);raw=file.read_bytes();b=current(file)
    assert (a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(b.st_ino,b.st_size,b.st_mtime_ns,b.st_ctime_ns)
    assert sha(raw)==digest;return raw

def emit(event,**values):
    print(json.dumps(dict(format='sabalan-external-original-master-supervisor/v1',event=event,**values)),flush=True)


def forward_private_preflight_request(child,event,password,state,stdin_lock):
    import re
    assert set(event)=={'format','rootOperation','sequence','challenge','phase','remoteActorsStarted','productionAdmission'}
    assert event['format']=='sabalan-native-c3-private-preflight-request/v1'
    assert re.fullmatch('[a-f0-9]{32}',event['rootOperation']) and re.fullmatch('[a-f0-9]{64}',event['challenge'])
    assert event['phase'] in ['PREPARING','MASTER_RETAINED'] and event['remoteActorsStarted'] is False and event['productionAdmission'] is False
    assert type(event['sequence']) is int and event['sequence']==state['sequence']+1
    assert state['rootOperation'] in [None,event['rootOperation']] and event['challenge'] not in state['challenges']
    assert isinstance(password,str) and 0<len(password.encode())<=4096
    frame=dict(format='sabalan-native-c3-private-preflight-input/v1',rootOperation=event['rootOperation'],sequence=event['sequence'],challenge=event['challenge'],credential=password)
    raw=(json.dumps(frame,separators=(',',':'))+'\n').encode();assert len(raw)<=16384
    with stdin_lock:
        assert child.stdin.write(raw)==len(raw);child.stdin.flush()
    state['rootOperation']=event['rootOperation'];state['sequence']=event['sequence'];state['challenges'].add(event['challenge'])

def write_all(fd,raw):
    view=memoryview(raw)
    while view:
        written=os.write(fd,view);assert written>0;view=view[written:]

def open_original_log(file):
    return os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_BINARY',0),0o600)

def durable(file,value):
    raw=(json.dumps(value,indent=2)+'\n').encode();fd=open_original_log(file)
    try:write_all(fd,raw);os.fsync(fd)
    finally:os.close(fd)


HOST_MEMORY_FLOOR=1536*1024*1024
HOST_MEMORY_PHASE_COMMANDS=frozenset({'PREPARE_LOCAL_RUNTIME','PREPARE_COMPLETE','PREPARE_INDEPENDENT','RUN_LOCAL','RUN_COMPLETE','RUN_INDEPENDENT','RUN_IMAGE_REPOSITORY'})
def canonical_launch_arguments(node,master,native_plan,native_sha256):
    return [str(node),str(master),'--native-c3-plan-file',str(native_plan),'--native-c3-plan-sha256',native_sha256]

def available_physical_memory():
    # Win32 read only: no process handles, policy changes, trimming or VM calls.
    import ctypes
    from ctypes import wintypes as W
    class MEMORY(ctypes.Structure):
        _fields_=[('length',W.DWORD),('load',W.DWORD),*[(n,ctypes.c_ulonglong)for n in ['total','available','totalPage','availablePage','totalVirtual','availableVirtual','extended']]]
    m=MEMORY();m.length=ctypes.sizeof(m)
    api=ctypes.WinDLL('kernel32',use_last_error=True).GlobalMemoryStatusEx
    api.argtypes=[ctypes.POINTER(MEMORY)];api.restype=W.BOOL
    if not api(ctypes.byref(m)):raise ctypes.WinError(ctypes.get_last_error())
    return m.available

def stabilize_host_memory(available,clock,sleep):
    start=clock();samples=[];consecutive=0
    while True:
        elapsed=clock()-start
        if elapsed>15:break
        value=available();assert type(value)is int and value>=0
        consecutive=consecutive+1 if value>=HOST_MEMORY_FLOOR else 0
        samples.append({'elapsedSeconds':elapsed,'availableBytes':value})
        if consecutive==3:break
        remaining=15-(clock()-start)
        if remaining<1:break
        sleep(1)
    return {'format':'sabalan-original-native-memory-stabilization/v1','floorBytes':HOST_MEMORY_FLOOR,'maximumSeconds':15,'samples':samples,'stable':consecutive==3,'cancelled':False,'resourceMutation':False}

def validate_host_memory(observation):
    assert observation['format']=='sabalan-original-native-memory-stabilization/v1'
    assert observation['floorBytes']==HOST_MEMORY_FLOOR and observation['maximumSeconds']==15 and observation['resourceMutation']is False and observation['cancelled']is False
    samples=observation['samples'];assert isinstance(samples,list)and 1<=len(samples)<=16
    previous=None;consecutive=0
    for row in samples:
        assert set(row)=={'elapsedSeconds','availableBytes'}
        elapsed=row['elapsedSeconds'];value=row['availableBytes']
        assert isinstance(elapsed,(int,float))and 0<=elapsed<=15 and type(value)is int and value>=0
        assert previous is None or elapsed-previous>=1
        previous=elapsed;consecutive=consecutive+1 if value>=HOST_MEMORY_FLOOR else 0
        assert consecutive<=3
    assert observation['stable']is(consecutive==3)
    assert observation['stable'],'ORIGINAL_MASTER_HOST_MEMORY_FLOOR_REFUSED'
    return observation

def pressure_policy():
    return json.loads((Path(__file__).resolve().parents[2]/'scripts/lib/local-qa-pressure-policy.json').read_bytes())

def validate_pressure_sample(value):
    policy=pressure_policy()
    assert value['format']=='sabalan-local-qa-pressure/v1' and value['platform']=='win32'
    assert set(value)=={'format','platform','observedAt','availableBytes','commitTotalBytes','commitLimitBytes','lowMemory','vm','probe'}
    assert all(type(value[k])is int and value[k]>=0 for k in ['availableBytes','commitTotalBytes','commitLimitBytes'])
    assert set(value['vm'])=={'probeContainerId','bootId','fullAvg10','someAvg10','oomKills'} and set(value['probe'])=={'durationMs','children'}
    import re
    assert re.fullmatch('[a-f0-9]{64}',value['vm']['probeContainerId']) and re.fullmatch('[a-f0-9-]{36}',value['vm']['bootId'])
    age=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(value['observedAt'])).total_seconds()*1000
    assert 0<=age<=policy['sampleMaximumAgeMs']
    assert type(value['lowMemory'])is bool and value['lowMemory']is False
    assert 0<=value['commitTotalBytes']<=value['commitLimitBytes'] and value['commitLimitBytes']>0
    assert value['commitTotalBytes']/value['commitLimitBytes']<=policy['maximumCommitPercent']/100
    assert 0<=value['vm']['fullAvg10']<=policy['maximumVmFullAvg10'] and 0<=value['vm']['someAvg10']<=policy['maximumVmSomeAvg10']
    assert type(value['vm']['oomKills'])is int and value['vm']['oomKills']>=0
    assert 0<=value['probe']['durationMs']<=policy['probeMaximumDurationMs']
    assert len(value['probe']['children'])==2 and all(type(c['originalPid'])is int and c['originalPid']>0 and type(c['code'])is int and c['code']==0 and c['stdoutEof']is True and c['stderrEof']is True for c in value['probe']['children'])
    return value

def stabilize_host_pressure(observe,clock,sleep):
    start=clock();samples=[];consecutive=0;previous=None
    for _ in range(16):
        if clock()-start>15:break
        try:
            sample=observe();samples.append(sample);validate_pressure_sample(sample)
            if previous:
                assert sample['vm']['bootId']==previous['vm']['bootId'] and sample['vm']['probeContainerId']==previous['vm']['probeContainerId']
                assert sample['vm']['oomKills']==previous['vm']['oomKills']
            previous=sample;consecutive+=1
        except BaseException as error:
            return {'format':'sabalan-original-native-pressure-stabilization/v1','samples':samples,'stable':False,'failureType':type(error).__name__,'resourceMutation':False}
        if consecutive==3:break
        if clock()-start>=14:break
        sleep(1)
    return {'format':'sabalan-original-native-pressure-stabilization/v1','samples':samples,'stable':consecutive==3 and clock()-start<=15,'resourceMutation':False}

def observe_host_pressure():
    import runpy
    return runpy.run_path(str(Path(__file__).resolve().parent/'local-qa-pressure.py'),run_name='private_readonly_memory_probe')['observe']()

def finalize_original_reader(name,pipe,fd,state,reader_errors,condition,io=os):
    result={'pipeClosed':False,'logSynced':False,'logClosed':False}
    for action,operation in [('pipeClosed',pipe.close),('logSynced',lambda:io.fsync(fd)),('logClosed',lambda:io.close(fd))]:
        try:operation();result[action]=True
        except BaseException as error:
            with condition:reader_errors.append(name+':'+action+':'+type(error).__name__)
    with condition:
        state[name].update(result);state[name]['closed']=result['pipeClosed']and result['logClosed']
        condition.notify_all()

def supervisor_exit_status(status,held,reader_errors,state):
    complete=bool(state)and all(s.get('closed')and s.get('pipeClosed')and s.get('logSynced')and s.get('logClosed')for s in state.values())
    return status if status else (1 if held or reader_errors or not complete else 0)

def main():
    global COMMIT
    assert sys.platform=='win32' and not sys.flags.optimize
    parser=argparse.ArgumentParser();parser.add_argument('plan');parser.add_argument('plan_sha256');parser.add_argument('--connection-only',action='store_true');args=parser.parse_args()
    plan=json.loads(pinned(Path(args.plan),args.plan_sha256));assert plan['format']in ('sabalan-external-original-master-supervisor-plan/v2','sabalan-external-original-master-supervisor-plan/v3')
    pressure_selected=plan['format'].endswith('/v3')
    if pressure_selected:assert plan['memoryPolicy']=='local-qa-pressure-v1'
    COMMIT=plan['sourceCommit'];assert isinstance(COMMIT,str)and len(COMMIT)==40 and all(c in '0123456789abcdef'for c in COMMIT)
    assert plan['sourceCommit']==COMMIT and plan['masterPath']==str(MASTER)
    assert subprocess.check_output(['git','-C',str(REPO),'rev-parse','HEAD'],text=True).strip()==COMMIT
    for file,digest in plan['sourceFiles'].items():pinned(Path(file),digest)
    assert str(MASTER) in plan['sourceFiles'];pinned(MASTER,plan['masterSha256'])
    node=Path(plan['nodeExecutable']);assert node==Path('C:/Program Files/nodejs/node.exe');pinned(node,plan['nodeExecutableSha256'])
    native_plan=Path(plan['nativePlanFile']);assert native_plan.is_relative_to(ROOT);pinned(native_plan,plan['nativePlanSha256'])
    commands=Path(plan['commandsFile']);assert commands.is_relative_to(ROOT);initial=current(commands);assert initial.st_size==0
    evidence=Path(plan['evidenceDirectory']);assert evidence.is_relative_to(ROOT) and evidence.parent.resolve(strict=True)==evidence.parent and not evidence.exists()
    evidence.mkdir(mode=0o700);account=subprocess.check_output(['C:/Windows/System32/whoami.exe'],text=True).strip()
    for file in [evidence,commands]:
        result=subprocess.run(['C:/Windows/System32/icacls.exe',str(file),'/inheritance:r','/grant:r',account+':F'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        assert result.returncode==0
    password=None;secret=None;forms=[]
    credential=sys.stdin.buffer.readline(16385);assert credential.endswith(b'\n')and len(credential)<=16384
    envelope=json.loads(credential);assert set(envelope)=={'password'};password=envelope['password'];assert isinstance(password,str)and 0<len(password.encode())<=4096;credential=None;envelope=None
    secret=password.encode();forms=list({secret,json.dumps(password)[1:-1].encode()})
    def redact(raw):
        for value in forms:raw=raw.replace(value,b'[REDACTED]')
        return raw
    assert 'bootstrap' not in plan,'UNCAPPED_PLAN_MUST_NOT_CONTAIN_RESOURCE_BOOTSTRAP'
    argv=canonical_launch_arguments(node,MASTER,native_plan,plan['nativePlanSha256'])
    if args.connection_only:argv.append('--connection-only')
    logs={name:open_original_log(evidence/(name+'.log'))for name in ['stdout','stderr']}
    child=subprocess.Popen(argv,cwd=REPO,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW)
    # Any uncaught post-spawn error retains the original process instead of orphaning it.
    def retain_uncaught(kind,error,trace):
        try:emit('UNCAUGHT_ERROR_ORIGINAL_RETAINED',originalPid=child.pid,errorType=kind.__name__)
        except BaseException:pass
        while child.poll() is None:
            try:time.sleep(1)
            except BaseException:pass
    sys.excepthook=retain_uncaught
    condition=threading.Condition();events=[];reader_errors=[];failed_events=[];state={name:dict(bytesSeen=0,bytesRetained=0,truncated=False,closed=False)for name in logs}
    stdin_lock=threading.Lock();private_preflight_state=dict(rootOperation=None,sequence=0,challenges=set())
    def drain(name,pipe):
        pending=b'';line=b'';keep=max(map(len,forms),default=1)-1
        def save(raw):
            value=redact(raw);s=state[name];s['bytesSeen']+=len(value);remaining=MAX_LOG-s['bytesRetained'];retained=value[:max(0,remaining)]
            if retained:write_all(logs[name],retained);os.fsync(logs[name]);s['bytesRetained']+=len(retained)
            if len(retained)!=len(value):s['truncated']=True
        try:
            while raw:=os.read(pipe.fileno(),4096):
                pending+=raw
                # Keep only a trailing partial secret, never split a secret before redaction.
                cutoff=max(0,len(pending)-keep)
                for value in forms:
                    for length in range(1,len(value)):
                        if pending.endswith(value[:length]):cutoff=min(cutoff,len(pending)-length)
                if cutoff:
                    for value in forms:
                        pos=pending.rfind(value,0,min(len(pending),cutoff+len(value)))
                        if pos>=0 and pos<cutoff<pos+len(value):cutoff=pos
                    save(pending[:cutoff]);pending=pending[cutoff:]
                if name=='stdout':
                    line+=raw
                    while b'\n'in line:
                        item,line=line.split(b'\n',1);assert len(item)<=65536
                        try:value=json.loads(item)
                        except (ValueError,UnicodeDecodeError):continue
                        if isinstance(value,dict) and isinstance(value.get('format'),str):
                            if value['format']=='sabalan-native-c3-private-preflight-request/v1':
                                try:forward_private_preflight_request(child,value,password,private_preflight_state,stdin_lock)
                                except BaseException:
                                    if value.get('phase')=='PREPARING':
                                        with stdin_lock:child.stdin.close()
                                    raise
                            with condition:
                                events.append(value);assert len(events)<=10000
                                if any(word in str(value.get('event',''))for word in ['HELD','REQUEST_FAILED','INPUT_CLOSED']):failed_events.append(value.get('event'))
                                condition.notify_all()
                            compact={k:value[k]for k in ['format','event','sequence']if k in value}
                            emit('ORIGINAL_STDOUT_EVENT',originalPid=child.pid,observed=json.loads(redact(json.dumps(compact).encode())))
                    assert len(line)<=65536
            save(pending)
        except BaseException as error:
            with condition:reader_errors.append(type(error).__name__);condition.notify_all()
            # Preserve ownership and drain remaining bytes even if parsing/logging failed.
            try:
                while os.read(pipe.fileno(),65536):pass
            except BaseException:pass
        finally:
            finalize_original_reader(name,pipe,logs[name],state,reader_errors,condition)
    threads=[threading.Thread(target=drain,args=(name,getattr(child,name)),daemon=False)for name in logs]
    for thread in threads:thread.start()
    emit('ORIGINAL_STARTED',originalPid=child.pid,evidenceDirectory=str(evidence))
    sent=0;prefix=b'';buffer=b'';held=False
    allowed={'RUN_IMAGE_REPOSITORY','PREPARE_LOCAL_RUNTIME','PREPARE_COMPLETE','PREPARE_INDEPENDENT','RUN_LOCAL','RUN_COMPLETE','RUN_INDEPENDENT','START_PROTECTED_INSTALL','ISSUE_ONLINE_ORIGIN','ISSUE_ORIGIN','PREPARE_COMPLETE','RUN_COMPLETE','PREPARE_FINANCIAL','FOLLOWING_CONTROL','START_FOLLOWING_CLIENT','RUN_FOLLOWING_PROMOTION','RUN_FOLLOWING_CURRENT_DATA_ROLLBACK','FINISH_CLIENT'}
    try:
        durable(evidence/'original-start.json',dict(format='sabalan-external-original-master-start/v1',originalPid=child.pid,planSha256=args.plan_sha256,masterSha256=plan['masterSha256'],sourceCommit=COMMIT,startedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),passwordStored=False,connectionOnly=args.connection_only))
        while child.poll() is None:
            assert not reader_errors and not failed_events
            s=current(commands);assert s.st_ino==initial.st_ino and s.st_size>=len(prefix) and s.st_size<=MAX_COMMANDS
            raw=commands.read_bytes();assert raw.startswith(prefix) and len(raw)<=MAX_COMMANDS
            buffer+=raw[len(prefix):];prefix=raw
            while b'\n'in buffer:
                line,buffer=buffer.split(b'\n',1);assert not args.connection_only,'CONNECTION_ONLY_COMMANDS_REFUSED';assert 0<len(line)<=MAX_COMMANDS and secret not in line
                envelope=json.loads(line);assert set(envelope)=={'request','waitFor'};request=envelope['request'];wait=envelope['waitFor']
                assert isinstance(request,dict) and request['command']in allowed and request['sequence']==sent+1
                assert (len(line)<=65536 or request['command']=='FOLLOWING_CONTROL'and request.get('control')=='PUBLISH')
                assert 'password'not in request and isinstance(wait,dict) and set(wait)<= {'format','event','sequence'} and {'format','sequence'}<=set(wait) and isinstance(wait.get('format'),str)
                if 'sequence'in wait:assert wait['sequence']==request['sequence']
                if request['command']in HOST_MEMORY_PHASE_COMMANDS:
                    with condition:
                        while child.poll()is None and not reader_errors and not failed_events and not any(v.get('format')=='sabalan-original-qualification-master/v1'and v.get('event')in {'RETAINED_BROWSER_CLOSED_RETAINED','ORIGINAL_MASTER_READY_FOR_LOCAL'}for v in events):condition.wait(1)
                        assert child.poll()is None and not reader_errors and not failed_events
                    observation=stabilize_host_pressure(observe_host_pressure,time.monotonic,time.sleep) if pressure_selected else stabilize_host_memory(available_physical_memory,time.monotonic,time.sleep)
                    durable(evidence/('host-memory-before-command-'+str(request['sequence'])+'.json'),observation)
                    if pressure_selected:
                        assert observation['stable'] is True,'ORIGINAL_MASTER_MEMORY_PRESSURE_REFUSED'
                        validate_pressure_sample(observation['samples'][-1])
                    else:validate_host_memory(observation)
                # Never serialize injected credentials to any local command or report.
                payload=dict(request)
                if request['command']in {'PREPARE_INDEPENDENT','RUN_INDEPENDENT','RUN_COMPLETE','RUN_IMAGE_REPOSITORY'}:payload['password']=password
                encoded=(json.dumps(payload,separators=(',',':'))+'\n').encode();assert len(encoded)<=65536 or request['command']=='FOLLOWING_CONTROL'and request.get('control')=='PUBLISH'and len(encoded)<=MAX_COMMANDS
                with stdin_lock:child.stdin.write(encoded);child.stdin.flush()
                sent+=1;emit('COMMAND_SENT',originalPid=child.pid,sequence=sent,command=request['command'])
                with condition:
                    while child.poll() is None and not reader_errors and not failed_events and not any(all(v.get(k)==x for k,x in wait.items())for v in events):condition.wait(1)
                    assert not reader_errors and not failed_events and any(all(v.get(k)==x for k,x in wait.items())for v in events)
                emit('ORIGINAL_EVENT_MATCHED',originalPid=child.pid,sequence=sent,observed=wait)
            assert len(buffer)<=MAX_COMMANDS;time.sleep(.25)
    except BaseException as error:
        held=True;emit('SUPERVISOR_HELD_ORIGINAL_RETAINED',originalPid=child.pid,errorType=type(error).__name__)
        # Never close stdin, kill, time out, replace, or disown the original master.
        while child.poll() is None:time.sleep(1)
    status=child.wait()
    for thread in threads:thread.join()
    child.stdin.close()
    durable(evidence/'original-closed.json',dict(format='sabalan-external-original-master-closed/v1',originalPid=child.pid,code=status,pipesClosed=all(s['closed']for s in state.values()),readerErrors=reader_errors,supervisorHeld=held,commandsSent=sent,logs=state,closedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),passwordStored=False,connectionOnly=args.connection_only))
    emit('ORIGINAL_CLOSED',originalPid=child.pid,code=status,pipesClosed=all(s['closed']for s in state.values()),supervisorHeld=held)
    return supervisor_exit_status(status,held,reader_errors,state)
if __name__=='__main__':raise SystemExit(main())
