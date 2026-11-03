"""Read-only Windows/existing PostgreSQL-container VM observation. No reclaim.

GetPerformanceInfo supplies SYSTEM commit, not per-process available pagefile.
Every subprocess is drained to natural closure. No timeout kills an original.
"""
import ctypes as C, datetime, json, subprocess, sys, time, re, threading
from ctypes import wintypes as W

def windows_pressure():
    assert sys.platform == 'win32' and C.sizeof(C.c_void_p) == 8
    class Performance(C.Structure):
        _fields_ = [('cb', W.DWORD)] + [(n, C.c_size_t) for n in
            ['CommitTotal','CommitLimit','CommitPeak','PhysicalTotal','PhysicalAvailable',
             'SystemCache','KernelTotal','KernelPaged','KernelNonpaged','PageSize']] + [
            (n,W.DWORD) for n in ['HandleCount','ProcessCount','ThreadCount']]
    k = C.WinDLL('kernel32', use_last_error=True)
    api = C.WinDLL('psapi', use_last_error=True).GetPerformanceInfo
    api.argtypes=[C.POINTER(Performance),W.DWORD];api.restype=W.BOOL
    value=Performance();value.cb=C.sizeof(value)
    assert api(C.byref(value),value.cb),'SYSTEM_COMMIT_QUERY_FAILED'
    k.CreateMemoryResourceNotification.argtypes=[W.DWORD];k.CreateMemoryResourceNotification.restype=W.HANDLE
    k.QueryMemoryResourceNotification.argtypes=[W.HANDLE,C.POINTER(W.BOOL)];k.QueryMemoryResourceNotification.restype=W.BOOL
    k.CloseHandle.argtypes=[W.HANDLE];k.CloseHandle.restype=W.BOOL
    handle=k.CreateMemoryResourceNotification(0);assert handle,'LOW_MEMORY_NOTIFICATION_UNAVAILABLE'
    try:
        low=W.BOOL();assert k.QueryMemoryResourceNotification(handle,C.byref(low))
    finally:assert k.CloseHandle(handle)
    return {'availableBytes':value.PhysicalAvailable*value.PageSize,'commitTotalBytes':value.CommitTotal*value.PageSize,
            'commitLimitBytes':value.CommitLimit*value.PageSize,'lowMemory':bool(low.value)}

class ProbeClosureFailure(Exception):
    def __init__(self, receipt):self.receipt=receipt;super().__init__('PRESSURE_PROBE_CHILD_FAILED')

def retained_probe(args, popen=subprocess.Popen, thread_factory=threading.Thread):
    # Allocate readers and buffers BEFORE creating the child. A setup fault here
    # owns no process. After Popen succeeds every exit goes through real drain.
    faults=set();buffers={'stdout':bytearray(),'stderr':bytearray()};eof={};child=None
    def drain(name):
        stream=getattr(child,name);total=0
        try:
            while True:
                raw=stream.read(4096)
                if not raw:eof[name]=True;break
                total+=len(raw)
                if total<=65536:buffers[name].extend(raw)
                else:faults.add('OUTPUT_BOUND')
        except BaseException:faults.add('READER_FAULT')
        finally:stream.close()
    readers=[thread_factory(target=drain,args=(name,)) for name in ['stdout','stderr']]
    child=popen(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        for reader in readers:
            while reader.ident is None:
                try:reader.start()
                except BaseException:faults.add('READER_START_FAULT');time.sleep(.05)
        while child.returncode is None:
            try:child.wait()
            except BaseException:faults.add('WAIT_FAULT');time.sleep(.05)
    finally:
        # Even a control interruption cannot report the original as closed.
        for reader in readers:
            while reader.ident is None:
                try:reader.start()
                except BaseException:faults.add('READER_START_FAULT');time.sleep(.05)
        while child.returncode is None:
            try:child.wait()
            except BaseException:faults.add('WAIT_FAULT');time.sleep(.05)
        for reader in readers:
            while True:
                try:reader.join();break
                except BaseException:faults.add('READER_JOIN_FAULT');time.sleep(.05)
    receipt={'originalPid':child.pid,'code':child.returncode,'stdoutEof':eof.get('stdout',False),'stderrEof':eof.get('stderr',False)}
    if child.returncode!=0 or faults or buffers['stderr'] or not all(eof.get(n,False)for n in buffers):raise ProbeClosureFailure(receipt)
    return bytes(buffers['stdout']),receipt

def observe():
    started=time.monotonic();observed_at=datetime.datetime.now(datetime.timezone.utc).isoformat();host=windows_pressure()
    children=[]
    def read(args):
        out,receipt=retained_probe(args);children.append(receipt);return out
    # Docker exec does not start a stopped VM/container. The immediately prior
    # actual Compose ps pins the one existing sabalanerp-local PostgreSQL ID.
    ps=read(['C:/Users/mahan/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe','compose','--project-name','sabalanerp-local','-f',
        'D:/sabalanerp/docker-compose.local.yml','ps','--all','--no-trunc','--format','json']).decode()
    rows=json.loads(ps) if ps.lstrip().startswith('[') else [json.loads(line) for line in ps.splitlines() if line]
    selected=[r for r in rows if r['Project']=='sabalanerp-local' and r['Service']=='postgres']
    assert len(selected)==1 and selected[0]['State']=='running' and selected[0]['Health']=='healthy','PRESSURE_VM_SERVICE_NOT_HEALTHY'
    container=selected[0]['ID'];assert re.fullmatch('[a-f0-9]{64}',container)
    raw=read(['C:/Users/mahan/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe','exec',container,'/bin/cat','/proc/sys/kernel/random/boot_id',
              '/proc/pressure/memory','/proc/vmstat']).decode()
    lines=raw.splitlines();psi={}
    for line in lines[1:]:
        if line.startswith(('some ','full ')):
            fields=dict(p.split('=',1) for p in line.split()[1:]);psi[line.split()[0]]=float(fields['avg10'])
    oom=[int(line.split()[1]) for line in lines if line.startswith('oom_kill ')]
    assert set(psi)=={'some','full'} and len(oom)==1,'VM_PRESSURE_UNAVAILABLE'
    return {'format':'sabalan-local-qa-pressure/v1','platform':'win32',
        'observedAt':observed_at,
        **host,'vm':{'probeContainerId':container,'bootId':lines[0],'fullAvg10':psi['full'],
            'someAvg10':psi['some'],'oomKills':oom[0]},
        'probe':{'durationMs':(time.monotonic()-started)*1000,'children':children}}

def observe_frontend_memory():
    started=time.monotonic();at=datetime.datetime.now(datetime.timezone.utc).isoformat();before=windows_pressure();children=[]
    docker='C:/Users/mahan/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
    def read(args):
        out,row=retained_probe([docker,*args]);children.append(row);return out
    def census():
        raw=read(['compose','--project-name','sabalanerp-local','-f','D:/sabalanerp/docker-compose.local.yml','ps','--all','--no-trunc','--format','json']).decode()
        rows=json.loads(raw)if raw.lstrip().startswith('[')else[json.loads(line)for line in raw.splitlines()if line]
        assert len(rows)==10 and all(r['Project']=='sabalanerp-local'for r in rows)
        result={r['Service']:r for r in rows};assert len(result)==10
        for name in ['frontend','backend-candidate']:assert re.fullmatch('[a-f0-9]{64}',result[name]['ID'])
        return result
    rows=census();front=json.loads(read(['container','inspect',rows['frontend']['ID']]))[0]
    assert front['Id']==rows['frontend']['ID'] and front['Config']['Labels']['com.docker.compose.project']=='sabalanerp-local' and front['Config']['Labels']['com.docker.compose.service']=='frontend'
    selected='frontend'if front['State']['Running']else'backend-candidate'
    current=census();assert {k:v['ID']for k,v in rows.items()}=={k:v['ID']for k,v in current.items()}
    assert current[selected]['State']=='running' and current[selected]['Health']=='healthy'
    # Fixed read-only Node probe. No SQL, app import, shell, process control,
    # reclaim or externally selected path; the probe itself is included in cgroup.
    code=r"""const f=require('fs'),read=p=>f.readFileSync(p,'utf8'),numbers=t=>Object.fromEntries(t.trim().split(/\n/).map(l=>{const[k,v]=l.trim().split(/[:\s]+/);return[k,Number(v)];}));const mem=numbers(read('/proc/meminfo')),stat=numbers(read('/sys/fs/cgroup/memory.stat')),events=numbers(read('/sys/fs/cgroup/memory.events'));const processes=[];for(const pid of f.readdirSync('/proc').filter(p=>/^[0-9]+$/.test(p))){try{const text=read('/proc/'+pid+'/status'),s=read('/proc/'+pid+'/stat').split(')').slice(1).join(')').trim().split(/\s+/),kb=k=>{const m=text.match(new RegExp('^'+k+':\\s+([0-9]+)','m'));return m?Number(m[1])*1024:null;};processes.push({pid:Number(pid),parentPid:Number(s[1]),startTicks:s[19],name:text.match(/^Name:\s+(.+)$/m)?.[1]??null,rssAnonBytes:kb('RssAnon'),rssBytes:kb('VmRSS'),swapBytes:kb('VmSwap'),measurementProbe:Number(pid)===process.pid});}catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}}console.log(JSON.stringify({observedAt:new Date().toISOString(),bootId:read('/proc/sys/kernel/random/boot_id').trim(),probePid:process.pid,vmBytes:Object.fromEntries(['MemTotal','MemAvailable','AnonPages','Cached','Buffers','Shmem','SReclaimable','SwapTotal','SwapFree','SwapCached'].map(k=>[k,mem[k]*1024])),psi:read('/proc/pressure/memory').trim(),vmOomKills:numbers(read('/proc/vmstat')).oom_kill,cgroup:{current:read('/sys/fs/cgroup/memory.current').trim(),maximum:read('/sys/fs/cgroup/memory.max').trim(),swapCurrent:read('/sys/fs/cgroup/memory.swap.current').trim(),swapMaximum:read('/sys/fs/cgroup/memory.swap.max').trim(),stat,events,includesMeasurementProbe:true},processes}));"""
    guest=json.loads(read(['exec',current[selected]['ID'],'/usr/local/bin/node','-e',code]))
    after=windows_pressure()
    return {'format':'sabalan-local-dev-frontend-memory/v1','observedAt':at,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'durationMs':(time.monotonic()-started)*1000,'windowsBefore':before,'windowsAfter':after,'frontend':{'id':front['Id'],'image':front['Image'],'startedAt':front['State']['StartedAt'],'running':front['State']['Running'],'pid':front['State']['Pid'],'health':front['State'].get('Health',{}).get('Status'),'oomKilled':front['State']['OOMKilled'],'restartCount':front['RestartCount'],'memoryLimitBytes':front['HostConfig']['Memory'],'memorySwapBytes':front['HostConfig']['MemorySwap']},'probeService':selected,'probeContainerId':current[selected]['ID'],'guest':guest,'frontendCgroup':guest['cgroup']if selected=='frontend'else None,'originalChildren':children,'memoryFreedClaimed':False,'productionAdmission':False}

if __name__=='__main__':
    assert sys.argv[1:]in ([],['--frontend-memory']),'FIXED_OBSERVATION_ONLY'
    print(json.dumps(observe_frontend_memory()if sys.argv[1:]else observe()),flush=True)
