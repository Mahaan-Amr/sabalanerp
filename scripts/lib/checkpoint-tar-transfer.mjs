/** Fixed scripts run only through the original local executor's guarded Docker
 * children. Names inside archives are ordinal, never caller filesystem paths. */
export const sourceBatchTarScript=String.raw`import os,sys,json,stat,hashlib,tarfile,shutil
v=json.load(sys.stdin);root=v['root'];output=v['output'];rows=v['rows']
assert 0<len(rows)<=512 and output.startswith(root+'/') and os.path.realpath(os.path.dirname(output))==os.path.dirname(output)
assert shutil.disk_usage(os.path.dirname(output)).free>=sum(r['bytes']+1024 for r in rows)+268435456
def identity(s):return [str(x)for x in(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode,s.st_nlink,s.st_uid)]
snapshots=[];seen=set()
out=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
try:
 with os.fdopen(out,'wb',closefd=False)as stream:
  with tarfile.open(fileobj=stream,mode='w',format=tarfile.USTAR_FORMAT)as archive:
   for index,row in enumerate(rows):
    p=row['path'];assert p.startswith(root+'/') and os.path.realpath(p)==p and p not in seen;seen.add(p)
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
     s=os.fstat(fd);assert stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_uid==os.getuid()and not s.st_mode&0o077 and s.st_size==row['bytes']
     digest=hashlib.sha256();count=[0]
     class Reader:
      def read(self,n):
       data=os.read(fd,n);count[0]+=len(data);digest.update(data);return data
     info=tarfile.TarInfo('row-'+str(index).zfill(6));info.size=s.st_size;info.mode=0o400;info.mtime=0
     archive.addfile(info,Reader());assert count[0]==row['bytes']and digest.hexdigest()==row['sha256']
     assert identity(s)==identity(os.fstat(fd))==identity(os.lstat(p));snapshots.append(identity(s))
    finally:os.close(fd)
  stream.flush();os.fsync(stream.fileno())
finally:os.close(out)
os.chmod(output,0o400);h=hashlib.sha256()
with open(output,'rb')as f:
 while data:=f.read(262144):h.update(data)
print(json.dumps(dict(bytes=os.stat(output).st_size,sha256=h.hexdigest(),snapshots=snapshots)))`;
export const sourceBatchAuditScript=String.raw`import os,sys,json,stat,hashlib
v=json.load(sys.stdin);assert 0<len(v['rows'])<=512 and len(v['rows'])==len(v['snapshots'])
def identity(s):return [str(x)for x in(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode,s.st_nlink,s.st_uid)]
for row,expected in zip(v['rows'],v['snapshots']):
 p=row['path'];assert p.startswith(v['root']+'/')and os.path.realpath(p)==p
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);assert identity(s)==expected and stat.S_ISREG(s.st_mode);h=hashlib.sha256()
  while data:=os.read(fd,262144):h.update(data)
  assert h.hexdigest()==row['sha256']and identity(os.fstat(fd))==expected==identity(os.lstat(p))
 finally:os.close(fd)
print('ORIGINAL_BATCH_SOURCES_UNCHANGED')`;
export const cipherBatchExtractScript=String.raw`import os,sys,json,hashlib,stat,tarfile,shutil
v=json.load(sys.stdin);file=v['archive'];root=v['root'];rows=v['rows'];assert 0<len(rows)<=512 and file.startswith(root+'/')and os.path.realpath(file)==file
fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
def identity(s):return [s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_nlink,s.st_uid]
try:
 before=os.fstat(fd);assert stat.S_ISREG(before.st_mode)and before.st_nlink==1 and before.st_uid==os.getuid()and not before.st_mode&0o077 and before.st_size==v['archiveBytes']
 h=hashlib.sha256()
 while data:=os.read(fd,262144):h.update(data)
 assert h.hexdigest()==v['archiveSha256'];os.lseek(fd,0,0)
 assert shutil.disk_usage(os.path.dirname(file)).free>=sum(row['bytes']for row in rows)+268435456
 with os.fdopen(fd,'rb',closefd=False)as stream:
  with tarfile.open(fileobj=stream,mode='r:')as archive:
   members=archive.getmembers();assert len(members)==len(rows)
   for index,(member,row)in enumerate(zip(members,rows)):
    assert member.name=='row-'+str(index).zfill(6)+'.sabrec'and member.type in(tarfile.REGTYPE,tarfile.AREGTYPE)and not member.pax_headers and not member.linkname and member.size==row['bytes']
    output=row['path'];assert output.startswith(root+'/')and os.path.realpath(os.path.dirname(output))==os.path.dirname(output)
    out=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
    try:
     digest=hashlib.sha256();count=0
     with archive.extractfile(member)as source,os.fdopen(out,'wb',closefd=False)as destination:
      while data:=source.read(262144):count+=len(data);digest.update(data);destination.write(data)
      assert count==row['bytes']and digest.hexdigest()==row['sha256'];destination.flush();os.fsync(out)
    finally:os.close(out)
    digest=hashlib.sha256()
    with open(output,'rb')as check:
     checkstat=os.fstat(check.fileno());assert stat.S_ISREG(checkstat.st_mode)and checkstat.st_nlink==1 and checkstat.st_size==row['bytes']
     while data:=check.read(262144):digest.update(data)
     assert identity(checkstat)==identity(os.fstat(check.fileno()))==identity(os.lstat(output))and digest.hexdigest()==row['sha256']
 assert identity(before)==identity(os.fstat(fd))==identity(os.lstat(file))
finally:os.close(fd)
print(json.dumps(dict(files=len(rows),fullCipherReadbackVerified=True)))`;
export const removeOwnedTarScript=String.raw`import os,sys,stat,hashlib,json
v=json.load(sys.stdin);file=v['file'];assert file.startswith(v['root']+'/')and os.path.realpath(file)==file
fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
try:
 s=os.fstat(fd);assert stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_uid==os.getuid()and s.st_size==v['bytes'];h=hashlib.sha256()
 while data:=os.read(fd,262144):h.update(data)
 assert h.hexdigest()==v['sha256']and(s.st_dev,s.st_ino)==(os.lstat(file).st_dev,os.lstat(file).st_ino)
finally:os.close(fd)
os.unlink(file);fd=os.open(os.path.dirname(file),os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd);print('OWNED_TAR_REMOVED')`;
