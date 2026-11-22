import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest

assert sys.platform == 'linux'
os.umask(0o077)
root = Path(sys.argv.pop(1)).resolve(strict=True)
spec = importlib.util.spec_from_file_location('native_sealer', root / 'native-versioned-file-sealer.py')
sealer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sealer)


class NativeSealerInput(unittest.TestCase):
    def setUp(self):
        self.directory = root / self._testMethodName
        self.directory.mkdir(mode=0o700)
        self.store = self.directory / 'store'
        self.store.mkdir(mode=0o700)
        self.script = self.directory / 'seal.cjs'
        self.script.write_bytes(b"throw new Error('MUST_NOT_EXECUTE');\n")
        self.script.chmod(0o400)
        stat = self.store.stat()
        self.configuration = dict(script=str(self.script), sha256=hashlib.sha256(self.script.read_bytes()).hexdigest(),
                                  stores=[dict(name='uploads', device=str(stat.st_dev), inode=str(stat.st_ino))])
        self.sources = [dict(name='uploads', storeRoot=str(self.store))]

    def test_exact_immutable_program_and_store_are_enrolled(self):
        script, identity = sealer.program(self.configuration, self.sources)
        self.assertEqual(script, str(self.script))
        self.assertEqual(identity, sealer.identity(self.script.lstat()))

    def test_substituted_script_bytes_refuse(self):
        self.configuration['sha256'] = 'a' * 64
        self.assertRaises(RuntimeError, sealer.program, self.configuration, self.sources)

    def test_mutable_script_refuses(self):
        self.script.chmod(0o600)
        self.assertRaises(RuntimeError, sealer.program, self.configuration, self.sources)

    def test_substituted_store_incarnation_refuses(self):
        self.configuration['stores'][0]['inode'] = str(int(self.configuration['stores'][0]['inode']) + 1)
        self.assertRaises(RuntimeError, sealer.program, self.configuration, self.sources)

    def test_store_alias_refuses(self):
        alias = self.directory / 'alias'
        alias.symlink_to(self.store, target_is_directory=True)
        self.sources[0]['storeRoot'] = str(alias)
        self.assertRaises(RuntimeError, sealer.program, self.configuration, self.sources)

    def test_shared_program_directory_refuses(self):
        self.directory.chmod(0o755)
        self.assertRaises(RuntimeError, sealer.program, self.configuration, self.sources)

    def test_wrong_source_enrollment_refuses(self):
        self.configuration['stores'][0]['name'] = 'another-root'
        self.assertRaises(RuntimeError, sealer.program, self.configuration, self.sources)

    def test_missing_native_descriptor_set_never_launches_node(self):
        fd = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            self.assertRaises(RuntimeError, sealer.run, self.directory / 'scope.json', 'a' * 64,
                              dict(sealer=self.configuration, sources=self.sources), (9, 10), fd)
        finally:
            os.close(fd)
        self.assertFalse((self.directory / 'sealer.stdout').exists())
        self.assertFalse((self.directory / 'sealer.stderr').exists())


unittest.main()
