"""Readonly current namespace proof, using the complete canonical two-capsule preflight."""
import base64,contextlib,hashlib,io,json,os,stat,sys
from pathlib import Path

NAMES=['application-prisma-ebcfd40fff0a28e39d983c6616893b50','inquiry-coherent-7878c93646acd9ac37cef95e27a4029d']
SUBPATH='c16-recovery-70360dba0eb244dc91cdfcd0533315f9/c16-recovery-32c29444431a4f98bc6070f4182e7bb8'
ROOT=Path('/app/online-runtime-acceptance')
def identity(s):return {k:str(getattr(s,k))for k in ['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns']}
def view(expected):
 assert ROOT.resolve(strict=True)==ROOT
 fd=os.open(ROOT,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  s=os.fstat(fd);assert stat.S_ISDIR(s.st_mode)and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o700
  assert identity(s)==expected and sorted(os.listdir(fd))==NAMES
  directories={}
  for name in NAMES:
   p=ROOT/name;c=p.lstat();assert p.resolve(strict=True)==p and stat.S_ISDIR(c.st_mode)and not p.is_symlink()
   directories[str(p)]=[str(c.st_dev),str(c.st_ino),c.st_size,c.st_mtime_ns,c.st_ctime_ns,c.st_mode,c.st_uid,c.st_nlink]
  mounts=[]
  for line in Path('/proc/self/mountinfo').read_text().splitlines():
   row=line.split()
   if row[4]==str(ROOT)or row[4].startswith(str(ROOT)+'/'):mounts.append(row)
  assert len(mounts)==3
  root=next(v for v in mounts if v[4]==str(ROOT));assert root[3].endswith('/sabalanerp-local_online_runtime_acceptance/_data/'+SUBPATH)and root[5].split(',')[0]=='rw'
  for name in NAMES:
   m=next(v for v in mounts if v[4]==str(ROOT/name));assert m[3].endswith('/sabalanerp-local_online_runtime_acceptance/_data/'+name)and m[5].split(',')[0]=='ro'and m[1]==root[0]
  assert identity(os.fstat(fd))==identity(ROOT.lstat())==expected
  return directories,mounts
 finally:os.close(fd)
def main():
 assert sys.platform=='linux'and os.getuid()==0 and not sys.flags.optimize
 spec=json.load(sys.stdin);assert set(spec)=={'nonce','subpath','expected','capsuleSource','capsuleSpec'}
 assert spec['nonce']=='32c29444431a4f98bc6070f4182e7bb8'and spec['subpath']==SUBPATH
 before=view(spec['expected']);source=base64.b64decode(spec['capsuleSource'],validate=True)
 assert hashlib.sha256(source).hexdigest()=='a4f20672aec779899b037d775ade51cb84f24ade8f3cbcef5c8d3219f9513b65'
 assert hashlib.sha256(json.dumps(spec['capsuleSpec'],separators=(',',':'),ensure_ascii=False).encode()).hexdigest()=='604472f73c22e1be20a8d63672be5dcafb2b4044d9858a6224df81339f835472'
 original=sys.stdin;output=io.StringIO()
 try:
  sys.stdin=io.TextIOWrapper(io.BytesIO(json.dumps(spec['capsuleSpec']).encode()))
  with contextlib.redirect_stdout(output):exec(compile(source,'canonical-two-capsule-preflight','exec'),{'__name__':'__main__'})
 finally:sys.stdin=original
 assert len(output.getvalue().encode())<=65536
 full=json.loads(output.getvalue());assert full['directoryIdentities']==before[0]and view(spec['expected'])==before
 assert full['readOnly']is True and full['capsulesVerified']==2 and full['databaseExecuted']is False and full['nativeActorStarted']is False and full['productionAdmission']is False and len(full['lockIdentities'])==3
 child=full['inventoryChild'];assert type(child['originalPid'])is int and child['originalPid']>0 and type(child['code'])is int and child['code']==0 and child['stdoutEof']is True and child['stderrEof']is True
 print(json.dumps({'format':'sabalan-C29-current-two-readonly-capsule-acceptance/v1','mode':'verify','nonce':spec['nonce'],'namespace':spec['expected'],'physicalEmpty':False,'actorEntries':[],'readOnlyCapsules':NAMES,'canonicalCapsules':full,'qualificationSucceeded':False,'productionAdmission':False}),flush=True)
if __name__=='__main__':main()
