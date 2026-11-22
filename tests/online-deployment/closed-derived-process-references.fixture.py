import ctypes, json, os
from pathlib import Path
import subprocess, sys, tempfile

namespace={}
exec(compile(MODULE_SOURCE,'closed-derived-process-references.py','exec'),namespace)
census=namespace['assert_no_process_references']
with tempfile.TemporaryDirectory(prefix='sabalan-closed-reference-') as directory:
    root=Path(directory);file=root/'private-copy';file.write_bytes(b'x'*4096)
    identities={(p.stat().st_dev,p.stat().st_ino) for p in [root,file]}
    census(identities)
    for kind,code in [
        ('fd',"import sys; f=open(sys.argv[1],'rb'); print('READY',flush=True); sys.stdin.buffer.read(1); f.close()"),
        ('maps',"import ctypes,os,sys; libc=ctypes.CDLL(None); libc.mmap.restype=ctypes.c_void_p; fd=os.open(sys.argv[1],os.O_RDONLY); p=libc.mmap(None,4096,1,2,fd,0); assert p not in [None,ctypes.c_void_p(-1).value]; os.close(fd); print('READY',flush=True); sys.stdin.buffer.read(1); libc.munmap(ctypes.c_void_p(p),4096)"),
        ('cwd',"import os,sys; os.chdir(os.path.dirname(sys.argv[1])); print('READY',flush=True); sys.stdin.buffer.read(1)"),
        ('root',"import os,sys; os.chroot(os.path.dirname(sys.argv[1])); print('READY',flush=True); sys.stdin.buffer.read(1)")]:
        child=subprocess.Popen([sys.executable,'-I','-B','-c',code,str(file)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        try:
            assert child.stdout.readline()==b'READY\n'
            try: census(identities)
            except RuntimeError as error:
                assert 'CLOSED_DERIVED_REFERENCED:'+kind+':' in str(error),str(error)
            else:
                details={'identities':list(identities),'maps':[line for line in Path('/proc/'+str(child.pid)+'/maps').read_text().splitlines() if 'private-copy' in line]} if kind=='maps' else {}
                raise AssertionError('ACTIVE_'+kind.upper()+'_REFERENCE_WAS_NOT_REFUSED:'+json.dumps(details))
        finally:
            child.stdin.close();status=child.wait(timeout=10)
            assert status==0,child.stderr.read().decode()
        census(identities)
    permission_code='''import json,os,sys
os.setgid(65534);os.setuid(65534)
scope={};exec(compile(sys.stdin.buffer.read(),'references','exec'),scope)
try:scope['assert_no_process_references']({tuple(x) for x in json.loads(sys.argv[1])})
except RuntimeError as error:
 assert str(error)=='CLOSED_DERIVED_PROCESS_CENSUS_UNPROVEN',str(error)
else:raise AssertionError('UNREADABLE_PROCESS_STATE_WAS_NOT_REFUSED')
'''
    denied=subprocess.run([sys.executable,'-I','-B','-c',permission_code,json.dumps(list(identities))],input=MODULE_SOURCE,capture_output=True)
    assert denied.returncode==0,denied.stderr.decode()
    print(json.dumps({'closedDerivedReferenceAcceptance':True,'openFdRefused':True,'mmapOnlyRefused':True,'cwdRefused':True,'rootRefused':True,'permissionDenialRefused':True}))
