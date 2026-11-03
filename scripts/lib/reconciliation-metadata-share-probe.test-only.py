"""SOURCE ONLY. Probe only a new private test-owned file; never a live path."""
import os,ctypes as C,tempfile,uuid,json,hashlib,importlib.util
from ctypes import wintypes as W
from pathlib import Path
if os.name!='nt' or not __debug__:raise RuntimeError('WINDOWS_UNOPTIMIZED_ONLY')
base=Path(r'C:\Users\mahan\AppData\Local\Temp\sabalan-419-held-window-20261102')
helper=base/'finite-bridge-windows-v11-UNEXECUTED.py';expected='8250681666ea5f5ac6859fb8967d26c1c7720b32821c6c52ec12c964182a88e6'
if hashlib.sha256(helper.read_bytes()).hexdigest()!=expected:raise RuntimeError('HELPER_SNAPSHOT_MISMATCH')
spec=importlib.util.spec_from_file_location('fixture_support',helper);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
k=C.WinDLL('kernel32',use_last_error=True)
k.CreateFileW.argtypes=[W.LPCWSTR,W.DWORD,W.DWORD,C.c_void_p,W.DWORD,W.DWORD,W.HANDLE];k.CreateFileW.restype=W.HANDLE
k.CloseHandle.argtypes=[W.HANDLE];k.CloseHandle.restype=W.BOOL
class FILE_ID_128(C.Structure):_fields_=[('identifier',C.c_ubyte*16)]
class FILE_ID_INFO(C.Structure):_fields_=[('volume',C.c_ulonglong),('fileid',FILE_ID_128)]
k.GetFileInformationByHandleEx.argtypes=[W.HANDLE,C.c_int,C.c_void_p,W.DWORD];k.GetFileInformationByHandleEx.restype=W.BOOL
INVALID=C.c_void_p(-1).value

def get(path,access,share,flags):
 h=k.CreateFileW(str(path),access,share,None,3,flags,None)
 if h==INVALID:raise OSError(C.get_last_error(),'CREATEFILE')
 return h

def identity(h):
 info=FILE_ID_INFO()
 if not k.GetFileInformationByHandleEx(h,18,C.byref(info),C.sizeof(info)):raise OSError(C.get_last_error(),'FILEID')
 return (str(info.volume),bytes(info.fileid.identifier).hex())

def main():
 tmp=Path(tempfile.gettempdir()).absolute()
 if str(tmp).lower()!=r'c:\users\mahan\appdata\local\temp':raise RuntimeError('TEMP_PARENT_MISMATCH')
 m.no_reparse(tmp);m.no_reparse(helper)
 root=tmp/('sabalan-meta-share-probe-'+uuid.uuid4().hex);m.create_private(root);rootid=m.root_identity(root)
 def checked():
  if root.parent!=tmp or m.root_identity(root)!=rootid:raise RuntimeError('ROOT_IDENTITY_CHANGED')
 checked();leaf=root/'test-only.lock';m.write_bytes(leaf,b'test-owned only\n');checked();m.no_reparse(leaf)
 meta=exclusive=None;result={'root':str(root),'status':'UNKNOWN','testOwned':True,'liveLeaseTouched':False,'rootAcl':'PROTECTED_OWNER_SYSTEM_NOT_INDEPENDENTLY_VERIFIED','directoryDurability':'UNKNOWN','pathRace':'UNPROVEN'}
 try:
  meta=get(leaf,0,3,0x00200000);result['metadataId']=identity(meta)
  checked();exclusive=get(leaf,0xC0000000,0,0x00200000);result['exclusiveId']=identity(exclusive)
  result['sameIdentity']=result['metadataId']==result['exclusiveId']
  result['status']='OBSERVED_MATCH' if result['sameIdentity'] else 'UNKNOWN'
 except BaseException as e:result['failure']=type(e).__name__+': '+str(e)
 finally:
  for label,h in [('exclusive',exclusive),('metadata',meta)]:
   try:result[label+'Close']='NOT_OPENED' if h is None else ('CLOSED' if k.CloseHandle(h) else 'UNKNOWN')
   except BaseException:result[label+'Close']='UNKNOWN'
   if result[label+'Close']=='UNKNOWN':result['status']='UNKNOWN'
 try:
  checked();m.write_bytes(root/'receipt.json',json.dumps(result,sort_keys=True).encode())
 except BaseException:result['status']='UNKNOWN';result['receipt']='UNAVAILABLE'
 print(json.dumps(result,sort_keys=True),flush=True)
if __name__=='__main__':main()
