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

if os.name != 'nt' or len(sys.argv) != 2 or sys.argv[1] not in ('normal', 'stall'):
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
K.CloseHandle.argtypes = [W.HANDLE]; K.CloseHandle.restype = W.BOOL

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

def main():
    job=K.CreateJobObjectW(None,None)
    if not job: raise OSError(C.get_last_error(),'JOB_CREATE')
    proc=thread=None
    streams={}; readers=[]; data={'stdout':bytearray(),'stderr':bytearray()}; eof={'stdout':False,'stderr':False}; openWrites=set();openReads=set();nullfd=None
    errors=[]; overflow=[]; result={'status':'UNKNOWN','fixtureOnly':True,'crashDurability':'UNKNOWN'}
    try:
        for name in ('stdout','stderr'):
            readfd,writefd=os.pipe();openReads.add(readfd);openWrites.add(writefd);os.set_inheritable(writefd,True);streams[name]=(readfd,writefd)
        nullfd=os.open(os.devnull,os.O_RDONLY);os.set_inheritable(nullfd,True)
        si=subprocess.STARTUPINFO();si.dwFlags|=subprocess.STARTF_USESTDHANDLES
        si.hStdInput=msvcrt.get_osfhandle(nullfd);si.hStdOutput=msvcrt.get_osfhandle(streams['stdout'][1]);si.hStdError=msvcrt.get_osfhandle(streams['stderr'][1])
        si.lpAttributeList={'handle_list':[si.hStdInput,si.hStdOutput,si.hStdError]}
        snippet="import time; print('FIXTURE_CHILD',flush=True); time.sleep("+('1' if sys.argv[1]=='normal' else '30')+")"
        command=subprocess.list2cmdline([sys.executable,'-I','-c',snippet])
        env={'SystemRoot':os.environ['SystemRoot']}
        proc,thread,pid,tid=_winapi.CreateProcess(sys.executable,command,None,None,True,0x00000004|0x08000000,env,None,si)
        result.update(pid=pid,threadId=tid,birth100ns=str(process_birth(proc)),createdSuspended=True)
        if not K.AssignProcessToJobObject(job,proc): raise OSError(C.get_last_error(),'JOB_ASSIGN')
        result['assignedBeforeResume']=True
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
        wait=K.WaitForSingleObject(proc,3000)
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
        result['failure']=type(e).__name__+': '+str(e)
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
        if any(v!='CLOSED' for v in result['closeResults'].values()):result['status']='UNKNOWN'
        print(json.dumps(result,sort_keys=True),flush=True)

if __name__=='__main__':main()
