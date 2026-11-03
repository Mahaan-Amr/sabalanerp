"""Read only exact OS-cache metadata and active-reference observations."""
import fcntl,gzip,hashlib,json,os,pathlib,stat
assert os.getuid()==0
fd=os.open('/run/lock/sabalan-backup-storage.lock',os.O_RDONLY|os.O_NOFOLLOW)
fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);held=os.fstat(fd)
def info(p):
 s=os.lstat(p)
 return {'path':p,'realpath':os.path.realpath(p),'device':s.st_dev,'inode':s.st_ino,'uid':s.st_uid,'gid':s.st_gid,
         'mode':stat.S_IMODE(s.st_mode),'nlink':s.st_nlink,'logicalBytes':s.st_size,'allocatedBytes':s.st_blocks*512,
         'mtimeNs':s.st_mtime_ns,'ctimeNs':s.st_ctime_ns,'symlink':stat.S_ISLNK(s.st_mode)}
roots=['/var/cache/apt/pkgcache.bin','/var/cache/apt/srcpkgcache.bin','/var/cache/apt/archives',
       '/root/.npm/_cacache','/root/.npm/_logs','/root/.npm/_npx','/var/lib/apt/lists']
rows=[];identities={};errors=[]
for root in roots:
 if not os.path.lexists(root):continue
 row=info(root);assert row['realpath']==root and not row['symlink']
 allocated=0;files=0;logical=0;dirs=0;seen=set();symlinks=0
 paths=[root]
 if os.path.isdir(root):
  paths=[]
  for base,names,nfiles in os.walk(root,followlinks=False):
   paths.append(base);paths.extend(os.path.join(base,n) for n in nfiles)
   names[:]=[n for n in names if not os.path.islink(os.path.join(base,n))]
 for p in paths:
  try:
   s=os.lstat(p)
   if stat.S_ISLNK(s.st_mode):symlinks+=1;continue
   if (s.st_dev,s.st_ino) in seen:continue
   seen.add((s.st_dev,s.st_ino));allocated+=s.st_blocks*512
   identities[(s.st_dev,s.st_ino)]=root
   if stat.S_ISREG(s.st_mode):files+=1;logical+=s.st_size
   elif stat.S_ISDIR(s.st_mode):dirs+=1
  except OSError as e:errors.append({'root':root,'type':type(e).__name__})
 if os.path.isfile(root):
  digest=hashlib.sha256()
  with open(root,'rb') as f:
   for block in iter(lambda:f.read(262144),b''):digest.update(block)
  row['sha256']=digest.hexdigest()
 row.update({'treeAllocatedBytes':allocated,'treeLogicalBytes':logical,'fileCount':files,'directoryCount':dirs,
             'symlinkCount':symlinks,'deletionEligibilityAccepted':False})
 rows.append(row)
active=[];proc_errors=0;package_processes=[]
for p in pathlib.Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:
  name=(p/'comm').read_text().strip()
  if any(x in name.lower() for x in ['apt','dpkg','npm','npx','unattended']):package_processes.append({'pid':int(p.name),'name':name})
  for leaf in (p/'fd').iterdir():
   try:
    s=leaf.stat();root=identities.get((s.st_dev,s.st_ino))
    if root:active.append({'pid':int(p.name),'process':name,'fd':leaf.name,'root':root,'device':s.st_dev,'inode':s.st_ino})
   except OSError:proc_errors+=1
 except OSError:proc_errors+=1
docs=[]
for file in ['/usr/share/man/man8/apt-cache.8.gz','/usr/lib/node_modules/npm/docs/content/commands/npm-cache.md','/usr/share/nodejs/npm/docs/content/commands/npm-cache.md']:
 if os.path.isfile(file):
  raw=pathlib.Path(file).read_bytes();text=(gzip.decompress(raw) if file.endswith('.gz') else raw).decode(errors='replace')
  docs.append({'file':file,'sha256':hashlib.sha256(raw).hexdigest(),
               'cacheTopicLines':[x[:300] for x in text.splitlines() if any(k in x.lower() for k in ['gencaches','pkgcache','srcpkgcache','strictly a cache','never be necessary','remove the cache'])][:12]})
for row in rows:
 now=info(row['path']);row['rootIdentityStable']=all(now[k]==row[k] for k in ['device','inode','uid','gid','mode','mtimeNs','ctimeNs'])
after=os.stat('/run/lock/sabalan-backup-storage.lock',follow_symlinks=False)
assert (held.st_dev,held.st_ino)==(after.st_dev,after.st_ino)
print(json.dumps({'format':'sabalan-419-cache-candidate-observation/v1','candidates':rows,
 'activeReferences':active,'packageProcesses':package_processes,'procErrors':proc_errors,'scanErrors':errors,
 'documents':docs,'pointInTimeOnly':True,'cleanupPerformed':False,'canonicalAuditAppend':False,'fullAccepted':False,
 'originalStorageLock':{'device':held.st_dev,'inode':held.st_ino,'exclusive':True}}))
