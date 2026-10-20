#!/usr/bin/env python3
"""Immutable plaintext inventory only; no runtime/recovery-point admission."""
import hashlib,importlib.util,json,os,stat,sys
from pathlib import Path
v=json.load(sys.stdin);root=Path(v['root']);sources=[];seen=set()
readerfile=Path(__file__).with_name('recovery-versioned-files.py')
assert hashlib.sha256(readerfile.read_bytes()).hexdigest()==v['readerSha256']
spec=importlib.util.spec_from_file_location('checkpoint_reader',readerfile)
reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
def add(role,name,file,expected=None,size=None):
 file=Path(file);assert file.is_absolute() and file.resolve(strict=True)==file
 if str(file) in seen:return
 fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  before=os.fstat(fd);assert stat.S_ISREG(before.st_mode) and before.st_uid==os.getuid() and before.st_nlink==1 and not before.st_mode&0o077
  digest=hashlib.sha256()
  while True:
   raw=os.read(fd,262144)
   if not raw:break
   digest.update(raw)
  sha=digest.hexdigest()
  assert reader.stable(before)==reader.stable(os.fstat(fd))==reader.stable(file.lstat())
  assert (expected is None or expected==sha) and (size is None or size==before.st_size)
  os.fsync(fd)
  sources.append(dict(role=role,name=name,path=str(file),bytes=before.st_size,sha256=sha));seen.add(str(file))
  assert len(sources)<=250000
 finally:os.close(fd)
add('physical-base','physical-base',Path(v['base'])/'base.tar',v['coverage']['physicalBaseProof']['archiveSha256'],v['coverage']['physicalBaseProof']['archiveBytes'])
add('coherent-cut','coherent-cut',Path(v['component'])/'captured.json')
history=v['captured'].get('coordinationHistory')
if v['captured'].get('format')=='sabalan-coherent-component/v3':
 assert history and history['file']=='coordination-history.json'
if history:
 assert history['file']=='coordination-history.json'
 add('coordination','coordination-history',Path(v['component'])/history['file'],history['sha256'],history['bytes'])
add('coverage-manifest','coverage',root/'coverage.json')
snap=v['captured']['sqliteSnapshot'];assert snap['file']=='inquiry/inquiry.db'
add('inquiry-sqlite','inquiry',Path(v['component'])/snap['file'],snap['sha256'],snap['bytes'])
add('wal-capture','wal-capture',root/'receiver/capture-state.json')
for segment in v['receiver']['segments']:
 add('wal-segment','wal-'+segment['name'],root/'receiver/wal'/segment['name'],segment['sha256'],segment['bytes'])
for cut in v['captured']['versionedCuts']:
 store=reader.SealedVersionedFiles(cut['storeRoot'],cut['captureId'],cut['sha256'])
 add('versioned-file-cut','cut-'+cut['name'],Path(cut['storeRoot'])/'seals'/(cut['captureId']+'.json'),cut['sha256'])
 metadata=store.cut_metadata(cut['captureId'],cut['sha256'])
 for head in metadata['heads']:
  current=head['sha256']
  selected=True
  while current is not None:
   item,_=store.version(current)
   add('versioned-file-lineage',cut['name']+'-version-'+current,Path(cut['storeRoot'])/'versions'/(current+'.json'),current)
   if selected and item['operation']=='PUT':
    obj=item['object'];add('versioned-file-object',cut['name']+'-object-'+obj['name'],Path(cut['storeRoot'])/'objects'/obj['name'],obj['sha256'],obj['bytes'])
   current=item['previousSha256']
   selected=False
 store.assert_owner()
manifest=dict(format='sabalan-online-checkpoint-plaintext-components/v1',operation=v['operation'],
 coverageSha256=next(r['sha256']for r in sources if r['role']=='coverage-manifest'),
 sourceCaptureSha256=next(r['sha256']for r in sources if r['role']=='coherent-cut'),sources=sources)
raw=(json.dumps(manifest,sort_keys=True,separators=(',',':'))+'\n').encode();assert len(raw)<=64*1024*1024
fd=os.open(root/'plaintext-components.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
try:
 with os.fdopen(fd,'wb',closefd=False)as stream:stream.write(raw);stream.flush();os.fsync(fd)
finally:os.close(fd)
fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
print(json.dumps(dict(sha256=hashlib.sha256(raw).hexdigest(),sources=len(sources))))
