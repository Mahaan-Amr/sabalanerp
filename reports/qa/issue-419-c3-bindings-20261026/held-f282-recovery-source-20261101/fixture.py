"""Owned Windows processes only. Private files replace all application resources."""
import ctypes as C,json,os,subprocess,sys,threading,time
from pathlib import Path
from ctypes import wintypes as W

directory=Path(sys.argv[2]);mode=sys.argv[1]
def save(name,value):
    file=directory/name
    with file.open('x',encoding='utf8')as f:json.dump(value,f);f.flush();os.fsync(f.fileno())

if mode=='lease':
    k=C.WinDLL('kernel32',use_last_error=True);k.CreateFileW.argtypes=[W.LPCWSTR,W.DWORD,W.DWORD,C.c_void_p,W.DWORD,W.DWORD,W.HANDLE];k.CreateFileW.restype=W.HANDLE;k.CloseHandle.argtypes=[W.HANDLE];k.CloseHandle.restype=W.BOOL
    h=k.CreateFileW(str(directory/'lock'),0xc0000000,0,None,4,0x80,None);assert h not in(None,C.c_void_p(-1).value)
    save('lease-ready.json',{'pid':os.getpid()})
    while not(directory/'cleanup').exists()and not(directory/'fixture-lease-close').exists():time.sleep(.02)
    assert k.CloseHandle(h)
elif mode=='extra':
    save('extra-ready.json',{'pid':os.getpid()})
    while not(directory/'cleanup').exists():time.sleep(.02)
elif mode=='root':
    inherit=(directory/'retain-pipe').exists()
    lease=subprocess.Popen([sys.executable,'-I','-B',__file__,'lease',str(directory)],stdin=subprocess.PIPE,stdout=None if inherit else subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
    extra=None
    if(directory/'extra-child').exists():extra=subprocess.Popen([sys.executable,'-I','-B',__file__,'extra',str(directory)],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
    save('root-ready.json',{'pid':os.getpid(),'lease':lease.pid,'extra':extra.pid if extra else None})
    print('owned fixture root',flush=True)
    while not(directory/'cleanup').exists():time.sleep(.02)
    assert lease.wait()==0
    if extra:assert extra.wait()==0
elif mode=='supervisor':
    root_command=['C:/Program Files/nodejs/node.exe',str(Path(__file__).parent/'fixture-native-root.mjs'),str(directory)]if(directory/'native-root').exists()else[sys.executable,'-I','-B',__file__,'root',str(directory)]
    root=subprocess.Popen(root_command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW)
    states={};faults=[]
    def drain(name):
        pipe=getattr(root,name);fd=os.open(directory/(name+'.log'),os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_BINARY,0o600);count=0
        while True:
            raw=pipe.read(4096)
            if not raw:break
            count+=len(raw);view=memoryview(raw)
            while view:view=view[os.write(fd,view):]
        pipe.close();os.fsync(fd);os.close(fd)
        states[name]={'closed':True,'pipeClosed':True,'logSynced':True,'logClosed':True,'truncated':False,'bytesSeen':count,'bytesRetained':count}
    readers=[threading.Thread(target=drain,args=(name,),daemon=False)for name in ('stdout','stderr')]
    for t in readers:t.start()
    save('supervisor-ready.json',{'pid':os.getpid(),'root':root.pid,'readerNativeIds':[t.native_id for t in readers]})
    late=None
    def late_work():
        while not(directory/'cleanup').exists():time.sleep(.02)
    while root.poll()is None:
        if(directory/'start-extra-thread').exists()and late is None:
            late=threading.Thread(target=late_work);late.start();save('extra-thread-ready.json',{'tid':late.native_id})
        time.sleep(.02)
    code=root.wait()
    for t in readers:t.join()
    if late:late.join()
    if(directory/'bad-reader-receipt').exists():states['stdout']['pipeClosed']=False
    if(directory/'change-resource-after-root').exists():(directory/'resource').write_bytes(b'changed by owned fixture\n')
    save('original-closed.json',{'originalPid':root.pid,'code':code,'pipesClosed':True,'readerErrors':faults,'supervisorHeld':False,'commandsSent':0,'logs':states})
    root.stdin.close();raise SystemExit(code)
else:raise AssertionError('UNKNOWN_FIXTURE_MODE')
