"""Own-volume namespace preparation for the existing canonical QA slots only."""
import json,os,re,stat,sys
from pathlib import Path

ROOTS={'runtime':('/app/qualification-authority-root','/app/runtime-authority'),'jobs':('/app/qualification-jobs-root','/app/jobs-authority')}

def nonce_path(nonce):
 assert isinstance(nonce,str)and re.fullmatch('[a-f0-9]{32}',nonce),'AUTHORITY_COHORT_NONCE_INVALID'
 return 'cohort-'+nonce

def identity(value):
 return {k:getattr(value,k)for k in ['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns']}

def secure_directory(value):
 assert stat.S_ISDIR(value.st_mode)and value.st_uid==0 and stat.S_IMODE(value.st_mode)==0o700,'AUTHORITY_DIRECTORY_OWNER_OR_MODE_UNSAFE'

def secure_root_directory(value):
 assert stat.S_ISDIR(value.st_mode)and value.st_uid==0 and not value.st_mode&0o022,'AUTHORITY_ROOT_OWNER_OR_MODE_UNSAFE'

def mount_mode(path):
 raw=Path('/proc/self/mountinfo').read_bytes();assert len(raw)<=1024*1024
 rows=[line.split()for line in raw.decode().splitlines()if line.split()[4]==str(path)];assert len(rows)==1
 assert 'rw'in rows[0][5].split(',')and not os.statvfs(path).f_flag&os.ST_RDONLY,'AUTHORITY_PRODUCER_MOUNT_NOT_WRITABLE'

def create_namespace(root,nonce):
 leaf=nonce_path(nonce);assert root.resolve(strict=True)==root;before=root.lstat();secure_root_directory(before);mount_mode(root)
 parent=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  assert identity(os.fstat(parent))==identity(before)
  # mkdir is exclusive even for an existing empty directory, symlink or a
  # foreign owner. Never adopt or erase a previous namespace.
  os.mkdir(leaf,0o700,dir_fd=parent)
  child=os.open(leaf,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent)
  try:
   result=os.fstat(child);secure_directory(result);assert os.listdir(child)==[]
   assert identity(result)==identity(os.stat(leaf,dir_fd=parent,follow_symlinks=False));os.fsync(child);os.fsync(parent)
   return identity(result)
  finally:os.close(child)
 finally:os.close(parent)

def verify_namespace(root,nonce,expected,target):
 leaf=nonce_path(nonce);assert root.resolve(strict=True)==root and target.resolve(strict=True)==target;mount_mode(root)
 parent=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  secure_root_directory(os.fstat(parent));child=os.open(leaf,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent)
  mounted=os.open(target,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
  try:
   a,b=os.fstat(child),os.fstat(mounted);secure_directory(a);secure_directory(b)
   assert identity(a)==identity(b)==expected and os.listdir(child)==os.listdir(mounted)==[],'FRESH_AUTHORITY_NAMESPACE_CHANGED'
   return identity(a)
  finally:os.close(mounted);os.close(child)
 finally:os.close(parent)

def main():
 assert sys.platform=='linux'and os.getuid()==0 and not sys.flags.optimize
 spec=json.load(sys.stdin);assert set(spec)=={'mode','kind','nonce','root','expected','peerExpected'}and spec['kind']in ROOTS
 roots=ROOTS[spec['kind']];assert spec['root']in roots;root=Path(spec['root']);mode=spec['mode']
 peer=None
 if mode=='create':assert spec['expected']is None and spec['peerExpected']is None;result=create_namespace(root,spec['nonce'])
 else:
  assert mode=='verify'and spec['root']==roots[0];result=verify_namespace(root,spec['nonce'],spec['expected'],Path(roots[1]))
  target=Path('/run/sabalan-online');assert target.resolve(strict=True)==target and os.statvfs(target).f_flag&os.ST_RDONLY,'PEER_AUTHORITY_NOT_READONLY'
  fd=os.open(target,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
  try:
   value=os.fstat(fd);secure_directory(value);assert identity(value)==spec['peerExpected']and os.listdir(fd)==[];peer=identity(value)
  finally:os.close(fd)
 print(json.dumps({'format':'sabalan-authority-cohort-directory/v1','mode':mode,'nonce':spec['nonce'],'kind':spec['kind'],'namespace':result,'consumerNamespace':peer,'exclusivelyCreated':mode=='create','empty':True,'productionAdmission':False}),flush=True)
if __name__=='__main__':main()
