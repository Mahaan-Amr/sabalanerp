"""SOURCE REVIEW ONLY: fixed synthetic Windows Job supervisor.

No operation/lease/Compose/database path is accepted. This prototype is not
an operational adapter, production fence, or crash-durability guarantee.
"""
import ctypes as C
from ctypes import wintypes as W
import json
import os
import subprocess
import sys
import threading
import time
import _winapi
import msvcrt
import hashlib,uuid,tempfile,importlib.util
import struct
from pathlib import Path

if os.name != 'nt' or len(sys.argv) != 2 or sys.argv[1] != 'successor':
    raise SystemExit('FIXED_TEST_MODE_REQUIRED')

K = C.WinDLL('kernel32', use_last_error=True)
K.CreateJobObjectW.argtypes = [C.c_void_p, W.LPCWSTR]; K.CreateJobObjectW.restype = W.HANDLE
K.AssignProcessToJobObject.argtypes = [W.HANDLE, W.HANDLE]; K.AssignProcessToJobObject.restype = W.BOOL
K.ResumeThread.argtypes = [W.HANDLE]; K.ResumeThread.restype = W.DWORD
K.TerminateJobObject.argtypes = [W.HANDLE, W.UINT]; K.TerminateJobObject.restype = W.BOOL
K.TerminateProcess.argtypes = [W.HANDLE, W.UINT]; K.TerminateProcess.restype = W.BOOL
K.WaitForSingleObject.argtypes = [W.HANDLE, W.DWORD]; K.WaitForSingleObject.restype = W.DWORD
K.GetExitCodeProcess.argtypes = [W.HANDLE, C.POINTER(W.DWORD)]; K.GetExitCodeProcess.restype = W.BOOL
K.GetProcessTimes.argtypes = [W.HANDLE,C.POINTER(W.FILETIME),C.POINTER(W.FILETIME),C.POINTER(W.FILETIME),C.POINTER(W.FILETIME)]; K.GetProcessTimes.restype = W.BOOL
K.GetCurrentProcess.argtypes = []; K.GetCurrentProcess.restype = W.HANDLE
K.OpenProcess.argtypes=[W.DWORD,W.BOOL,W.DWORD];K.OpenProcess.restype=W.HANDLE
K.QueryFullProcessImageNameW.argtypes=[W.HANDLE,W.DWORD,W.LPWSTR,C.POINTER(W.DWORD)];K.QueryFullProcessImageNameW.restype=W.BOOL
K.CloseHandle.argtypes = [W.HANDLE]; K.CloseHandle.restype = W.BOOL
N=C.WinDLL('ntdll',use_last_error=True)
class PROCESS_BASIC_INFORMATION(C.Structure):
    _fields_=[('status',C.c_void_p),('peb',C.c_void_p),('affinity',C.c_void_p),('priority',C.c_void_p),('pid',C.c_void_p),('parent',C.c_void_p)]
N.NtQueryInformationProcess.argtypes=[W.HANDLE,W.DWORD,C.c_void_p,W.ULONG,C.POINTER(W.ULONG)];N.NtQueryInformationProcess.restype=C.c_long

class ACCOUNTING(C.Structure):
    _fields_ = [('user',C.c_longlong),('kernel',C.c_longlong),('periodUser',C.c_longlong),('periodKernel',C.c_longlong),
                ('faults',W.DWORD),('total',W.DWORD),('active',W.DWORD),('terminated',W.DWORD)]
K.QueryInformationJobObject.argtypes = [W.HANDLE,C.c_int,C.c_void_p,W.DWORD,C.c_void_p]
K.QueryInformationJobObject.restype = W.BOOL

def job_active(job):
    info=ACCOUNTING()
    if not K.QueryInformationJobObject(job,1,C.byref(info),C.sizeof(info),None):
        raise OSError(C.get_last_error(),'JOB_QUERY')
    return info.active

def process_birth(proc):
    created,exited,kernel,user=W.FILETIME(),W.FILETIME(),W.FILETIME(),W.FILETIME()
    if not K.GetProcessTimes(proc,C.byref(created),C.byref(exited),C.byref(kernel),C.byref(user)):
        raise OSError(C.get_last_error(),'PROCESS_BIRTH')
    return (int(created.dwHighDateTime)<<32)|int(created.dwLowDateTime)

SOURCE_ROOT=Path(r'C:\Users\mahan\.codex\worktrees\phase1-existing-lease\sabalanerp')
SUPPORT=Path(r'C:\Users\mahan\AppData\Local\Temp\sabalan-419-held-window-20261102\finite-bridge-windows-v11-UNEXECUTED.py')
EXPECTED_SUPPORT='8250681666ea5f5ac6859fb8967d26c1c7720b32821c6c52ec12c964182a88e6'
EXPECTED_NODE='364dbc8442f8d5c04fd4226bcfcf8e60d3268627eb1d7be214a91bb7d74cdbb9'
PINS={
'scripts/lib/reconciliation-phase1-launcher.mjs':'7e23b2c24af61d641f9d071d28f9c00756173c3c4f2df258de5a1e931f56898b',
'scripts/lib/reconciliation-phase1-verify.mjs':'a7d1c9d9eada3eb44f09b4fa746a73170123b2a286f0ec6dfbbcd1d95ba8a3bb',
'scripts/lib/reconciliation-phase1-core.mjs':'87e2b0d974b43550099a891c42fbaee7f1920951f078738768d713b383a526ab',
'scripts/lib/serial-physical/host-lease.mjs':'fb33daf411d28b19d0eb2186ec7e13c910b90fc368ca0a981a1777299d3fe4fd',
'scripts/lib/serial-physical/host-lease.ps1':'4783bc2c95b617091f99e58a4e8bfb0d42e91997089c38b4cb0ceaf51e6d0a09',
'scripts/lib/reconciliation-readonly-phase1-cli.mjs':'e8d5da4367634c15dc9866e9531e2714bb9568702aed9cf092b46b381b04e28d',
'scripts/lib/reconciliation-phase1-census.ps1':'54d4dc66cbbeb7c26971a41e4e2911d2ed4329727954b1eb6522ab5ae85554a2',
'scripts/lib/reconciliation-phase1-lock-identity.ps1':'6c8641c4fdfb7d0e1d9c6e451edb85a39b836a6d521a8048e70b9d40ca43e1ed',
' tests/phase1-existing-lease/phase1-fixture-adapter.mjs'.strip():'5dde3c129ac173c398d96394cdd80229052fd8e472ad3f1197fd2747e04c6dc4',
}
MANIFEST_NAMES=['scripts/lib/reconciliation-phase1-core.mjs','scripts/lib/serial-physical/host-lease.mjs','scripts/lib/serial-physical/host-lease.ps1','tests/phase1-existing-lease/phase1-fixture-adapter.mjs','scripts/lib/reconciliation-readonly-phase1-cli.mjs','scripts/lib/reconciliation-phase1-census.ps1','scripts/lib/reconciliation-phase1-lock-identity.ps1']
K.CreateFileW.argtypes=[W.LPCWSTR,W.DWORD,W.DWORD,C.c_void_p,W.DWORD,W.DWORD,W.HANDLE];K.CreateFileW.restype=W.HANDLE
class ID128(C.Structure):_fields_=[('value',C.c_ubyte*16)]
class IDINFO(C.Structure):_fields_=[('volume',C.c_ulonglong),('value',ID128)]
K.GetFileInformationByHandleEx.argtypes=[W.HANDLE,C.c_int,C.c_void_p,W.DWORD];K.GetFileInformationByHandleEx.restype=W.BOOL
class TAGINFO(C.Structure):_fields_=[('attributes',W.DWORD),('tag',W.DWORD)]

def guarded_id(handle):
    info=IDINFO();tag=TAGINFO()
    if not K.GetFileInformationByHandleEx(handle,18,C.byref(info),C.sizeof(info)):raise OSError(C.get_last_error(),'GUARD_ID')
    if not K.GetFileInformationByHandleEx(handle,9,C.byref(tag),C.sizeof(tag)):raise OSError(C.get_last_error(),'GUARD_ATTRIBUTES')
    if tag.attributes & 0x400:raise RuntimeError('GUARD_REPARSE')
    return str(info.volume)+':'+bytes(info.value.value).hex()

def guard_staged_sources(root,m,extras=None,events=None):
    # File handles request READ with share READ only. Directory metadata
    # handles remain access=0; neither claim protects an unpinned ancestor.
    # These opens may block writers and apply only to fresh fixture copies.
    protected=dict(PINS);protected.update(extras or {})
    dirs={root}
    for name in protected:
        item=root/name
        while item.parent!=root:
            item=item.parent;dirs.add(item)
    handles=[];identities=[]
    try:
        for file in sorted(dirs,key=lambda p:(len(p.parts),str(p)))+[root/n for n in sorted(protected)]:
            m.no_reparse(file)
            isDir=file.is_dir();flags=0x00200000 | (0x02000000 if isDir else 0);access=0 if isDir else 0x80000000
            h=K.CreateFileW(str(file),access,1,None,3,flags,None)
            code=C.get_last_error() if h==C.c_void_p(-1).value else 0
            if events is not None:events.append({'relative':str(file.relative_to(root)),'operation':'GUARD_OPEN','access':access,'share':1,'disposition':3,'flags':flags,'win32':code})
            if h==C.c_void_p(-1).value:raise OSError(code,'GUARD_OPEN')
            handles.append(h);first=guarded_id(h)
            # Independent second handle observes the same pathname; still a
            # snapshot and not a defence against a privileged hostile actor.
            check=K.CreateFileW(str(file),0,7,None,3,flags,None)
            code=C.get_last_error() if check==C.c_void_p(-1).value else 0
            if events is not None:events.append({'relative':str(file.relative_to(root)),'operation':'RECHECK_OPEN','access':0,'share':7,'disposition':3,'flags':flags,'win32':code})
            if check==C.c_void_p(-1).value:raise OSError(code,'GUARD_RECHECK')
            try:second=guarded_id(check)
            finally:
                if not K.CloseHandle(check):raise OSError(C.get_last_error(),'GUARD_RECHECK_CLOSE')
            if first!=second:raise RuntimeError('GUARD_PATH_ID_MISMATCH')
            identities.append({'relative':str(file.relative_to(root)),'fileId':first})
        for name,want in protected.items():
            if hashlib.sha256((root/name).read_bytes()).hexdigest()!=want:raise RuntimeError('GUARD_SOURCE_HASH')
        return handles,identities
    except BaseException:
        closeUnknown=False
        for h in reversed(handles):
            if not K.CloseHandle(h):closeUnknown=True
        if closeUnknown:raise RuntimeError('GUARD_CLOSE_UNKNOWN')
        raise

def prepare_fixture():
    if hashlib.sha256(SUPPORT.read_bytes()).hexdigest()!=EXPECTED_SUPPORT:raise RuntimeError('SUPPORT_PIN')
    spec=importlib.util.spec_from_file_location('fixture_support',SUPPORT);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    temp=Path(tempfile.gettempdir()).absolute()
    if str(temp).lower()!=r'c:\users\mahan\appdata\local\temp':raise RuntimeError('TEMP_PARENT')
    m.no_reparse(temp);m.no_reparse(SUPPORT);m.no_reparse(SOURCE_ROOT)
    root=temp/('sabalan-phase1-fixture-'+uuid.uuid4().hex);m.create_private(root);rootid=m.root_identity(root)
    for name,want in PINS.items():
        src=SOURCE_ROOT/name;m.no_reparse(src);raw=src.read_bytes()
        if hashlib.sha256(raw).hexdigest()!=want:raise RuntimeError('SOURCE_PIN_'+name)
        target=root/name;target.parent.mkdir(parents=True,exist_ok=True);m.no_reparse(target.parent);m.write_bytes(target,raw)
    m.write_bytes(root/'fixture.lock',b'test-only lease')
    m.write_bytes(root/'evidence.json',b'{"fixture":true}')
    handle=K.CreateFileW(str(root/'fixture.lock'),0,7,None,3,0x00200000,None)
    if handle==C.c_void_p(-1).value:raise OSError(C.get_last_error(),'FIXTURE_ID_OPEN')
    try:
        info=IDINFO()
        if not K.GetFileInformationByHandleEx(handle,18,C.byref(info),C.sizeof(info)):raise OSError(C.get_last_error(),'FIXTURE_ID')
        identity=str(info.volume)+':'+bytes(info.value.value).hex()
    finally:
        if not K.CloseHandle(handle):raise OSError(C.get_last_error(),'FIXTURE_ID_CLOSE')
    manifest={'format':'phase1-fixture-manifest/v1','operation':'TEST_ONLY','action':'FIXTURE_AUDIT','allowedTargets':['fixture.lock','evidence.json'],'sources':[{'path':n,'sha256':PINS[n]} for n in MANIFEST_NAMES]}
    raw=json.dumps(manifest,sort_keys=True).encode();manifestHash=hashlib.sha256(raw).hexdigest();m.write_bytes(root/'fixture-manifest.json',raw)
    m.write_bytes(root/'fixture-anchor.json',json.dumps({'format':'phase1-fixture-anchor/v1','fixtureOnly':True,'manifestSha256':manifestHash}).encode())
    intent={'fixtureOnly':True,'root':str(root),'rootIdentity':list(rootid),'manifestSha256':manifestHash,'fileId':identity,'sourcePins':PINS,'sourcePathRace':'UNPROVEN','crashDurability':'UNKNOWN'}
    m.write_bytes(root/'supervisor-intent.json',json.dumps(intent,sort_keys=True).encode())
    if m.root_identity(root)!=rootid:raise RuntimeError('ROOT_CHANGED')
    for name,want in PINS.items():
        if hashlib.sha256((root/name).read_bytes()).hexdigest()!=want:raise RuntimeError('STAGED_SOURCE_CHANGED')
    return m,root,rootid,identity

def job_member_pids(job):
    # JobObjectBasicProcessIdList, sized for a bounded test-owned Job.
    raw=C.create_string_buffer(8+128*C.sizeof(C.c_size_t))
    if not K.QueryInformationJobObject(job,3,raw,len(raw),None):raise OSError(C.get_last_error(),'JOB_MEMBER_QUERY')
    assigned,count=struct.unpack_from('<II',raw.raw,0)
    if assigned>128 or count>128 or assigned!=count:raise RuntimeError('JOB_MEMBER_LIST_INCOMPLETE')
    return [struct.unpack_from('<Q' if C.sizeof(C.c_size_t)==8 else '<I',raw.raw,8+i*C.sizeof(C.c_size_t))[0] for i in range(count)]

def witness_fixture_lease(job,launcherPid,root,m):
    source=root/'fixture-lease-self.json';target=root/'fixture-lease-job-proof.json'
    if target.exists() or not source.exists():return
    m.no_reparse(source);st=source.stat()
    if st.st_nlink!=1 or st.st_size>16384:raise RuntimeError('LEASE_SELF_RECEIPT_INVALID')
    proof=json.loads(source.read_bytes());runId=root.name.removeprefix('sabalan-phase1-fixture-')
    if proof.get('format')!='phase1-fixture-lease-self/v1' or proof.get('fixtureOnly') is not True or proof.get('runId')!=runId or proof.get('parentPid')!=launcherPid:raise RuntimeError('LEASE_SELF_IDENTITY')
    pid=proof.get('pid');members=job_member_pids(job)
    if not isinstance(pid,int) or pid not in members:raise RuntimeError('LEASE_NOT_IN_JOB')
    handle=K.OpenProcess(0x1000,False,pid)
    if not handle:raise OSError(C.get_last_error(),'LEASE_QUERY_OPEN')
    try:
        birth=str(process_birth(handle));info=PROCESS_BASIC_INFORMATION();returned=W.ULONG()
        if N.NtQueryInformationProcess(handle,0,C.byref(info),C.sizeof(info),C.byref(returned))!=0:raise RuntimeError('LEASE_PARENT_QUERY')
        buf=C.create_unicode_buffer(32768);size=W.DWORD(len(buf))
        if not K.QueryFullProcessImageNameW(handle,0,buf,C.byref(size)):raise OSError(C.get_last_error(),'LEASE_IMAGE_QUERY')
        exe=Path(buf.value);m.no_reparse(exe);exehash=hashlib.sha256(exe.read_bytes()).hexdigest()
        helperHash=hashlib.sha256((root/'scripts/lib/serial-physical/host-lease.ps1').read_bytes()).hexdigest()
        if birth!=proof.get('birth100ns') or int(info.parent or 0)!=launcherPid or exehash!=proof.get('executableSha256') or helperHash!=PINS['scripts/lib/serial-physical/host-lease.ps1'] or helperHash!=proof.get('helperSha256'):raise RuntimeError('LEASE_PROCESS_IDENTITY_MISMATCH')
        record={'format':'phase1-fixture-lease-job-proof/v1','fixtureOnly':True,'runId':runId,'pid':pid,'birth100ns':birth,'parentPid':launcherPid,'jobMembers':members,'jobEvidence':'SUPERVISOR_HANDLE_QUERY','helperSha256':helperHash,'executableSha256':exehash,'source':'PARENT_REPORTED','pathRace':'UNPROVEN'}
    finally:
        if not K.CloseHandle(handle):raise OSError(C.get_last_error(),'LEASE_QUERY_CLOSE')
    staging=root/'fixture-lease-job-proof.staging';m.write_bytes(staging,json.dumps(record,sort_keys=True).encode())
    os.link(staging,target)

def main():
    m,root,rootid,identity=prepare_fixture()
    print('FIXTURE_ROOT='+str(root),flush=True)
    extras={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in ('fixture-manifest.json','fixture-anchor.json')}
    sourceGuards,guardIdentities=guard_staged_sources(root,m,extras)
    job=K.CreateJobObjectW(None,None)
    if not job:
        error=C.get_last_error();closeUnknown=False
        for h in reversed(sourceGuards):
            if not K.CloseHandle(h):closeUnknown=True
        if closeUnknown:raise RuntimeError('GUARD_CLOSE_UNKNOWN')
        raise OSError(error,'JOB_CREATE')
    proc=thread=None
    streams={}; readers=[]; data={'stdout':bytearray(),'stderr':bytearray()}; eof={'stdout':False,'stderr':False}; openWrites=set();openReads=set();nullfd=None
    errors=[]; overflow=[]; result={'status':'UNKNOWN','fixtureOnly':True,'semanticOutcome':'NOT_EVALUATED','crashDurability':'UNKNOWN','sourceGuards':guardIdentities,'sourceGuardScope':'TEST_OWNED_COPIES_ONLY'}
    try:
        for name in ('stdout','stderr'):
            readfd,writefd=os.pipe();openReads.add(readfd);openWrites.add(writefd);os.set_inheritable(writefd,True);streams[name]=(readfd,writefd)
        nullfd=os.open(os.devnull,os.O_RDONLY);os.set_inheritable(nullfd,True)
        si=subprocess.STARTUPINFO();si.dwFlags|=subprocess.STARTF_USESTDHANDLES
        si.hStdInput=msvcrt.get_osfhandle(nullfd);si.hStdOutput=msvcrt.get_osfhandle(streams['stdout'][1]);si.hStdError=msvcrt.get_osfhandle(streams['stderr'][1])
        si.lpAttributeList={'handle_list':[si.hStdInput,si.hStdOutput,si.hStdError]}
        node=Path(r'C:\Program Files\nodejs\node.exe');m.no_reparse(node)
        if hashlib.sha256(node.read_bytes()).hexdigest()!=EXPECTED_NODE:raise RuntimeError('NODE_SOURCE_PIN')
        launcher=root/'scripts/lib/reconciliation-phase1-launcher.mjs'
        command=subprocess.list2cmdline([str(node),str(launcher),'--test-owned',str(root),identity])
        env={'SystemRoot':os.environ['SystemRoot'],'TEMP':str(root.parent),'TMP':str(root.parent),'PATH':r'C:\Windows\System32;C:\Windows'}
        proc,thread,pid,tid=_winapi.CreateProcess(str(node),command,None,None,True,0x00000004|0x08000000,env,None,si)
        result.update(pid=pid,threadId=tid,birth100ns=str(process_birth(proc)),createdSuspended=True)
        if not K.AssignProcessToJobObject(job,proc): raise OSError(C.get_last_error(),'JOB_ASSIGN')
        result['assignedBeforeResume']=True
        members=job_member_pids(job)
        if pid not in members:raise RuntimeError('ORIGINAL_CHILD_NOT_IN_JOB')
        proof={'format':'phase1-fixture-owner-proof/v1','fixtureOnly':True,'runId':root.name.removeprefix('sabalan-phase1-fixture-'),
               'launcherPid':pid,'launcherBirth100ns':str(process_birth(proc)),'parentPid':os.getpid(),
               'parentBirth100ns':str(process_birth(K.GetCurrentProcess())),
               'jobAssignedBeforeResume':True,'jobMembers':members,'jobEvidence':'SUPERVISOR_HANDLE_QUERY',
               'launcherSha256':PINS['scripts/lib/reconciliation-phase1-launcher.mjs'],'nodeSha256':EXPECTED_NODE,
               'authority':'PARENT_REPORTED_FIXED_TEST_ROLE','pathRace':'UNPROVEN'}
        m.write_bytes(root/'fixture-owner-proof.json',json.dumps(proof,sort_keys=True).encode())
        for name in streams:
            os.close(streams[name][1]);openWrites.remove(streams[name][1])
        os.close(nullfd);nullfd=None
        def read(name,fd):
            try:
                with os.fdopen(fd,'rb',closefd=True) as f:
                    while True:
                        chunk=f.read(4096)
                        if not chunk: eof[name]=True;return
                        if len(data[name])+len(chunk)>65536: overflow.append(name)
                        else:data[name].extend(chunk)
            except BaseException as e:errors.append(name+':'+type(e).__name__)
        for name,(fd,_) in streams.items():
            t=threading.Thread(target=read,args=(name,fd));t.start();readers.append(t);openReads.remove(fd)
        if K.ResumeThread(thread)==0xffffffff:raise OSError(C.get_last_error(),'RESUME')
        result['resumed']=True
        limit=time.monotonic()+30;wait=258
        while time.monotonic()<limit:
            wait=K.WaitForSingleObject(proc,50)
            if wait!=258:break
            witness_fixture_lease(job,pid,root,m)
        if wait==258:
            result['timeout']=True
            if not K.TerminateJobObject(job,81):raise OSError(C.get_last_error(),'JOB_TERMINATE')
            wait=K.WaitForSingleObject(proc,5000)
        result['processWait']=int(wait)
        code=W.DWORD()
        if wait!=0 or not K.GetExitCodeProcess(proc,C.byref(code)):raise RuntimeError('PROCESS_CLOSURE_UNPROVEN')
        result['exitCode']=int(code.value)
        deadline=time.monotonic()+5
        while time.monotonic()<deadline and job_active(job)!=0:time.sleep(.02)
        result['activeJobProcesses']=job_active(job)
        for t in readers:t.join(max(0,deadline-time.monotonic()))
        result.update(stdoutEof=eof['stdout'],stderrEof=eof['stderr'],readerErrors=errors,outputOverflow=overflow)
        if result['activeJobProcesses']==0 and all(eof.values()) and not errors and not overflow and not any(t.is_alive() for t in readers):
            result['status']='UNKNOWN_TIMEOUT_CLOSURE_OBSERVED' if result.get('timeout') else 'FIXTURE_CLOSED_OBSERVED'
    except BaseException as e:
        # Do not copy exception text, command lines, paths or child output.
        result['failureType']=type(e).__name__ if type(e).__name__ in ('OSError','RuntimeError','ValueError') else 'OTHER'
        # Controlled cleanup targets only the exact newly created process or
        # its own assigned Job; failed cleanup remains UNKNOWN.
        if proc is not None and K.WaitForSingleObject(proc,0)!=0:
            if result.get('assignedBeforeResume'):
                result['cleanupRequest']='JOB_TERMINATE_REQUESTED' if K.TerminateJobObject(job,82) else 'UNKNOWN'
            else:
                result['cleanupRequest']='PROCESS_TERMINATE_REQUESTED' if K.TerminateProcess(proc,82) else 'UNKNOWN'
        for writefd in tuple(openWrites):
            try:os.close(writefd);openWrites.remove(writefd)
            except OSError:result['writerClose']='UNKNOWN'
        for readfd in tuple(openReads):
            try:os.close(readfd);openReads.remove(readfd)
            except OSError:result['readerClose']='UNKNOWN'
        if nullfd is not None:
            try:os.close(nullfd)
            except OSError:result['stdinClose']='UNKNOWN'
    finally:
        # A dead root is not proof that Job descendants exited. A Job that
        # was assigned is queried independently, and any still-active
        # test-owned Job is terminated only through its original handle.
        active='UNKNOWN'
        if result.get('assignedBeforeResume'):
            try:
                active=job_active(job)
                if active:
                    result['cleanupJob']='REQUESTED' if K.TerminateJobObject(job,83) else 'UNKNOWN'
            except BaseException:result['cleanupJob']='UNKNOWN'
        # If job accounting is unavailable, process or reader closure is
        # incomplete, hold original handles; do not turn that into success.
        announced=False
        while proc is not None:
            try:active=job_active(job) if result.get('assignedBeforeResume') else 0
            except BaseException:active='UNKNOWN'
            processDone=K.WaitForSingleObject(proc,0)==0
            readerDone=not any(t.is_alive() for t in readers)
            if processDone and readerDone and active==0:break
            if not announced:
                result['status']='UNKNOWN_RETAINING_HANDLES';print(json.dumps(result),flush=True);announced=True
            time.sleep(.1)
        result['finalJobActive']=active
        if active != 0:result['status']='UNKNOWN'
        result['closeResults']={}
        for label,h in (('thread',thread),('process',proc),('job',job)):
            if h is not None:result['closeResults'][label]='CLOSED' if K.CloseHandle(h) else 'UNKNOWN'
        result['sourceGuardClose']='CLOSED'
        for h in reversed(sourceGuards):
            if not K.CloseHandle(h):result['sourceGuardClose']='UNKNOWN'
        if result['sourceGuardClose']!='CLOSED':result['status']='UNKNOWN'
        if any(v!='CLOSED' for v in result['closeResults'].values()):result['status']='UNKNOWN'
        try:
            if m.root_identity(root)!=rootid:raise RuntimeError('ROOT_CHANGED')
            result['stdoutCapturedSha256']=hashlib.sha256(data['stdout']).hexdigest();result['stderrCapturedSha256']=hashlib.sha256(data['stderr']).hexdigest()
            result['stdoutComplete']=eof['stdout'] and 'stdout' not in overflow;result['stderrComplete']=eof['stderr'] and 'stderr' not in overflow
            result['stdoutCapturedBytes']=len(data['stdout']);result['stderrCapturedBytes']=len(data['stderr'])
            result['rawStreamsPersisted']=False
            result['directoryDurability']='UNKNOWN';result['aclIndependentVerification']='UNKNOWN';result['sourcePathRace']='UNPROVEN'
            m.write_bytes(root/'supervisor-result.json',json.dumps(result,sort_keys=True).encode())
        except BaseException as e:
            result['status']='UNKNOWN';result['receiptFailure']=type(e).__name__
        print(json.dumps(result,sort_keys=True),flush=True)

if __name__=='__main__':
    try:main()
    except BaseException as error:
        kind=type(error).__name__ if type(error).__name__ in ('OSError','RuntimeError','ValueError') else 'OTHER'
        print(json.dumps({'fixtureOnly':True,'status':'UNKNOWN','failureType':kind,'crashDurability':'UNKNOWN'}),flush=True)
        raise SystemExit(1)
