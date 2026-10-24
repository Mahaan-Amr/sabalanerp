"""Exact read-only nonempty acceptance history proof. Never retires or adopts actors."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

ROOT=Path('/app/online-runtime-acceptance')
SPEC_SHA='3ec97ee87697102b156ee16990cbcf8799906fbfbba0216fed04a57d863940e2'
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
def inventory(directory):
 root=noalias(directory,True);entries=[];states={'.':identity(root)}
 for file in sorted(directory.rglob('*')):
  check(len(entries)<1024,'HISTORY_ENTRY_BOUND');st=file.lstat();check(st.st_dev==root.st_dev,'HISTORY_CROSSED_FILESYSTEM');isdir=stat.S_ISDIR(st.st_mode);noalias(file,isdir);relative=file.relative_to(directory).as_posix();states[relative]=identity(st)
  entries.append({'path':relative,'type':'directory'if isdir else'file','bytes':st.st_size,'sha256':None if isdir else digest(read(file))})
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
   entries,states=inventory(ROOT/name);check(entries==expected['entries'],'HISTORY_INVENTORY_CHANGED');check(sum(row['type']=='file'for row in entries)==expected['files'],'HISTORY_FILE_COUNT');check(sum(row['bytes']for row in entries if row['type']=='file')==expected['bytes'],'HISTORY_BYTE_COUNT');snapshots[name]=(entries,states);summaries[name]={'entries':len(entries),'files':expected['files'],'bytes':expected['bytes'],'sha256':digest(compact(entries))}
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
  for name,before in snapshots.items():check(inventory(ROOT/name)==before,'HISTORY_INVENTORY_CHANGED_DURING_PROOF')
  lock_identities=[]
  for file,before,lockfd in locks:check(identity(os.fstat(lockfd))==identity(file.lstat())==identity(before),'HISTORY_LOCK_CHANGED_DURING_PROOF');lock_identities.append({'file':str(file),'identity':identity(before)})
  check({name:identity(noalias(ROOT/name,True))for name in spec['children']}==child_ids,'HISTORY_CHILD_CHANGED_DURING_PROOF');check(sorted(os.listdir(fd))==sorted(spec['children']),'HISTORY_ROOT_ENTRIES_CHANGED');check(identity(os.fstat(fd))==identity(ROOT.lstat())==identity(root_before),'HISTORY_PARENT_CHANGED_DURING_PROOF')
  capsule_ids={str(ROOT/name):[child_ids[name]['st_dev'],child_ids[name]['st_ino'],int(child_ids[name]['st_size']),int(child_ids[name]['st_mtime_ns']),int(child_ids[name]['st_ctime_ns']),int(child_ids[name]['st_mode']),int(child_ids[name]['st_uid']),int(child_ids[name]['st_nlink'])]for name in spec['capsuleNames']}
  result={'format':'sabalan-inert-owned-acceptance-history/v1','classification':'INERT_OWNED_HISTORY_VIEW','physicalEmpty':False,'namespace':identity(root_before),'historicalNamespace':spec['historicalNamespace'],'rootNames':sorted(spec['children']),'children':child_ids,'histories':summaries,'closures':closures,'lockIdentities':lock_identities,'capsuleDirectoryIdentities':capsule_ids,'readOnly':True,'databaseExecuted':False,'nativeActorStarted':False,'qualificationSucceeded':False,'productionAdmission':False}
 finally:
  for _,_,lockfd in locks:os.close(lockfd)
  os.close(fd)
 print(json.dumps(result,separators=(',',':')),flush=True)
if __name__=='__main__':main()
