"""Exact read-only nonempty acceptance history proof. Never retires or adopts actors."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

ROOT=Path('/app/online-runtime-acceptance')
SPEC_SHA='5b16b246c022aa25d214bf234700d38e50358dcbc455e39061dde7df777c783a'
FIELDS=['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns']
def check(value,message):
 if not value:raise AssertionError(message)
def identity(st):return {k:str(getattr(st,k))for k in FIELDS}
def digest(raw):return hashlib.sha256(raw).hexdigest()
def compact(value):return json.dumps(value,separators=(',',':'),ensure_ascii=False).encode()
def noalias(file,directory=False):
 st=file.lstat();check(not stat.S_ISLNK(st.st_mode)and st.st_uid==0,'HISTORY_ALIAS_OR_OWNER');check(stat.S_ISDIR(st.st_mode)if directory else stat.S_ISREG(st.st_mode),'HISTORY_TYPE');check(directory or st.st_nlink==1,'HISTORY_LINK_COUNT');check(file.resolve(strict=True)==file,'HISTORY_PATH_ALIAS');return st
def read(file):
 before=noalias(file);check(before.st_size<=16*1024**2,'HISTORY_FILE_BOUND');fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  check(identity(os.fstat(fd))==identity(before),'HISTORY_READ_DESCRIPTOR');raw=b''
  while True:
   part=os.read(fd,65536)
   if not part:break
   raw+=part;check(len(raw)<=16*1024**2,'HISTORY_READ_BOUND')
  check(identity(os.fstat(fd))==identity(file.lstat())==identity(before),'HISTORY_CHANGED_DURING_READ');return raw
 finally:os.close(fd)
def hash_file(file,expected,spec):
 before=noalias(file);check(before.st_size==expected['bytes'],'HISTORY_FILE_SIZE_CHANGED')
 maximum=16*1024**2
 if before.st_size>maximum:
  known=spec['largeFiles'].get(str(file));check(str(file)in [
   str(ROOT/'application-native-1cc175018d9d712991bdf4ee45d2593e/full-catalog/backend/node_modules/@prisma/client/index.d.ts'),
   str(ROOT/'application-native-1cc175018d9d712991bdf4ee45d2593e/node_modules/@prisma/client/index.d.ts')],'HISTORY_UNKNOWN_LARGE_PATH')
  check(known=={'bytes':52193462,'sha256':expected['sha256']}and expected['bytes']==52193462,'HISTORY_LARGE_FILE_NOT_SOURCE_OWNED');maximum=known['bytes']
 check(before.st_size<=maximum,'HISTORY_FILE_BOUND');fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC);h=hashlib.sha256();size=0
 try:
  check(identity(os.fstat(fd))==identity(before),'HISTORY_HASH_DESCRIPTOR')
  while True:
   part=os.read(fd,65536)
   if not part:break
   size+=len(part);check(size<=maximum and size<=expected['bytes'],'HISTORY_HASH_BYTE_BOUND');h.update(part)
  check(size==expected['bytes']and h.hexdigest()==expected['sha256'],'HISTORY_FILE_DIGEST_CHANGED')
  check(identity(os.fstat(fd))==identity(file.lstat())==identity(before),'HISTORY_CHANGED_DURING_HASH');return h.hexdigest()
 finally:os.close(fd)

def inventory(directory,expected,spec):
 root=noalias(directory,True);entries=[];states={'.':identity(root)};archive=expected.get('archivedDirectoryBytes',False)
 check(archive==(directory.name=='application-native-1cc175018d9d712991bdf4ee45d2593e'),'HISTORY_ARCHIVED_DIRECTORY_POLICY')
 expected_rows={row['path']:row for row in expected['entries']};check(len(expected_rows)==len(expected['entries']),'HISTORY_DUPLICATE_SOURCE_ENTRY')
 limit=4491 if archive else 1024
 check(len(expected_rows)==4491 if archive else len(expected_rows)<1024,'HISTORY_SOURCE_ENTRY_BOUND')
 files=sorted(directory.rglob('*'),key=lambda f:f.relative_to(directory).as_posix())if archive else sorted(directory.rglob('*'))
 for file in files:
  check(len(entries)<limit,'HISTORY_ENTRY_BOUND');st=file.lstat();check(st.st_dev==root.st_dev,'HISTORY_CROSSED_FILESYSTEM');isdir=stat.S_ISDIR(st.st_mode);noalias(file,isdir);relative=file.relative_to(directory).as_posix();states[relative]=identity(st)
  check(relative in expected_rows,'HISTORY_UNKNOWN_ENTRY');known=expected_rows[relative]
  row={'path':relative,'type':'directory'if isdir else'file','bytes':0 if archive and isdir else st.st_size,'sha256':None if isdir else hash_file(file,known,spec)}
  if archive:row.update(mode=stat.S_IMODE(st.st_mode),uid=st.st_uid,gid=st.st_gid)
  check(row==known,'HISTORY_ENTRY_CHANGED');entries.append(row)
 check(len(entries)==len(expected_rows),'HISTORY_MISSING_ENTRY')
 if 'identities'in expected:check({k:v for k,v in states.items()if k!='.'}==expected['identities'],'HISTORY_CURRENT_RETAINED_METADATA_CHANGED')
 check(identity(directory.lstat())==identity(root),'HISTORY_ROOT_CHANGED');return entries,states

def main():
 check(sys.platform=='linux'and os.getuid()==0 and not sys.flags.optimize,'HISTORY_LINUX_ROOT_REQUIRED')
 raw=sys.stdin.buffer.read(4*1024**2+1);check(0<len(raw)<=4*1024**2,'HISTORY_SPEC_BOUND');spec=json.loads(raw);check(digest(compact(spec))==SPEC_SHA,'HISTORY_SOURCE_OWNED_SPEC_CHANGED')
 check(spec['format']=='sabalan-inert-owned-acceptance-history-spec/v1','HISTORY_SPEC_FORMAT')
 root_before=noalias(ROOT,True);check(identity(root_before)==spec['namespace'],'HISTORY_PARENT_CHANGED');check(stat.S_IMODE(root_before.st_mode)==0o700,'HISTORY_PARENT_MODE')
 for k in ['st_dev','st_ino','st_uid','st_gid','st_mode']:check(identity(root_before)[k]==spec['historicalNamespace'][k],'HISTORY_ANCESTOR_LINEAGE')
 fd=os.open(ROOT,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC);locks=[]
 try:
  check(identity(os.fstat(fd))==identity(root_before),'HISTORY_PARENT_DESCRIPTOR');check(sorted(os.listdir(fd))==sorted(spec['children']),'HISTORY_UNKNOWN_ROOT_ENTRY')
  child_ids={name:identity(noalias(ROOT/name,True))for name in spec['children']};check(child_ids==spec['children'],'HISTORY_CHILD_IDENTITY_CHANGED')
  mounts=[line.split()for line in Path('/proc/self/mountinfo').read_text().splitlines()if line.split()[4]==str(ROOT)or line.split()[4].startswith(str(ROOT)+'/')]
  expected_targets=[str(ROOT)]+[str(ROOT/name)for name in spec['capsuleNames']];check(sorted(row[4]for row in mounts)==sorted(expected_targets),'HISTORY_UNKNOWN_MOUNT')
  for row in mounts:
   if row[4]!=str(ROOT):check('ro'in row[5].split(',')and row[3].endswith('/'+Path(row[4]).name),'HISTORY_CAPSULE_NOT_READONLY')
  snapshots={};summaries={}
  for name,expected in spec['histories'].items():
   entries,states=inventory(ROOT/name,expected,spec);check(entries==expected['entries'],'HISTORY_INVENTORY_CHANGED');check(sum(row['type']=='file'for row in entries)==expected['files'],'HISTORY_FILE_COUNT');check(sum(row['bytes']for row in entries if row['type']=='file')==expected['bytes'],'HISTORY_BYTE_COUNT');snapshots[name]=(entries,states);summaries[name]={'entries':len(entries),'files':expected['files'],'bytes':expected['bytes'],'sha256':digest(compact(entries))}
  for name,known in sorted(spec['locks'].items()):
   file=Path(name);check(file.is_relative_to(ROOT),'HISTORY_LOCK_OUTSIDE_ROOT');before=noalias(file);check(before.st_size==0,'HISTORY_LOCK_CONTENT');lockfd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC);locks.append((file,before,lockfd));check(identity(os.fstat(lockfd))==identity(before),'HISTORY_LOCK_DESCRIPTOR')
   if known:check(str(before.st_dev)==known['device']and str(before.st_ino)==known['inode'],'HISTORY_ORIGINAL_LOCK_REPLACED')
   fcntl.flock(lockfd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  closures={}
  for role,expected in spec['closures'].items():
   native=read(Path(expected['nativeFile']));work=read(Path(expected['workFile']));check(digest(native)==expected['nativeSha256']and digest(work)==expected['workSha256'],'HISTORY_TERMINAL_BYTES_CHANGED');n=json.loads(native);w=json.loads(work);check(n['phase']=='QUIESCENT'and n['nativeReaped']is True and n['sqliteNativeClosed']is True and n['stoppedBySignal']is True and w['phase']=='QUIESCENT','HISTORY_NOT_QUIESCENT')
   check(n['guardian']==expected['guardian'],'HISTORY_GUARDIAN_CHANGED');guardian=expected['guardian'];proc=Path('/proc')/str(guardian['pid'])
   if proc.exists()and Path('/proc/sys/kernel/random/boot_id').read_text().strip()==guardian['bootId']:
    try:
     same_namespace=os.readlink(proc/'ns/pid')==guardian['pidNamespace'];ticks=(proc/'stat').read_text().rsplit(')',1)[1].split()[19]
     check(not(same_namespace and ticks==guardian['startTicks']),'HISTORY_ORIGINAL_GUARDIAN_PRESENT')
    except FileNotFoundError:pass
   closures[role]={'nativeSha256':digest(native),'workSha256':digest(work),'phase':'QUIESCENT','nativeReaped':True,'sqliteNativeClosed':True}
  negative_preparations={}
  for name,proof in spec['negativePreparations'].items():
   check(name=='application-native-1cc175018d9d712991bdf4ee45d2593e','HISTORY_UNKNOWN_NEGATIVE_PREPARATION')
   check(proof['classification']=='KNOWN_NEGATIVE_CANCELLED_UNUSED'and proof['originalMasterCode']==125 and proof['nativeClosureClaimed']is False and proof['unusedGrantRecords']==17 and proof['nativeActorRecords']==0,'HISTORY_NEGATIVE_PREPARATION_NOT_CLOSED')
   index_file=Path(proof['indexFile']);check(index_file.is_relative_to(ROOT/name),'HISTORY_NEGATIVE_INDEX_OUTSIDE_ROOT');data=read(index_file);check(digest(data)==proof['indexSha256'],'HISTORY_NEGATIVE_INDEX_CHANGED');scopes={}
   def visit(value):
    if isinstance(value,dict):
     scope=value.get('scope')
     if isinstance(scope,dict)and'runtimeId'in scope:
      if scope['runtimeId']in scopes:check(scopes[scope['runtimeId']]==scope,'HISTORY_CONFLICTING_UNUSED_SCOPE')
      scopes[scope['runtimeId']]=scope
     for child in value.values():visit(child)
    elif isinstance(value,list):
     for child in value:visit(child)
   visit(json.loads(data));check(len(scopes)==17 and sorted(scopes)==proof['runtimeIds'],'HISTORY_UNUSED_SCOPE_SET_CHANGED')
   absent=[str(ROOT/name/'candidate-original-controller')]
   for scope in scopes.values():
    for directory in [scope['nativeDirectory'],scope['boundaryDirectory']]:check(Path(directory).is_relative_to(ROOT/name),'HISTORY_UNUSED_SCOPE_OUTSIDE_ROOT')
    absent.extend([scope['nativeDirectory']+'/deployment-runtime-native.json',scope['boundaryDirectory']+'/state.json',scope['boundaryDirectory']+'/claim.json'])
   check(sorted(set(absent))==proof['absentPaths'],'HISTORY_UNUSED_ABSENCE_SET_CHANGED')
   for file in absent:check(not os.path.lexists(file),'HISTORY_NEGATIVE_ACTOR_STATE_PRESENT')
   negative_preparations[name]=proof
  for name,before in snapshots.items():check(inventory(ROOT/name,spec['histories'][name],spec)==before,'HISTORY_INVENTORY_CHANGED_DURING_PROOF')
  lock_identities=[]
  for file,before,lockfd in locks:check(identity(os.fstat(lockfd))==identity(file.lstat())==identity(before),'HISTORY_LOCK_CHANGED_DURING_PROOF');lock_identities.append({'file':str(file),'identity':identity(before)})
  check({name:identity(noalias(ROOT/name,True))for name in spec['children']}==child_ids,'HISTORY_CHILD_CHANGED_DURING_PROOF');check(sorted(os.listdir(fd))==sorted(spec['children']),'HISTORY_ROOT_ENTRIES_CHANGED');check(identity(os.fstat(fd))==identity(ROOT.lstat())==identity(root_before),'HISTORY_PARENT_CHANGED_DURING_PROOF')
  capsule_ids={str(ROOT/name):[child_ids[name]['st_dev'],child_ids[name]['st_ino'],int(child_ids[name]['st_size']),int(child_ids[name]['st_mtime_ns']),int(child_ids[name]['st_ctime_ns']),int(child_ids[name]['st_mode']),int(child_ids[name]['st_uid']),int(child_ids[name]['st_nlink'])]for name in spec['capsuleNames']}
  result={'format':'sabalan-inert-owned-acceptance-history/v1','classification':'INERT_OWNED_HISTORY_VIEW','physicalEmpty':False,'namespace':identity(root_before),'historicalNamespace':spec['historicalNamespace'],'rootNames':sorted(spec['children']),'children':child_ids,'histories':summaries,'closures':closures,'negativePreparations':negative_preparations,'lockIdentities':lock_identities,'capsuleDirectoryIdentities':capsule_ids,'readOnly':True,'databaseExecuted':False,'nativeActorStarted':False,'qualificationSucceeded':False,'productionAdmission':False}
 finally:
  for _,_,lockfd in locks:os.close(lockfd)
  os.close(fd)
 print(json.dumps(result,separators=(',',':')),flush=True)
if __name__=='__main__':main()
