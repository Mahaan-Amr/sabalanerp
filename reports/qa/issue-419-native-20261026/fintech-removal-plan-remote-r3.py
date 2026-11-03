"""Fresh exact retirement inventory for user-authorized Fintech removal; no deletion."""
import fcntl,hashlib,json,os,pathlib,stat,subprocess
assert os.getuid()==0
fd=os.open('/run/lock/sabalan-backup-storage.lock',os.O_RDONLY|os.O_NOFOLLOW)
fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
held=os.fstat(fd)
assert held.st_uid==0 and held.st_nlink==1 and not held.st_mode&0o022
commands=[]
def run(argv,allowed=(0,)):
 p=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 out,err=p.communicate();assert len(out)<=8*1024**2 and len(err)<=65536
 commands.append({'argv':argv,'pid':p.pid,'code':p.returncode,'stdoutEof':p.stdout.closed,'stderrEof':p.stderr.closed,'stdoutSha256':hashlib.sha256(out).hexdigest(),'stderrSha256':hashlib.sha256(err).hexdigest()})
 assert p.returncode in allowed
 return out
def meta(p):
 s=os.lstat(p)
 return {'path':p,'realpath':os.path.realpath(p),'dev':s.st_dev,'ino':s.st_ino,'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'size':s.st_size,'nlink':s.st_nlink,'symlink':stat.S_ISLNK(s.st_mode),'directory':stat.S_ISDIR(s.st_mode)}
ids=run(['docker','ps','--all','--quiet','--no-trunc']).decode().splitlines()
fmt='{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"mounts":{{json .Mounts}}}'
containers=[json.loads(x) for x in run(['docker','inspect','--format',fmt,*ids]).decode().splitlines()] if ids else []
own=[c for c in containers if c['project'] in ['fintech-lab','fintech-qa']]
assert all(c['project']=='fintech-qa' or c['name'].startswith('/fintech-lab-') for c in own)
own_ids={c['id'] for c in own};own_images={c['image'] for c in own}
volumes=[]
for name in run(['docker','volume','ls','--quiet']).decode().splitlines():
 v=json.loads(run(['docker','volume','inspect','--format','{"name":{{json .Name}},"mountpoint":{{json .Mountpoint}},"labels":{{json .Labels}},"driver":{{json .Driver}}}',name]))
 if (v['labels'] or {}).get('com.docker.compose.project')=='fintech-lab':
  assert name.startswith('fintech-lab_') and v['driver']=='local'
  refs=[c['id'] for c in containers for m in c['mounts'] if m.get('Type')=='volume' and m.get('Name')==name]
  assert set(refs)<=own_ids
  v.update({'references':refs,'root':meta(v['mountpoint'])});volumes.append(v)
images=[]
for image in sorted(set(run(['docker','image','ls','--all','--quiet','--no-trunc']).decode().splitlines())):
 fmt='{"id":{{json .Id}},"tags":{{json .RepoTags}},"size":{{json .Size}},"project":{{if .Config}}{{if .Config.Labels}}{{json (index .Config.Labels "com.docker.compose.project")}}{{else}}null{{end}}{{else}}null{{end}}}'
 row=json.loads(run(['docker','image','inspect','--format',fmt,image]))
 tags=row['tags'] or []
 fintech_tags=[x for x in tags if x.split(':')[0].startswith(('fintech','fintech-lab/'))]
 if row['id'] in own_images or row['project']=='fintech-lab' or fintech_tags:
  refs=[c['id'] for c in containers if c['image']==row['id']]
  row.update({'containerReferences':refs,'nonFintechReferences':[x for x in refs if x not in own_ids],'fintechTags':fintech_tags,'otherTags':[x for x in tags if x not in fintech_tags]})
  images.append(row)
paths=[]
fixed=['/opt/fintech-deploy','/usr/local/bin/fintech-xray']
for base in ['/opt','/root','/srv','/var/log','/var/lib','/etc/systemd/system','/lib/systemd/system','/etc/cron.d','/etc/nginx/sites-enabled','/etc/nginx/sites-available','/usr/local/bin','/usr/local/sbin']:
 if not os.path.isdir(base):continue
 for name in os.listdir(base):
  if 'fintech' in name.lower():fixed.append(base+'/'+name)
for path in sorted(set(fixed)):
 if os.path.lexists(path):
  info=meta(path)
  if info['directory'] and not info['symlink']:
   raw=run(['du','-x','-B1','-s',path]).decode();info['allocatedBytes']=int(raw.split('\t')[0])
  else:info['allocatedBytes']=os.lstat(path).st_blocks*512
  refs=[{'id':c['id'],'project':c['project'],'source':m['Source']} for c in containers for m in c['mounts'] if m.get('Type')=='bind' and (m['Source']==path or m['Source'].startswith(path+'/'))]
  info['bindReferences']=refs
  paths.append(info)
units=[]
for base in ['/etc/systemd/system','/lib/systemd/system']:
 if not os.path.isdir(base):continue
 for p in pathlib.Path(base).glob('*.service'):
  if p.is_symlink():continue
  if p.stat().st_size>262144:continue
  raw=p.read_bytes()
  if b'/opt/fintech' in raw or b'/usr/local/bin/fintech' in raw or 'fintech' in p.name.lower():
   import re
   exec_paths=[]
   for line in raw.decode().splitlines():
    if line.startswith(('ExecStart=','ExecStop=','ExecStartPre=','ExecStopPost=')):
     exec_paths.append({'kind':line.split('=',1)[0],'paths':re.findall(r'/(?:opt|usr|bin|etc)/[^\s;\"\']+',line)})
   units.append({'path':str(p),'name':p.name,'sha256':hashlib.sha256(raw).hexdigest(),'execPaths':exec_paths,'properties':run(['systemctl','show',p.name,'--property=ActiveState,SubState,UnitFileState,MainPID'],allowed=(0,1,3,4)).decode().strip()})
unit_list=run(['systemctl','list-units','--all','--plain','--no-legend','fintech*']).decode()
script_details=[]
for unit in units:
 for entry in unit['execPaths']:
  for file in entry['paths']:
   if file.startswith('/opt/fintech-lab/') and os.path.isfile(file):
    raw=pathlib.Path(file).read_bytes()
    if len(raw)<262144:
     text=raw.decode(errors='replace')
     relevant=[line.strip() for line in text.splitlines() if any(key in line for key in ['iptables','ip rule','ip route','nft ','ExecStop'])]
     script_details.append({'path':file,'sha256':hashlib.sha256(raw).hexdigest(),'networkLines':relevant})
proc=[]
for p in pathlib.Path('/proc').iterdir():
 if not p.name.isdigit():continue
 for field in ['exe','cwd']:
  try:
   target=os.readlink(p/field)
   if target.startswith('/opt/fintech-deploy/') or target=='/usr/local/bin/fintech-xray':proc.append({'pid':int(p.name),'field':field,'target':target})
  except OSError:pass
v=os.statvfs('/srv/sabalanerp-recovery/checkpoints')
print(json.dumps({'format':'sabalan-fintech-retirement-plan/v1','cleanupPerformed':False,'canonicalAuditAppend':False,'fullAccepted':False,'machineUuidSha256':hashlib.sha256(pathlib.Path('/etc/machine-id').read_bytes()).hexdigest(),'availableBytes':v.f_bavail*v.f_frsize,'containers':own,'nonFintechContainers':[c for c in containers if c['id'] not in own_ids],'volumes':volumes,'images':images,'paths':paths,'systemdUnits':units,'unitList':unit_list,'scripts':script_details,'processReferences':proc,'commands':commands,'originalStorageLock':{'device':held.st_dev,'inode':held.st_ino,'exclusive':True}}))
