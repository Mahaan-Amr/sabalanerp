"""Real canonical-reader disk fixtures; no native publication/admission claim."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

repository=Path(__file__).parents[2]
script=repository/'deploy/scripts/online-checkpoint-inventory.py'
reader=repository/'deploy/scripts/recovery-versioned-files.py'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
encode=lambda value:(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()

@unittest.skipUnless(sys.platform=='linux','real canonical mount/uid/O_NOFOLLOW semantics require Linux')
class CanonicalInventory(unittest.TestCase):
 def run_case(self,kind,corrupt=False):
  with tempfile.TemporaryDirectory(prefix='sabalan-checkpoint-inventory-')as temporary:
   root=Path(temporary);root.chmod(0o700)
   def save(file,raw):
    file.parent.mkdir(parents=True,exist_ok=True,mode=0o700);file.write_bytes(raw);file.chmod(0o400)
    return dict(sha256=sha(raw),bytes=len(raw))
   base=save(root/'base/base.tar',b'physical fixture bytes')
   sqlite=save(root/'component/inquiry/inquiry.db',b'SQLite fixture bytes')
   wal=save(root/'receiver/wal/000000010000000000000001',b'complete fixture segment')
   save(root/'receiver/capture-state.json',b'{"fixture":"closed"}\n')
   capture='a'*64;cuts=[];versions=[];object_name='00000000-0000-0000-0000-000000000001'
   for index in range(9):
    store=root/('store-'+str(index));store.mkdir(mode=0o700)
    for part in ('objects','versions','seals'):(store/part).mkdir(mode=0o700)
    heads=[]
    if index==0:
     body=b'' if kind=='PUT' else b'deliberately absent erased ancestor'
     first=dict(format='sabalan-file-version/v1',key='evidence.pdf',generation=1,previousSha256=None,operation='PUT',
       object=dict(name=object_name,sha256=sha(body),bytes=len(body)),live=dict(device='1',inode='4',bytes=str(len(body)),modified='1',changed='1'))
     first_raw=encode(first);first_sha=sha(first_raw);save(store/'versions'/(first_sha+'.json'),first_raw);versions.append(first_sha)
     if kind=='PUT':save(store/'objects'/object_name,b'corrupted'if corrupt else body)
     current=first_sha
     if kind=='DELETE':
      last=dict(format='sabalan-file-version/v1',key='evidence.pdf',generation=2,previousSha256=first_sha,operation='DELETE',object=None,live=None)
      last_raw=encode(last);current=sha(last_raw);save(store/'versions'/(current+'.json'),last_raw);versions.append(current)
     heads=[dict(key='evidence.pdf',sha256=current)]
    cut=dict(format='sabalan-file-version-cut/v2',captureId=capture,gate=dict(device='1',inode='2',ownerUid=os.getuid()),
      source=dict(path=str(root/('live-'+str(index))),device='1',inode=str(index+10)),heads=heads,directories=[])
    raw=encode(cut);save(store/'seals'/(capture+'.json'),raw);cuts.append(dict(name='source-'+str(index),storeRoot=str(store),captureId=capture,sha256=sha(raw)))
   captured=dict(sqliteSnapshot=dict(file='inquiry/inquiry.db',**sqlite),versionedCuts=cuts)
   save(root/'component/captured.json',encode(captured));coverage=dict(physicalBaseProof=dict(archiveSha256=base['sha256'],archiveBytes=base['bytes']))
   save(root/'coverage.json',encode(coverage))
   value=dict(operation=capture,root=str(root),base=str(root/'base'),component=str(root/'component'),captured=captured,
    receiver=dict(segments=[dict(name='000000010000000000000001',**wal)]),coverage=coverage,readerSha256=sha(reader.read_bytes()))
   result=subprocess.run([sys.executable,'-I','-B',str(script)],input=encode(value),capture_output=True)
   if corrupt:
    self.assertNotEqual(result.returncode,0);self.assertFalse((root/'plaintext-components.json').exists());return
   self.assertEqual(result.returncode,0,result.stderr.decode())
   manifest=json.loads((root/'plaintext-components.json').read_bytes())
   self.assertEqual(len([row for row in manifest['sources']if row['role']=='versioned-file-cut']),9)
   self.assertEqual(sorted(row['sha256']for row in manifest['sources']if row['role']=='versioned-file-lineage'),sorted(versions))
   objects=[row for row in manifest['sources']if row['role']=='versioned-file-object']
   self.assertEqual(len(objects),1 if kind=='PUT'else 0)
   if objects:self.assertEqual(objects[0]['bytes'],0)
 def test_actual_canonical_zero_byte_put_object_is_inventoried(self):self.run_case('PUT')
 def test_actual_canonical_delete_preserves_lineage_without_requiring_erased_object(self):self.run_case('DELETE')
 def test_corrupt_actual_object_refuses_manifest_publication(self):self.run_case('PUT',corrupt=True)

if __name__=='__main__':unittest.main()
