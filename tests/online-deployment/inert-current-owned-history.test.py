"""Pure streaming-file policy tests; no runtime, Docker, or historical data writes."""
import hashlib
import pathlib
import runpy
import stat
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

SOURCE = pathlib.Path(__file__).with_name('inert-history-acceptance.fixture.py')
# Windows cannot import fcntl. File hashing tests never take a lock or run main.
lock_stub = types.SimpleNamespace(LOCK_EX=2, LOCK_NB=4)
with patch.dict(sys.modules, {'fcntl': lock_stub}):
    module = runpy.run_path(str(SOURCE))

BIG = '/app/online-runtime-acceptance/application-native-1cc175018d9d712991bdf4ee45d2593e/full-catalog/backend/node_modules/@prisma/client/index.d.ts'
SECOND_BIG = '/app/online-runtime-acceptance/application-native-1cc175018d9d712991bdf4ee45d2593e/node_modules/@prisma/client/index.d.ts'
SIZE = 52193462
CHUNK = b'\0' * (512 * 1024)

def zero_sha(size):
    digest = hashlib.sha256()
    while size:
        data = CHUNK[:min(size, len(CHUNK))]
        digest.update(data)
        size -= len(data)
    return digest.hexdigest()

class StreamingTests(unittest.TestCase):
    def setUp(self):
        # The helper runs on Linux. These process-local test shims only let its
        # readonly flags be evaluated by Windows' mocked stream operations.
        self.flags = patch.multiple(module['os'], O_NOFOLLOW=getattr(module['os'], 'O_NOFOLLOW', 0),
                                    O_CLOEXEC=getattr(module['os'], 'O_CLOEXEC', 0), create=True)
        self.flags.start()
        self.addCleanup(self.flags.stop)

    def hash_function(self):
        self.assertIn('hash_file', module, 'Exact streaming helper must replace whole-file inventory reads')
        return module['hash_file']

    def stream(self, *, path=BIG, allow=True, bytes_delta=0, allowance_change=None, descriptor_drift=False):
        function = self.hash_function()
        expected = {'path': 'full-catalog/backend/node_modules/@prisma/client/index.d.ts', 'type': 'file',
                    'bytes': SIZE, 'sha256': zero_sha(SIZE)}
        exception = {'bytes': SIZE, 'sha256': expected['sha256']}
        if allowance_change:
            allowance_change(exception)
        spec = {'largeFiles': {BIG: dict(exception), SECOND_BIG: dict(exception)} if allow else {}}
        before = types.SimpleNamespace(st_dev=1, st_ino=2, st_uid=0, st_gid=0, st_mode=stat.S_IFREG | 0o400,
                                       st_nlink=1, st_size=SIZE, st_mtime_ns=1, st_ctime_ns=1)
        changed = types.SimpleNamespace(**vars(before))
        changed.st_ino = 3
        class SyntheticLinuxFile(pathlib.PurePosixPath):
            def lstat(self): return before
            def resolve(self, strict=False): return self
        remaining = SIZE + bytes_delta
        reads = []
        def read(fd, bound):
            nonlocal remaining
            self.assertEqual(fd, 71)
            self.assertLessEqual(bound, 1024 * 1024)
            reads.append(bound)
            length = min(bound, remaining)
            remaining -= length
            return CHUNK[:length]
        stats = [before, changed] if descriptor_drift else [before, before]
        with patch.dict(function.__globals__, {'noalias': lambda file, directory=False: before,
                                              'ROOT': pathlib.PurePosixPath('/app/online-runtime-acceptance')}), \
             patch.object(module['os'], 'open', return_value=71) as opened, \
             patch.object(module['os'], 'fstat', side_effect=lambda fd: stats.pop(0) if len(stats) > 1 else stats[0]), \
             patch.object(module['os'], 'read', side_effect=read), \
             patch.object(module['os'], 'close') as closed:
            result = function(SyntheticLinuxFile(path), expected, spec)
            self.assertEqual(result, expected['sha256'])
            self.assertEqual(opened.call_count, 1)
            flags = opened.call_args.args[1]
            self.assertEqual(flags & module['os'].O_WRONLY, 0)
            self.assertFalse(flags & module['os'].O_CREAT)
            closed.assert_called_once_with(71)
            self.assertGreater(len(reads), 16)

    def test_exact_large_file_streams_with_bounded_memory(self):
        # Synthetic zero stream checks I/O, not the historical d018 digest.
        # The Node test separately pins the real literal path/size/d018 policy.
        self.stream()

    def test_second_exact_large_file_streams_with_bounded_memory(self):
        self.stream(path=SECOND_BIG)

    def test_unlisted_large_file_is_refused(self):
        with self.assertRaises(AssertionError): self.stream(allow=False)

    def test_same_large_bytes_at_other_path_are_refused(self):
        with self.assertRaises(AssertionError): self.stream(path=BIG + '.other')

    def test_changed_allowance_size_is_refused(self):
        with self.assertRaises(AssertionError): self.stream(allowance_change=lambda value: value.update(bytes=SIZE + 1))

    def test_changed_allowance_digest_is_refused(self):
        with self.assertRaises(AssertionError): self.stream(allowance_change=lambda value: value.update(sha256='0' * 64))

    def test_truncated_large_file_is_refused(self):
        with self.assertRaises(AssertionError): self.stream(bytes_delta=-1)

    def test_extra_byte_is_refused(self):
        with self.assertRaises(AssertionError): self.stream(bytes_delta=1)

    def test_changed_descriptor_is_refused(self):
        with self.assertRaises(AssertionError): self.stream(descriptor_drift=True)

    def test_normal_small_file_uses_default_policy(self):
        function = self.hash_function()
        with tempfile.TemporaryDirectory(prefix='inert-hash-pure-') as directory:
            file = pathlib.Path(directory) / 'small-owned-file'
            file.write_bytes(b'small exact file')
            expected = {'path': file.name, 'type': 'file', 'bytes': file.stat().st_size,
                        'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}
            # Windows reports different descriptor stat metadata than Linux.
            # Descriptor-change rejection is separately tested on the Linux shim.
            with patch.object(module['os'], 'fstat', side_effect=lambda fd: file.lstat()):
                self.assertEqual(function(file, expected, {'largeFiles': {}}), expected['sha256'])

    def test_real_hardlinked_file_is_not_a_valid_inventory_input(self):
        function = self.hash_function()
        with tempfile.TemporaryDirectory(prefix='inert-linked-pure-') as directory:
            file = pathlib.Path(directory) / 'original'
            file.write_bytes(b'owned isolated test')
            linked = pathlib.Path(directory) / 'linked'
            module['os'].link(file, linked)
            self.assertEqual(file.stat().st_nlink, 2)
            expected = {'path': file.name, 'type': 'file', 'bytes': file.stat().st_size,
                        'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}
            with self.assertRaisesRegex(AssertionError, 'HISTORY_LINK_COUNT'):
                function(file, expected, {'largeFiles': {}})

if __name__ == '__main__': unittest.main()
