"""Finite read-only installed tools/namespace observation. No app/SQL startup."""
import hashlib,json,os,pathlib,re,signal,stat,subprocess

def probe():
 assert os.getuid()==0;cancelled=[]
 for sig in[signal.SIGINT,signal.SIGTERM]:signal.signal(sig,lambda n,f:cancelled.append(n))
 root=pathlib.Path('/app/runtime-authority');s=root.lstat();assert root.resolve(strict=True)==root and stat.S_ISDIR(s.st_mode)and s.st_uid==0 and not s.st_mode&0o077
 namespace={k:str(getattr(s,k))for k in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns']}
 versions=[p for p in pathlib.Path('/usr/lib/postgresql').iterdir()if re.fullmatch('[0-9]+',p.name)and(p/'bin/psql').is_file()and(p/'bin/pg_restore').is_file()];assert len(versions)==1
 names={'python':'/usr/bin/python3.11','node':'/usr/local/bin/node','psql':str(versions[0]/'bin/psql'),'pgRestore':str(versions[0]/'bin/pg_restore')};binaries={};originals=[]
 for name,file in names.items():
  p=pathlib.Path(file);assert p.resolve(strict=True)==p;a=p.lstat();assert stat.S_ISREG(a.st_mode)and a.st_uid==0 and a.st_nlink==1 and not a.st_mode&0o022
  raw=p.read_bytes();assert raw[:4]==b'\x7fELF';binaries[name]={'file':file,'sha256':hashlib.sha256(raw).hexdigest()}
  assert(a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==tuple(getattr(p.lstat(),k)for k in['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns'])
  child=subprocess.Popen([file,'--version'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE);out,err=child.communicate();originals.append({'originalPid':child.pid,'code':child.returncode,'stdoutEof':child.stdout.closed,'stderrEof':child.stderr.closed,'stdoutSha256':hashlib.sha256(out).hexdigest(),'stderrSha256':hashlib.sha256(err).hexdigest(),'stdoutBase64':__import__('base64').b64encode(out).decode(),'argv':[file,'--version']});assert child.returncode==0 and child.stdout.closed and child.stderr.closed and not err and not cancelled
 assert namespace=={k:str(getattr(root.lstat(),k))for k in namespace}
 return{'format':'sabalan-original-complete-installed-construction-input/v1','namespace':namespace,'binaries':binaries,'postgresMajor':versions[0].name,'originals':originals,'cancelled':bool(cancelled),'readOnly':True,'productionAdmission':False}
if __name__=='__main__':print(json.dumps(probe()),flush=True)
