"""Fixed ordinary B guardian under the still-owned strict restore original.
No online scope, foreign process adoption, signal closure or shared lock edit.
"""
import hashlib,json,os,re,stat,sys,fcntl
from pathlib import Path

GUARDIAN_SHA='7812ebf703fd3c68f0fa7e3d595034a8b27166e16865718934d284ca626d8865'
def need(v):
 if not v:raise AssertionError('RESTORED_QA_HTTP_LAUNCHER_UNPROVEN')
def pin(s):return(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_uid,s.st_mode,s.st_nlink)
def read(file,expected,maximum):
 need(file.resolve(strict=True)==file);fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  before=os.fstat(fd);need(stat.S_ISREG(before.st_mode)and before.st_uid==0 and before.st_nlink==1 and not before.st_mode&0o022 and 0<before.st_size<=maximum)
  out=bytearray()
  while len(out)<before.st_size:
   b=os.read(fd,min(262144,before.st_size-len(out)));need(b);out.extend(b)
  need(not os.read(fd,1)and pin(before)==pin(os.fstat(fd))==pin(file.lstat())and hashlib.sha256(out).hexdigest()==expected);return bytes(out)
 finally:os.close(fd)
def birth(pid):
 fields=Path('/proc/'+str(pid)+'/stat').read_text().rsplit(') ',1)[1].split();return dict(pid=pid,startTicks=fields[19],group=fields[2])
def child_environment(parent,coordinate):
 env=dict(parent);keys=['BACKEND_NATIVE_POSTGRES_APPLICATION_NAME','BACKEND_NATIVE_AUTHORITY_FILE','BACKEND_NATIVE_CLAIM_SHA256']
 need(set(k for k in env if k.startswith('BACKEND_NATIVE_'))==set(keys))
 for key in keys:env.pop(key)
 env.update(BACKEND_CONTROL_LOCK_FD='9',BACKEND_CONTROL_LOCK_FILE=str(coordinate/'deployment-runtime-control.lock'),RECOVERY_COORDINATION_DIR=str(coordinate),BACKEND_RUNTIME_ROLE='standalone')
 return env
def main():
 need(sys.platform=='linux'and os.getuid()==0 and not sys.flags.optimize and len(sys.argv)==3)
 os.umask(0o077)
 file=Path(sys.argv[1]);digest=sys.argv[2];need(re.fullmatch('[a-f0-9]{64}',digest));raw=read(file,digest,16384);c=json.loads(raw)
 need(c['format']=='sabalan-restored-qa-http-original/v1'and c['root']==os.getcwd()and c['parent']['pid']==os.getppid()and birth(os.getppid())==c['parent'])
 need(os.environ.get('BACKEND_CONTROL_LOCK_FD')=='9'and os.environ.get('BACKEND_NATIVE_CLAIM_SHA256')==c['nativeClaimSha256']and os.environ.get('BACKEND_NATIVE_POSTGRES_APPLICATION_NAME')==c['namespace'])
 parent_authority=Path(c['root'])/'recovery-coordination/deployment-runtime-native.json';need(os.environ.get('BACKEND_NATIVE_AUTHORITY_FILE')==str(parent_authority));parent_claim=json.loads(read(parent_authority,c['nativeClaimSha256'],16384));need(parent_claim['phase']=='ACTIVE'and parent_claim['namespace']==c['namespace'])
 parent_lock=Path(os.environ['BACKEND_CONTROL_LOCK_FILE']);held=os.fstat(9);named=parent_lock.lstat()
 need(parent_lock==Path(c['root'])/'recovery-coordination/deployment-runtime-control.lock'and stat.S_ISREG(held.st_mode)and held.st_uid==0 and held.st_nlink==1 and(held.st_dev,held.st_ino)==(named.st_dev,named.st_ino))
 need(any(re.fullmatch(r'lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:'+str(held.st_ino)+r'\s+0\s+EOF\s*',line)for line in Path('/proc/self/fdinfo/9').read_text().splitlines()))
 need(not any(k.startswith(('BACKEND_ONLINE_','BACKEND_CAPTURE_','BACKEND_PROTECTED_FILE_'))for k in os.environ))
 role='old89dd'if c['graphKind']=='OLD_89DD'else'current';need(c['graphKind']in('OLD_89DD','CURRENT_INSTALLED'))
 coordinate=Path(c['root'])/'.restored-qa-runtimes'/role/'coord';need(str(coordinate)==c['cohortCoordination']and coordinate.resolve(strict=True)==coordinate)
 s=coordinate.lstat();need(stat.S_ISDIR(s.st_mode)and s.st_uid==0 and s.st_mode&0o777==0o700 and not list(coordinate.iterdir()))
 # No authority imported from the parent's claim. Only this child replaces
 # its own descriptor with the fresh canonical B-cohort kernel lock.
 lock=coordinate/'deployment-runtime-control.lock';fd=os.open(lock,os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 if fd!=9:os.dup2(fd,9,inheritable=True);os.close(fd)
 else:os.set_inheritable(9,True)
 os.fsync(9);directory=os.open(coordinate,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(directory)
 finally:os.close(directory)
 env=child_environment(os.environ,coordinate)
 guardian=Path('/app/scripts/backend-runtime-owner.py');read(guardian,GUARDIAN_SHA,131072)
 entry=Path(c['entry']);need(entry==Path('/app/dist/scripts/restored-qa-http-original.js'));read(entry,c['entrySha256'],1048576)
 need(read(file,digest,16384)==raw and birth(os.getppid())==c['parent'])
 os.execve('/usr/bin/python3',['/usr/bin/python3','-I','-B',str(guardian),'/usr/local/bin/node',str(entry),str(file),digest],env)
if __name__=='__main__':main()
