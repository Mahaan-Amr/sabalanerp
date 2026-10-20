import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('original_online_layout',Path(__file__).with_name('independent-online-layout.fixture.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class PhysicalExtraction(unittest.TestCase):
    def archive(self,root,extra=None):
        file=root/'base.tar'
        with tarfile.open(file,'w:') as output:
            for name,content in [('PG_VERSION',b'15\n'),('backup_manifest',b'{"Files":[]}'),('global/pg_control',b'actual-control-byte-fixture')]:
                entry=tarfile.TarInfo(name);entry.size=len(content);output.addfile(entry,io.BytesIO(content))
            if extra:extra(output)
        return file

    def test_actual_bounded_raw_extraction_preserves_bytes_without_claiming_native_pg_health(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();target=root/'data';target.mkdir();archive=self.archive(root)
            result=module.extract_physical_base(archive,target,archive.stat().st_size)
            self.assertEqual((target/'global/pg_control').read_bytes(),b'actual-control-byte-fixture')
            self.assertEqual(result['files'],3);self.assertNotIn('physicalReplayQualified',result)

    def test_unsafe_tar_links_traversal_and_duplicates_refuse_before_any_extraction(self):
        def link(output):
            item=tarfile.TarInfo('foreign');item.type=tarfile.SYMTYPE;item.linkname='/etc/passwd';output.addfile(item)
        def traversal(output):
            item=tarfile.TarInfo('../foreign');item.size=1;output.addfile(item,io.BytesIO(b'x'))
        def duplicate(output):
            item=tarfile.TarInfo('PG_VERSION');item.size=3;output.addfile(item,io.BytesIO(b'15\n'))
        for extra in (link,traversal,duplicate):
            with self.subTest(extra=extra),tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();target=root/'data';target.mkdir();archive=self.archive(root,extra)
                with self.assertRaises(RuntimeError):module.extract_physical_base(archive,target,archive.stat().st_size)
                self.assertEqual(list(target.iterdir()),[])

    def test_measured_expansion_cap_refuses_before_any_write(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();target=root/'data';target.mkdir();archive=self.archive(root)
            with self.assertRaisesRegex(RuntimeError,'PG_EXPANSION_BOUND'):module.extract_physical_base(archive,target,1)
            self.assertEqual(list(target.iterdir()),[])


if __name__=='__main__':unittest.main()
