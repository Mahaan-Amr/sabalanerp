"""Explicit user-authorized Fintech retirement on the pinned backup host only."""
import base64,fcntl,hashlib,json,os,pathlib,re,shlex,shutil,stat,subprocess,time,uuid
PLAN=json.loads(base64.b64decode('PLAN_BASE64'))
assert os.getuid()==0
assert hashlib.sha256(pathlib.Path('/etc/machine-id').read_bytes()).hexdigest()==PLAN['machineUuidSha256']=='6318badc5743562c39073054d9941e7c2a4e6ccc05c3d53a9a6ed7067bd16e38'
lock='/run/lock/sabalan-backup-storage.lock'
lockfd=os.open(lock,os.O_RDONLY|os.O_NOFOLLOW);fcntl.flock(lockfd,fcntl.LOCK_EX|fcntl.LOCK_NB)
original=os.fstat(lockfd)
assert original.st_uid==0 and original.st_nlink==1 and not original.st_mode&0o022
def locked():
 now=os.stat(lock,follow_symlinks=False)
 assert (now.st_dev,now.st_ino)==(original.st_dev,original.st_ino)
protected='/srv/sabalanerp-recovery/checkpoints'
assert os.path.realpath(protected)==protected
device=os.stat(protected).st_dev
assert device==64513
audit_parent='/var/log/sabalanerp-backup'
assert os.path.realpath(audit_parent)==audit_parent and os.stat(audit_parent).st_uid==0 and not os.stat(audit_parent).st_mode&0o022
audit_file=audit_parent+'/fintech-retirement-'+uuid.uuid4().hex+'.jsonl'
auditfd=os.open(audit_file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
events=[]
def event(kind,**value):
 row={'event':kind,**value};raw=(json.dumps(row,separators=(',',':'))+'\n').encode()
 offset=0
 while offset<len(raw):offset+=os.write(auditfd,raw[offset:])
 os.fsync(auditfd);events.append(row)
def command(argv,allowed=(0,)):
 locked();event('COMMAND_INTENT',argv=argv)
 p=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 out,err=p.communicate()
 assert len(out)<=8*1024**2 and len(err)<=131072
 event('COMMAND_CLOSED',pid=p.pid,code=p.returncode,stdoutEof=p.stdout.closed,stderrEof=p.stderr.closed,stdoutSha256=hashlib.sha256(out).hexdigest(),stderrSha256=hashlib.sha256(err).hexdigest())
 assert p.returncode in allowed, 'COMMAND_REFUSED:'+argv[0]+':'+str(p.returncode)
 return p.returncode,out
def docker(*argv,allowed=(0,)):
 return command(['docker',*argv],allowed=allowed)
def containers():
 _,raw=docker('ps','--all','--quiet','--no-trunc');ids=raw.decode().splitlines()
 if not ids:return []
 fmt='{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"mounts":{{json .Mounts}}}'
 _,raw=docker('inspect','--format',fmt,*ids)
 return [json.loads(x) for x in raw.decode().splitlines()]
projects={'fintech-lab','fintech-qa'}
def protected_snapshot():
 rows=[]
 for base,dirs,files in os.walk(protected,followlinks=False):
  for name in dirs+files:
   p=os.path.join(base,name);s=os.lstat(p)
   row=[p,s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns]
   if p.endswith('.json') and stat.S_ISREG(s.st_mode) and s.st_size<8*1024**2:row.append(hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest())
   rows.append(row)
 return hashlib.sha256(json.dumps(sorted(rows)).encode()).hexdigest(),len(rows)
unit_pattern=re.compile(r'^fintech-proxy(?:-backend@[0-9]+|-routing|-watch)?\.(?:service|timer)$')
allowed_roots={x['path']:x for x in PLAN['paths']}
assert set(allowed_roots)=={'/etc/fintech-proxy','/etc/fintech-web','/etc/nginx/sites-available/fintech-lab','/etc/nginx/sites-enabled/fintech-lab','/etc/systemd/system/fintech-proxy-backend@.service','/etc/systemd/system/fintech-proxy-routing.service','/etc/systemd/system/fintech-proxy-watch.service','/etc/systemd/system/fintech-proxy-watch.service.d','/etc/systemd/system/fintech-proxy-watch.timer','/etc/systemd/system/fintech-proxy-watch.timer.d','/etc/systemd/system/fintech-proxy.service','/etc/systemd/system/fintech-proxy.service.d','/opt/fintech-deploy','/opt/fintech-lab','/root/fintech-access.json','/usr/local/bin/fintech-xray'}
deleted={'containers':[],'volumes':[],'images':[],'paths':[],'networks':[],'units':[],'tags':[]}
before_space=os.statvfs(protected);before_free=before_space.f_bavail*before_space.f_frsize
before_protected=protected_snapshot()
initial=containers();other=[c for c in initial if c['project'] not in projects]
assert not other, 'UNEXPECTED_NON_FINTECH_CONTAINER_CHANGED_SINCE_PLAN'
image_ids={x['id'] for x in PLAN['images']}
assert not PLAN['sabalanReferenceMatches']
baseline_images=set(command(['docker','image','ls','--all','--quiet','--no-trunc'])[1].decode().splitlines())
remaining_before=baseline_images-image_ids
def image_tags(image):
 code,raw=docker('image','inspect','--format','{{json .RepoTags}}',image,allowed=(0,1))
 return None if code else (json.loads(raw) or [])
def non_fintech_tags():
 result={}
 for image in set(docker('image','ls','--all','--quiet','--no-trunc')[1].decode().splitlines()):
  for tag in image_tags(image) or []:
   if not tag.startswith('fintech-lab:'):result[tag]=image
 return result
non_fintech_tags_before=non_fintech_tags()
nginx_state=command(['systemctl','show','nginx','--property=ActiveState','--value'])[1].decode().strip()
status='PARTIAL_FAILED';error=None
try:
 event('RETIREMENT_AUTHORIZED',scope='All Fintech project/data on backup host only',beforeAvailable=before_free,protectedDigest=before_protected[0])
 # Reversibly omit only the Fintech include, validate remaining shared nginx,
 # then restore the same symlink before proceeding with irreversible retirement.
 site='/etc/nginx/sites-enabled/fintech-lab';temporary_link=audit_file+'.nginx-link'
 assert os.path.islink(site) and not os.path.lexists(temporary_link)
 assert os.path.realpath(site)==allowed_roots[site]['realpath']
 os.rename(site,temporary_link)
 try:
  config=command(['nginx','-T'])[1]
  assert not re.search(rb'/(?:opt/fintech(?:-deploy|-lab)|etc/fintech(?:-proxy|-web)|usr/local/bin/fintech-xray)',config), 'SHARED_NGINX_FINTECH_REFERENCE'
 finally:
  assert not os.path.lexists(site)
  os.rename(temporary_link,site)
 for unit in PLAN['systemdUnits']:
  assert hashlib.sha256(pathlib.Path(unit['path']).read_bytes()).hexdigest()==unit['sha256'], 'UNIT_SOURCE_DRIFT'
 # Stop the timer first so the project's own watcher cannot respawn proxies.
 command(['systemctl','disable','--now','fintech-proxy-watch.timer'])
 _,raw=command(['systemctl','list-units','--all','--plain','--no-legend','fintech*'])
 units=[line.split()[0] for line in raw.decode().splitlines() if line.split()]
 assert all(unit_pattern.fullmatch(x) for x in units), 'UNKNOWN_FINTECH_UNIT_REQUIRES_REVIEW'
 ordered=sorted(units,key=lambda x:(0 if x=='fintech-proxy-watch.service' else 1,x))
 for name in ordered:
  command(['systemctl','stop',name])
  command(['systemctl','disable',name])
  props=command(['systemctl','show',name,'--property=ActiveState,MainPID'])[1].decode()
  assert 'MainPID=0' in props or name.endswith('.timer')
  assert 'ActiveState=inactive' in props or 'ActiveState=failed' in props
  deleted['units'].append(name)
 # Only the exact project-owned NAT chain and jumps are removed; no table flush.
 _,raw=command(['iptables','-w','5','-t','nat','-S'])
 rules=[shlex.split(line) for line in raw.decode().splitlines()]
 for rule in rules:
  if rule[:1]==['-A'] and any(rule[i:i+2] in [['-j','FINTECH_PROXY_ONLINE'],['-g','FINTECH_PROXY_ONLINE']] for i in range(len(rule)-1)):
   command(['iptables','-w','5','-t','nat','-D',*rule[1:]])
 if any(rule==['-N','FINTECH_PROXY_ONLINE'] for rule in rules):
  command(['iptables','-w','5','-t','nat','-F','FINTECH_PROXY_ONLINE'])
  command(['iptables','-w','5','-t','nat','-X','FINTECH_PROXY_ONLINE'])
 # Current IDs are reobserved, including short-lived fintech-qa containers.
 for c in containers():
  assert c['project'] in projects
  assert c['image'] in image_ids, 'UNREVIEWED_FINTECH_IMAGE'
  if c['running']:docker('stop','--time','60',c['id'])
  docker('rm',c['id']);deleted['containers'].append(c['id'])
 assert not containers(), 'NEW_CONTAINER_OR_OWNER_REMAINS'
 for v in PLAN['volumes']:
  assert v['name'].startswith('fintech-lab_') and v['driver']=='local'
  actual=json.loads(docker('volume','inspect',v['name'])[1])[0]
  assert actual['Labels']['com.docker.compose.project']=='fintech-lab'
  assert actual['Mountpoint']==v['mountpoint'] and os.path.realpath(actual['Mountpoint'])==actual['Mountpoint']
  s=os.lstat(actual['Mountpoint']);assert (s.st_dev,s.st_ino)==(v['root']['dev'],v['root']['ino'])
  assert not any(m.get('Name')==v['name'] for c in containers() for m in c['mounts'])
  docker('volume','rm',v['name']);deleted['volumes'].append(v['name'])
 # Remove tags without --force/automatic parent pruning; shared external refs refuse.
 pending=[]
 for image in PLAN['images']:
  assert not image['nonFintechReferences'] and not image['otherTags']
  current_tags=image_tags(image['id'])
  assert current_tags is not None and all(tag.startswith('fintech-lab:') for tag in current_tags), 'NEW_NON_FINTECH_IMAGE_TAG'
  for tag in image['fintechTags']:
   assert tag.startswith('fintech-lab:')
   tag_id=docker('image','inspect','--format','{{.Id}}',tag)[1].decode().strip()
   assert tag_id==image['id'], 'IMAGE_TAG_DRIFT'
   code,_=docker('image','rm','--no-prune',tag,allowed=(0,1))
   if code==0:deleted['tags'].append(tag)
  pending.append(image['id'])
 for _ in range(len(pending)+1):
  progress=False
  for image in pending[:]:
   tags=image_tags(image)
   if tags is None:pending.remove(image);deleted['images'].append(image);progress=True;continue
   assert all(tag.startswith('fintech-lab:') for tag in tags), 'NEW_NON_FINTECH_IMAGE_TAG'
   code,_=docker('image','rm','--no-prune',image,allowed=(0,1))
   if code==0:pending.remove(image);deleted['images'].append(image);progress=True
  if not pending or not progress:break
 assert not pending, 'REFERENCED_IMAGE_REMAINS'
 # Remove only named Fintech networks, after all project endpoints are absent.
 _,raw=docker('network','ls','--quiet')
 for network in raw.decode().splitlines():
  n=json.loads(docker('network','inspect',network)[1])[0]
  if (n.get('Labels') or {}).get('com.docker.compose.project') in projects or n['Name'].startswith('fintech-'):
   assert not n['Containers'] and not n.get('Ingress')
   docker('network','rm',network);deleted['networks'].append(n['Name'])
 # Each recursive target must be the exact reviewed canonical path and filesystem.
 mountpoints=[]
 for line in pathlib.Path('/proc/self/mountinfo').read_text().splitlines():mountpoints.append(line.split()[4].replace('\\040',' '))
 for target,old in sorted(allowed_roots.items(),key=lambda item:(0 if item[0].startswith('/etc/nginx/sites-enabled/') else 1,item[0])):
  locked();assert target!='/' and not target.startswith(('/srv/sabalanerp','/root/sabalan-recovery-private','/var/lib/docker'))
  s=os.lstat(target);assert (s.st_dev,s.st_ino)==(old['dev'],old['ino']) and s.st_uid==old['uid']
  assert os.path.realpath(target)==old['realpath']
  assert not any(m==target or m.startswith(target+'/') for m in mountpoints)
  event('PATH_REMOVE_INTENT',path=target,inode=s.st_ino,device=s.st_dev)
  if stat.S_ISDIR(s.st_mode) and not stat.S_ISLNK(s.st_mode):
   assert os.path.realpath(target)==target and s.st_dev==device
   shutil.rmtree(target)
  else:os.unlink(target)
  assert not os.path.lexists(target);deleted['paths'].append(target);event('PATH_REMOVED',path=target)
 command(['systemctl','daemon-reload'])
 command(['nginx','-t'])
 if nginx_state=='active':command(['systemctl','reload','nginx'])
 os.sync()
 assert protected_snapshot()==before_protected, 'SABALAN_PROTECTION_CHANGED'
 assert not containers()
 _,raw=docker('image','ls','--all','--quiet','--no-trunc');after_ids=set(raw.decode().splitlines())
 assert remaining_before<=after_ids, 'NON_FINTECH_IMAGE_CHANGED'
 assert non_fintech_tags()==non_fintech_tags_before, 'NON_FINTECH_TAG_MAPPING_CHANGED'
 assert not image_ids&after_ids
 remaining_units=command(['systemctl','list-units','--state=active,activating','--plain','--no-legend','fintech*'])[1].decode().strip()
 assert not remaining_units
 for proc in pathlib.Path('/proc').iterdir():
  if not proc.name.isdigit():continue
  try:assert os.readlink(proc/'exe') not in ['/usr/local/bin/fintech-xray','/usr/local/bin/fintech-xray (deleted)']
  except OSError:pass
 status='COMPLETE'
except BaseException as failure:
 error={'type':type(failure).__name__,'message':str(failure)[:400]}
finally:
 locked();after_space=os.statvfs(protected);after_free=after_space.f_bavail*after_space.f_frsize
 event('RETIREMENT_RESULT',status=status,error=error,afterAvailable=after_free,deleted=deleted)
 os.close(auditfd)
 print(json.dumps({'format':'sabalan-fintech-retirement-result/v1','status':status,'cleanupPerformed':bool(any(deleted.values())),'canonicalAuditAppend':False,'fullAccepted':False,'beforeAvailableBytes':before_free,'availableBytesAfter':after_free,'reclaimedBytesObserved':after_free-before_free,'deleted':deleted,'error':error,'auditFile':audit_file,'protectedSabalanDigestBefore':before_protected,'protectedSabalanDigestAfter':protected_snapshot(),'originalStorageLock':{'device':original.st_dev,'inode':original.st_ino,'exclusive':True},'events':events}))
