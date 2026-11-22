"""V2 immutable-directory reader regression; native disk tests require Linux."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

source=Path(__file__).resolve().parents[2]/'deploy/scripts/recovery-versioned-files.py'
spec=importlib.util.spec_from_file_location('directory_cut_reader',source)
reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)


class MetadataTests(unittest.TestCase):
    def test_v2_preserves_prefix_closed_empty_directory_paths(self):
        self.assertEqual(reader.sealed_directories(dict(format='sabalan-file-version-cut/v2',directories=['.deletion-trash','.deletion-trash/abc','empty'])),
                         ['.deletion-trash','.deletion-trash/abc','empty'])

    def test_unsafe_duplicate_unsorted_nonclosed_or_excess_directories_refused(self):
        for rows in [['a/b'],['b','a'],['a','a'],['../a'],['a\\b'],['a/'],['.sabalan-file-object'],['a']*10000]:
            with self.subTest(rows=rows[:3]),self.assertRaises(RuntimeError):
                reader.sealed_directories(dict(format='sabalan-file-version-cut/v2',directories=rows))

    def test_v1_has_no_inferred_directories(self):
        self.assertEqual(reader.sealed_directories(dict(format='sabalan-file-version-cut/v1')),[])


@unittest.skipUnless(sys.platform=='linux','actual immutable-filesystem restore requires Linux mount/proc custody')
class NativeRestoreTests(unittest.TestCase):
    def setUp(self):
        self.old_umask=os.umask(0o077);self.temporary=tempfile.TemporaryDirectory(prefix='sabalan-directory-cut-')
        self.base=Path(self.temporary.name);self.store=self.base/'store';self.store.mkdir(mode=0o700)
        for name in ['objects','versions','seals']:(self.store/name).mkdir(mode=0o700)
        self.capture='a'*64

    def tearDown(self):
        self.temporary.cleanup();os.umask(self.old_umask)

    def seal(self,version=2,directories=None,heads=None):
        value=dict(format='sabalan-file-version-cut/v'+str(version),captureId=self.capture,
                   gate=dict(device='1',inode='2',ownerUid=os.geteuid()),source=dict(path=str(self.base/'original-live'),device='1',inode='3'),heads=heads or [])
        if directories is not None:value['directories']=directories
        raw=reader.encoded(value);file=self.store/'seals'/('a'*64+'.json');file.write_bytes(raw);file.chmod(0o400)
        return hashlib.sha256(raw).hexdigest()

    def test_actual_restore_empty_directories_and_v2_readback_receipt(self):
        rows=['.deletion-trash','.deletion-trash/actual-owner','empty']
        cut=reader.SealedVersionedFiles(str(self.store),self.capture,self.seal(directories=rows))
        result=cut.restore(str(self.base/'restored'))
        self.assertEqual(result['format'],'sabalan-versioned-file-restore/v2');self.assertEqual(result['directories'],rows)
        for item in rows:
            path=self.base/'restored/files'/item;self.assertTrue(path.is_dir());self.assertEqual(path.stat().st_mode&0o777,0o700)
        self.assertEqual(json.loads((self.base/'restored/complete.json').read_bytes()),result)

    def test_actual_v1_receipt_remains_v1_without_directory_field(self):
        cut=reader.SealedVersionedFiles(str(self.store),self.capture,self.seal(version=1))
        result=cut.restore(str(self.base/'restored'));self.assertEqual(result['format'],'sabalan-versioned-file-restore/v1');self.assertNotIn('directories',result)

    def test_v1_with_extra_directories_is_refused_before_target_creation(self):
        digest=self.seal(version=1,directories=['empty'])
        with self.assertRaisesRegex(RuntimeError,'SEAL_INVALID'):reader.SealedVersionedFiles(str(self.store),self.capture,digest)
        self.assertFalse((self.base/'restored').exists())

    def test_directory_conflicting_with_selected_put_is_refused(self):
        body=b'original';name='00000000-0000-0000-0000-000000000001';(self.store/'objects'/name).write_bytes(body);(self.store/'objects'/name).chmod(0o400)
        value=dict(format='sabalan-file-version/v1',key='empty',generation=1,previousSha256=None,operation='PUT',
                   object=dict(name=name,sha256=hashlib.sha256(body).hexdigest(),bytes=len(body)),live=dict(device='1',inode='4',bytes=str(len(body)),modified='1',changed='1'))
        raw=reader.encoded(value);digest=hashlib.sha256(raw).hexdigest();(self.store/'versions'/(digest+'.json')).write_bytes(raw);(self.store/'versions'/(digest+'.json')).chmod(0o400)
        seal=self.seal(directories=['empty'],heads=[dict(key='empty',sha256=digest)])
        with self.assertRaisesRegex(RuntimeError,'PATH_CONFLICT'):reader.SealedVersionedFiles(str(self.store),self.capture,seal)


if __name__=='__main__':unittest.main()
