"""Read-only Windows process/parent custody; no signals or lease acquisition."""
import ctypes,json,os,pathlib,stat,sys
from ctypes import wintypes as W
assert os.name=='nt'
K=ctypes.WinDLL('kernel32',use_last_error=True);N=ctypes.WinDLL('ntdll')
K.OpenProcess.argtypes=[W.DWORD,W.BOOL,W.DWORD];K.OpenProcess.restype=W.HANDLE
K.CloseHandle.argtypes=[W.HANDLE];K.CloseHandle.restype=W.BOOL
K.GetProcessId.argtypes=[W.HANDLE];K.GetProcessId.restype=W.DWORD
K.WaitForSingleObject.argtypes=[W.HANDLE,W.DWORD];K.WaitForSingleObject.restype=W.DWORD
K.GetProcessTimes.argtypes=[W.HANDLE,*([ctypes.POINTER(W.FILETIME)]*4)];K.GetProcessTimes.restype=W.BOOL
K.QueryFullProcessImageNameW.argtypes=[W.HANDLE,W.DWORD,W.LPWSTR,ctypes.POINTER(W.DWORD)];K.QueryFullProcessImageNameW.restype=W.BOOL
class Basic(ctypes.Structure):_fields_=[('reserved',ctypes.c_void_p),('peb',ctypes.c_void_p),('reserved2',ctypes.c_void_p*2),('pid',ctypes.c_size_t),('parent',ctypes.c_size_t)]
N.NtQueryInformationProcess.argtypes=[W.HANDLE,W.ULONG,ctypes.c_void_p,W.ULONG,ctypes.POINTER(W.ULONG)];N.NtQueryInformationProcess.restype=ctypes.c_long

def opened(pid):
 assert type(pid)is int and pid>0
 h=K.OpenProcess(0x1000|0x0400|0x100000,False,pid)
 if not h:raise OSError(ctypes.get_last_error(),'PROCESS_QUERY_REFUSED')
 return h

def facts(h):
 assert K.WaitForSingleObject(h,0)==258,'PROCESS_NOT_LIVE'
 times=[W.FILETIME()for _ in range(4)];assert K.GetProcessTimes(h,*[ctypes.byref(t)for t in times])
 size=W.DWORD(32768);text=ctypes.create_unicode_buffer(size.value);assert K.QueryFullProcessImageNameW(h,0,text,ctypes.byref(size))
 basic=Basic();returned=W.ULONG();assert N.NtQueryInformationProcess(h,0,ctypes.byref(basic),ctypes.sizeof(basic),ctypes.byref(returned))==0
 pid=K.GetProcessId(h);assert pid==basic.pid
 return{'pid':pid,'parentPid':basic.parent,'image':text.value,'birth100ns':str((times[0].dwHighDateTime<<32)|times[0].dwLowDateTime)}

def observe(pid):
 h=opened(pid)
 try:return facts(h)
 finally:assert K.CloseHandle(h)

K.CreateFileW.argtypes=[W.LPCWSTR,W.DWORD,W.DWORD,ctypes.c_void_p,W.DWORD,W.DWORD,W.HANDLE];K.CreateFileW.restype=W.HANDLE
INVALID=ctypes.c_void_p(-1).value

def lock_identity(file):
 p=pathlib.Path(file);s=p.lstat();assert p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode)and not p.is_symlink()and s.st_nlink==1 and s.st_size==0
 return{k:str(getattr(s,k))for k in ['st_dev','st_ino','st_size','st_mtime_ns']}

def assert_read_blocked(file):
 h=K.CreateFileW(str(file),0x80000000,7,None,3,0x00200000,None)
 if h!=INVALID:
  assert K.CloseHandle(h);raise AssertionError('ORIGINAL_LEASE_NOT_EXCLUSIVE')
 assert ctypes.get_last_error()==32,'ORIGINAL_LEASE_READ_STATE_UNKNOWN'

class ParentCustody:
 def __init__(self,expected):
  self.expected=expected;self.handles={};self.closed=False
  try:
   assert os.getppid()==expected['root']['pid'],'ORIGINAL_ROOT_PARENT_REQUIRED'
   for role in ['root','lease']:
    h=opened(expected[role]['pid']);self.handles[role]=h;assert facts(h)==expected[role],'PROCESS_IDENTITY_CHANGED'
   assert expected['lease']['parentPid']==expected['root']['pid'],'LEASE_PARENT_CHANGED'
   self.assert_current()
  except BaseException:self.close();raise
 def assert_current(self):
  assert not self.closed
  assert os.getppid()==self.expected['root']['pid'],'ORIGINAL_ROOT_PARENT_CHANGED'
  for role,h in self.handles.items():assert facts(h)==self.expected[role],'ORIGINAL_PROCESS_IDENTITY_LOST'
  assert lock_identity(self.expected['lockFile'])==self.expected['lockIdentity'],'ORIGINAL_LEASE_FILE_CHANGED'
  assert_read_blocked(self.expected['lockFile'])
 def close(self):
  if not self.closed:
   for h in self.handles.values():assert K.CloseHandle(h)
   self.closed=True

if __name__=='__main__':
 assert not sys.flags.optimize
 if len(sys.argv)==4 and sys.argv[1]=='--root-lease-facts':
  root,lease=map(int,sys.argv[2:]);assert os.getppid()==root
  root_fact,lease_fact=observe(root),observe(lease);assert lease_fact['parentPid']==root
  file=pathlib.Path('D:/sabalanerp-online-qa/deployment.lock');identity=lock_identity(file);assert_read_blocked(file)
  print(json.dumps(dict(format='sabalan-image-owner-parent-facts/v1',parent=dict(root=root_fact,lease=lease_fact,lockFile=str(file),lockIdentity=identity),signalsSent=0,leaseAcquired=False,nativeActionsExecuted=False)),flush=True)
 else:
  assert sys.argv[1]=='--facts'and 3<=len(sys.argv)<=5
  print(json.dumps({'format':'sabalan-image-owner-process-facts/v1','processes':[observe(int(pid))for pid in sys.argv[2:]],'signalsSent':0,'leaseAcquired':False,'nativeActionsExecuted':False}),flush=True)
