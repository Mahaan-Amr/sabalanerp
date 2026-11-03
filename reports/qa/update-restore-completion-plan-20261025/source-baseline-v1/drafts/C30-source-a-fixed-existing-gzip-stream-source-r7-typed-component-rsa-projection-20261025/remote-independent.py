"""Functions combined only with exact existing backup host/native guards."""
def sync(p):
 fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def stage():
 need(sys.platform=='linux'and os.getuid()==0 and not sys.flags.optimize);os.umask(0o077)
 before=host();native=node();parent=private_directory(PARENT);need(not os.path.lexists(ROOT));space=os.statvfs(PARENT);block=space.f_frsize
 payloads={**FILES,'runtime.py':RUNTIME};allocated=sum(((len(raw)+block-1)//block)*block for raw in payloads.values())+2*block;need(sum(map(len,payloads.values()))<=262144 and space.f_bavail*block>=512*1024**2+allocated)
 ROOT.mkdir(mode=0o700);pins={}
 for name,raw in payloads.items():
  fd=os.open(ROOT/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
  try:
   offset=0
   while offset<len(raw):count=os.write(fd,raw[offset:]);need(count>0);offset+=count
   os.fsync(fd)
  finally:os.close(fd)
  need((ROOT/name).read_bytes()==raw);pins[name]={'file':str(ROOT/name),'bytes':len(raw),'sha256':sha(raw)}
 sync(ROOT);sync(PARENT);need(host()==before and node()==native and private_directory(PARENT)==parent);after=os.statvfs(PARENT);need(after.f_bavail*after.f_frsize>=512*1024**2)
 print(json.dumps({'format':'sabalan-source-a-independent-image-source-stage/v1','operation':OPERATION,'files':pins,'host':before,'nodeSha256':NODE_SHA,'sourceWorkspaceAllocationEstimateBytes':allocated,'floorBytes':512*1024**2,'privateKeyRead':False,'cipherStored':False,'productionAdmission':False}),flush=True);return 0
class Host:
 def __init__(self):self.children=[];self.interrupted=False;self.before=host();self.native=node();self.parent=private_directory(PARENT);self.root=private_directory(ROOT)
 def lock_guard(self):need(host()==self.before and node()==self.native and private_directory(PARENT)==self.parent and private_directory(ROOT)==self.root)
def verify():
 need(sys.platform=='linux'and os.getuid()==0 and not sys.flags.optimize);os.umask(0o077)
 h=Host();handlers={}
 def cancel(_sig,_frame):h.interrupted=True
 try:
  import signal
  for sig in [signal.SIGINT,signal.SIGTERM]:handlers[sig]=signal.signal(sig,cancel)
  for name,raw in FILES.items():
   file=ROOT/name;s=file.lstat();need(file.resolve(strict=True)==file and stat.S_ISREG(s.st_mode)and s.st_uid==0 and s.st_nlink==1 and s.st_mode==0o100400 and s.st_size==len(raw));fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW)
   try:need(identity(os.fstat(fd))==identity(s)and os.read(fd,len(raw)+1)==raw and identity(os.fstat(fd))==identity(file.lstat())==identity(s))
   finally:os.close(fd)
  module={};exec(compile(COLLECTOR,'owned-independent-binary-original','exec'),module);row,err=module['collect'](h,[str(NODE),str(ROOT/'verify.cjs')],sys.stdout.buffer,2*1024**2,stdin=sys.stdin.buffer);need(not err and not h.interrupted)
  h.lock_guard();print(json.dumps({'format':'sabalan-source-a-independent-image-original-closed/v1','operation':OPERATION,'children':h.children,'allOriginalChildrenClosed':True,'productionAdmission':False,'FD9Acquired':False,'privateRsaExported':False,'cipherStored':False,'plaintextStored':False}),file=sys.stderr,flush=True);return 0
 except BaseException as error:
  print(json.dumps({'format':'sabalan-source-a-independent-image-original-negative/v1','failureType':type(error).__name__,'children':h.children,'productionAdmission':False}),file=sys.stderr,flush=True);return 1
 finally:
  for sig,handler in handlers.items():signal.signal(sig,handler)
