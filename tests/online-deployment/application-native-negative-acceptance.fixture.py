"""Fresh read-only exact empty acceptance-view proof; no namespace creation."""
import json,os,re,stat,sys
from pathlib import Path
def identity(st):return {k:str(getattr(st,k))for k in ['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns']}
def main():
 assert sys.platform=='linux'and os.getuid()==0 and not sys.flags.optimize
 spec=json.load(sys.stdin);assert set(spec)=={'nonce','expected'}and re.fullmatch('[a-f0-9]{32}',spec['nonce'])
 target=Path('/app/online-runtime-acceptance');assert target.resolve(strict=True)==target
 fd=os.open(target,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  before=os.fstat(fd);assert stat.S_ISDIR(before.st_mode)and before.st_uid==0 and stat.S_IMODE(before.st_mode)==0o700
  assert identity(before)==spec['expected']and os.listdir(fd)==[]
  assert identity(os.fstat(fd))==identity(target.lstat())==identity(before)
 finally:os.close(fd)
 print(json.dumps({'format':'sabalan-c16-empty-acceptance-namespace/v1','mode':'verify','nonce':spec['nonce'],'namespace':identity(before),'empty':True,'exclusivelyCreated':False,'productionAdmission':False}),flush=True)
if __name__=='__main__':main()
