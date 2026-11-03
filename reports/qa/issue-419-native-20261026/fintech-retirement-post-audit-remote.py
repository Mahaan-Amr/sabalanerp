import os,json,hashlib,pathlib,fcntl,stat,subprocess
assert os.getuid()==0
assert hashlib.sha256(pathlib.Path('/etc/machine-id').read_bytes()).hexdigest()=='6318badc5743562c39073054d9941e7c2a4e6ccc05c3d53a9a6ed7067bd16e38'
f=os.open('/run/lock/sabalan-backup-storage.lock',os.O_RDONLY|os.O_NOFOLLOW);fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
commands=[]
def run(args,allowed=(0,)):
 p=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE);out,err=p.communicate()
 commands.append({'argv':args,'pid':p.pid,'code':p.returncode,'stdoutEof':p.stdout.closed,'stderrEof':p.stderr.closed,'stderrSha256':hashlib.sha256(err).hexdigest()})
 assert p.returncode in allowed
 return out.decode()
protected='/srv/sabalanerp-recovery/checkpoints';rows=[]
for base,dirs,files in os.walk(protected,followlinks=False):
 for name in dirs+files:
  p=os.path.join(base,name);s=os.lstat(p);row=[p,s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns]
  if p.endswith('.json') and stat.S_ISREG(s.st_mode) and s.st_size<8*1024**2:row.append(hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest())
  rows.append(row)
digest=hashlib.sha256(json.dumps(sorted(rows)).encode()).hexdigest()
assert digest=='373a7c9f897170252486b5fe94147c8b7fa6f2e743082e7fe243036b4521daf2'
containers=run(['docker','ps','-a','--format','{{.ID}} {{.Names}} {{.Label "com.docker.compose.project"}}'])
volumes=run(['docker','volume','ls','--format','{{.Name}} {{.Label "com.docker.compose.project"}}'])
images=run(['docker','image','ls','--all','--no-trunc','--format','{{.ID}} {{.Repository}}:{{.Tag}}'])
networks=run(['docker','network','ls','--format','{{.Name}}'])
units=run(['systemctl','list-units','--all','--plain','--no-legend','fintech*'])
nat=run(['iptables','-w','5','-t','nat','-S'])
left=[]
for root in ['/opt','/etc','/root','/usr/local','/srv']:
 for base,dirs,files in os.walk(root,followlinks=False):
  dirs[:]=[d for d in dirs if d not in ['node_modules','.git','.npm','proc','sys','dev']]
  for name in dirs+files:
   if 'fintech' in name.lower():left.append(os.path.join(base,name))
assert not any('fintech' in s.lower() for s in [containers,volumes,images,networks,units,nat]),'FINTECH_RUNTIME_REMAINS'
run(['nginx','-t'])
services={n:run(['systemctl','is-active',n],(0,3)).strip() for n in ['nginx','ssh','docker']}
s=os.statvfs(protected)
print(json.dumps({'format':'sabalan-fintech-post-audit/v1','cleanupPerformed':False,'canonicalAuditAppend':False,'protectedSabalanDigest':digest,'protectedEntryCount':len(rows),'availableBytesAfter':s.f_bavail*s.f_frsize,'containers':containers,'volumes':volumes,'images':images,'networks':networks,'fintechUnits':units,'fintechNamedPathsRemaining':left,'services':services,'commands':commands}))
