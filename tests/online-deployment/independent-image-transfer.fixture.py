"""Bounded binary frames on the SAME original authenticated SSH channel.
No reconnect, SCP, shell, crypto format, app start, or completion-token issuer.
"""
import hashlib,json,os,re,stat
from pathlib import Path
ROLES=('backend','inquiry','frontend');CHUNK=1024**2

def require(value,code):
 if not value:raise RuntimeError(code)
def frame(value):return (json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def request(operation,role,sequence,path,count,checksum):
 require(re.fullmatch('[a-f0-9]{32}',operation) is not None,'TRANSFER_OPERATION')
 require(type(sequence) is int and 0<=sequence<len(ROLES) and role in ROLES and ROLES[sequence]==role,'TRANSFER_ROLE_ORDER')
 require(type(count) is int and 0<count<=2**31 and len(checksum)==64 and all(c in '0123456789abcdef' for c in checksum),'TRANSFER_BOUNDS')
 return dict(event='IMAGE_TRANSFER_REQUEST',format='sabalan-original-image-transfer/v1',operation=operation,role=role,sequence=sequence,path=path,bytes=count,sha256=checksum)
def copy_exact(source,sink,count):
 h=hashlib.sha256();remaining=count
 while remaining:
  raw=source.read(min(CHUNK,remaining));require(raw and len(raw)<=remaining,'TRANSFER_TRUNCATED')
  require(sink.write(raw)==len(raw),'TRANSFER_SHORT_WRITE');h.update(raw);remaining-=len(raw)
 return h.hexdigest()
def identity(value,named=False):
 # Windows named paths report dev0, while the opened FD has the volume serial.
 keys=['st_ino','st_size','st_mtime_ns','st_ctime_ns','st_mode','st_nlink']
 if os.name!='nt':keys.insert(0,'st_dev')
 return tuple(getattr(value,key) for key in keys)
def cross_identity(value):
 keys=['st_ino','st_size','st_mtime_ns','st_mode','st_nlink']
 if os.name=='nt':keys.append('st_birthtime_ns')
 else:keys.insert(0,'st_dev')
 return tuple(getattr(value,key) for key in keys)
def verify_source(file,expected):
 file=Path(file);require(file.resolve(strict=True)==file and file.is_file(),'TRANSFER_SOURCE_ALIAS')
 fd=os.open(file,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0)|getattr(os,'O_BINARY',0))
 try:
  before=os.fstat(fd);named=file.lstat();require(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and before.st_size==expected['bytes'],'TRANSFER_SOURCE_IDENTITY')
  # Windows 3.14 fstat ctime is change-time; lstat ctime still reports birth.
  # Compare the stable cross-fields once, then EACH full clock independently.
  require(cross_identity(before)==cross_identity(named),'TRANSFER_NAMED_IDENTITY')
  h=hashlib.sha256()
  with os.fdopen(os.dup(fd),'rb') as inp:
   for raw in iter(lambda:inp.read(CHUNK),b''):h.update(raw)
  require(h.hexdigest()==expected['sha256'] and identity(before)==identity(os.fstat(fd)) and identity(named)==identity(file.lstat()),'TRANSFER_SOURCE_HASH')
  os.lseek(fd,0,0);return {'fd':fd,'file':file,'identity':identity(before),'namedIdentity':identity(named),'expected':expected}
 except BaseException:os.close(fd);raise
def assert_source_current(source):
 require(identity(os.fstat(source['fd']))==source['identity'] and source['namedIdentity']==identity(source['file'].lstat()),'TRANSFER_SOURCE_CHANGED')
def send_owned(source,sink,wanted):
 require(wanted['bytes']==source['expected']['bytes'] and wanted['sha256']==source['expected']['sha256'],'TRANSFER_REQUEST_SOURCE')
 require(identity(os.fstat(source['fd']))==source['identity'] and source['namedIdentity']==identity(source['file'].lstat()),'TRANSFER_SOURCE_CHANGED')
 begin=frame(dict(event='IMAGE_TRANSFER_BEGIN',requestSha256=hashlib.sha256(frame(wanted)).hexdigest()));require(sink.write(begin)==len(begin),'TRANSFER_SHORT_WRITE')
 os.lseek(source['fd'],0,0)
 with os.fdopen(os.dup(source['fd']),'rb') as inp:checksum=copy_exact(inp,sink,wanted['bytes'])
 sink.flush()
 require(checksum==wanted['sha256'] and identity(os.fstat(source['fd']))==source['identity'] and source['namedIdentity']==identity(source['file'].lstat()),'TRANSFER_STREAM_CHANGED')
 return dict(role=wanted['role'],bytes=wanted['bytes'],sha256=checksum,requestSha256=hashlib.sha256(frame(wanted)).hexdigest(),originalSourceFdRetained=True)
def read_begin(source,wanted):
 header=source.readline(8193);require(header.endswith(b'\n') and len(header)<=8192,'TRANSFER_BEGIN_BOUND')
 require(json.loads(header)==dict(event='IMAGE_TRANSFER_BEGIN',requestSha256=hashlib.sha256(frame(wanted)).hexdigest()),'TRANSFER_BEGIN_BINDING')
def receive_owned(source,target,wanted):
 require(os.name=='posix' and os.getuid()==0,'TRANSFER_RECEIVER_HOST')
 read_begin(source,wanted)
 target=Path(target);parent=target.parent;require(parent.resolve(strict=True)==parent and parent.is_dir() and not target.exists(),'TRANSFER_TARGET_ALIAS')
 ps=parent.lstat();require(ps.st_uid==0 and ps.st_mode&0o777==0o700,'TRANSFER_PARENT_MODE')
 with target.open('x+b') as out:
  os.fchmod(out.fileno(),0o400);checksum=copy_exact(source,out,wanted['bytes']);out.flush();os.fsync(out.fileno())
  require(checksum==wanted['sha256'],'TRANSFER_CIPHER_HASH');out.seek(0);h=hashlib.sha256()
  for raw in iter(lambda:out.read(CHUNK),b''):h.update(raw)
  current=os.fstat(out.fileno());require(h.hexdigest()==checksum and current.st_nlink==1 and current.st_size==wanted['bytes'] and identity(current)==identity(target.lstat()),'TRANSFER_DURABLE_READBACK')
 fd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
 return dict(role=wanted['role'],path=str(target),bytes=wanted['bytes'],sha256=checksum,fsyncFileAndDirectory=True,fullReadbackVerified=True)
