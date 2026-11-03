"""Native source-copy guard for review; no CLI and no live operation.

This module is not an authority source. Its caller must be the reviewed fixed
launcher, hold the returned objects through child exit/EOF and handle UNKNOWN.
"""
import ctypes as C
from ctypes import wintypes as W
from pathlib import Path
import hashlib
import os

if os.name!='nt':raise RuntimeError('WINDOWS_ONLY')
K=C.WinDLL('kernel32',use_last_error=True)
K.CreateFileW.argtypes=[W.LPCWSTR,W.DWORD,W.DWORD,C.c_void_p,W.DWORD,W.DWORD,W.HANDLE];K.CreateFileW.restype=W.HANDLE
K.CloseHandle.argtypes=[W.HANDLE];K.CloseHandle.restype=W.BOOL
class Id(C.Structure):_fields_=[('volume',C.c_ulonglong),('fileId',C.c_ubyte*16)]
class Tag(C.Structure):_fields_=[('attributes',W.DWORD),('tag',W.DWORD)]
K.GetFileInformationByHandleEx.argtypes=[W.HANDLE,C.c_int,C.c_void_p,W.DWORD];K.GetFileInformationByHandleEx.restype=W.BOOL
INVALID=C.c_void_p(-1).value

def handle_identity(handle):
    identity=Id();tag=Tag()
    if not K.GetFileInformationByHandleEx(handle,18,C.byref(identity),C.sizeof(identity)):raise OSError(C.get_last_error(),'FILE_ID')
    if not K.GetFileInformationByHandleEx(handle,9,C.byref(tag),C.sizeof(tag)):raise OSError(C.get_last_error(),'FILE_TAG')
    if tag.attributes&0x400:raise RuntimeError('REPARSE_POINT')
    return str(identity.volume)+':'+bytes(identity.fileId).hex()

class GuardedOutputDirectory:
    """Retain one no-reparse output directory metadata handle.

    File creation is intentionally allowed; rename/delete denial and crash
    durability require independent verification on the selected filesystem.
    """
    def __init__(self,root):
        self.handle=K.CreateFileW(str(root),0,3,None,3,0x02200000,None)
        if self.handle==INVALID:raise OSError(C.get_last_error(),'OUTPUT_GUARD_OPEN')
        try:self.identity=handle_identity(self.handle)
        except BaseException:
            if not K.CloseHandle(self.handle):raise RuntimeError('OUTPUT_GUARD_CLOSE_UNKNOWN')
            raise
    def close(self):
        if self.handle is not None:
            h=self.handle;self.handle=None
            if not K.CloseHandle(h):raise RuntimeError('OUTPUT_GUARD_CLOSE_UNKNOWN')

class GuardedSourceCopies:
    """Hold test/review-scoped file and directory handles until explicit close.

    Never claim protection before all opens, same-path checks and hashes pass;
    source path snapshots and ancestor race remain independently reviewable.
    """
    def __init__(self,root,pins):
        self.root=Path(root).absolute();self.handles=[];self.identities=[];self.closed=False
        files=[];dirs={self.root}
        for name,want in pins.items():
            if not isinstance(name,str) or not isinstance(want,str) or len(want)!=64 or any(c not in '0123456789abcdef' for c in want):raise RuntimeError('PIN_INVALID')
            parts=Path(name)
            if parts.is_absolute() or '..' in parts.parts:raise RuntimeError('RELATIVE_SOURCE_REQUIRED')
            item=self.root/parts;files.append((name,item,want));parent=item.parent
            while parent!=self.root:
                if self.root not in parent.parents:raise RuntimeError('SOURCE_ESCAPE')
                dirs.add(parent);parent=parent.parent
        try:
            for item,isdir in [(d,True) for d in sorted(dirs,key=lambda p:(len(p.parts),str(p)))]+[(f,False) for _,f,_ in files]:
                flags=0x00200000|(0x02000000 if isdir else 0);access=0 if isdir else 0x80000000
                h=K.CreateFileW(str(item),access,1,None,3,flags,None)
                if h==INVALID:raise OSError(C.get_last_error(),'GUARD_OPEN')
                self.handles.append(h);first=handle_identity(h)
                check=K.CreateFileW(str(item),0,7,None,3,flags,None)
                if check==INVALID:raise OSError(C.get_last_error(),'PATH_RECHECK_OPEN')
                try:second=handle_identity(check)
                finally:
                    if not K.CloseHandle(check):raise OSError(C.get_last_error(),'PATH_RECHECK_CLOSE')
                if first!=second:raise RuntimeError('PATH_IDENTITY_CHANGED')
                self.identities.append((str(item.relative_to(self.root)),first))
            for _,file,want in files:
                if hashlib.sha256(file.read_bytes()).hexdigest()!=want:raise RuntimeError('GUARDED_BYTES_MISMATCH')
        except BaseException:
            self.close();raise

    def close(self):
        if self.closed:return
        unknown=False
        for h in reversed(self.handles):
            if not K.CloseHandle(h):unknown=True
        self.closed=True
        if unknown:raise RuntimeError('GUARD_CLOSE_UNKNOWN')
