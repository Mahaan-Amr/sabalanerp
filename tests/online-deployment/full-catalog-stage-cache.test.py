"""Exercise the actual stage hint without importing the executable receiver."""
import ast
import hashlib
import os
from pathlib import Path
import stat
import tempfile
import types
import unittest


SOURCE = Path(__file__).with_name('full-catalog-stage.fixture.py').read_text()
FUNCTIONS = [node for node in ast.parse(SOURCE).body
             if isinstance(node, ast.FunctionDef) and node.name in ('check', 'hint_staged_file')]


def load(api):
    namespace = dict(os=api, stat=stat)
    exec(compile(ast.Module(body=FUNCTIONS, type_ignores=[]), 'actual-stage-hint', 'exec'), namespace)
    return namespace['hint_staged_file']


def metadata(**changes):
    values = dict(st_dev=1, st_ino=2, st_uid=100, st_gid=100,
                  st_mode=stat.S_IFREG | 0o400, st_nlink=1, st_size=4096,
                  st_mtime_ns=3, st_ctime_ns=4)
    values.update(changes)
    return types.SimpleNamespace(**values)


class HintTests(unittest.TestCase):
    def fixture(self, *, named=None, after=None, advice_error=None):
        original = metadata()
        events = []

        class Api:
            O_RDONLY, O_NOFOLLOW, O_CLOEXEC, POSIX_FADV_DONTNEED = 0, 8, 16, 4

            def getuid(self):
                return 100

            def open(self, target, flags):
                self.assert_flags = flags
                events.append(('open', flags))
                return 7

            def fstat(self, fd):
                self.calls = getattr(self, 'calls', 0) + 1
                events.append(('fstat', fd))
                return after if self.calls > 1 and after is not None else original

            def posix_fadvise(self, fd, offset, length, advice):
                events.append(('advise', fd, offset, length, advice))
                if advice_error:
                    raise advice_error

            def close(self, fd):
                events.append(('close', fd))

        class Target:
            def lstat(self):
                events.append(('named',))
                return named if named is not None else original

        api = Api()
        return load(api), Target(), original, events

    def test_exact_readonly_descriptor_is_hinted_and_closed(self):
        hint, target, original, events = self.fixture()
        hint(target, original)
        self.assertEqual(events, [('open', 24), ('fstat', 7), ('named',),
                                  ('advise', 7, 0, 0, 4), ('fstat', 7),
                                  ('named',), ('close', 7)])

    def test_changed_named_identity_or_ownership_refuses_before_hint(self):
        for changed in (metadata(st_ino=9), metadata(st_uid=0),
                        metadata(st_nlink=2), metadata(st_mode=stat.S_IFREG | 0o600)):
            with self.subTest(changed=changed):
                hint, target, original, events = self.fixture(named=changed)
                with self.assertRaisesRegex(RuntimeError, 'CATALOG_STAGE_CACHE_IDENTITY'):
                    hint(target, original)
                self.assertFalse(any(row[0] == 'advise' for row in events))
                self.assertEqual(events[-1], ('close', 7))

    def test_metadata_change_after_hint_still_fails_and_closes(self):
        hint, target, original, events = self.fixture(after=metadata(st_size=1))
        with self.assertRaisesRegex(RuntimeError, 'CATALOG_STAGE_CACHE_METADATA_CHANGED'):
            hint(target, original)
        self.assertEqual(events[-1], ('close', 7))

    def test_advisory_error_is_not_success_or_cache_credit(self):
        hint, target, original, events = self.fixture(advice_error=OSError('unsupported'))
        with self.assertRaisesRegex(OSError, 'unsupported'):
            hint(target, original)
        self.assertEqual(events[-1], ('close', 7))

    @unittest.skipUnless(hasattr(os, 'posix_fadvise') and hasattr(os, 'O_NOFOLLOW'),
                         'real advisory descriptor test requires Linux')
    def test_real_linux_file_bytes_and_metadata_remain_exact(self):
        hint = load(os)
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'verified-source.js'
            raw = b'checked source\n' * 262144
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
            try:
                with os.fdopen(os.dup(fd), 'wb') as stream:
                    stream.write(raw)
                    stream.flush()
                    os.fsync(stream.fileno())
                original = os.fstat(fd)
                hint(target, original)
                self.assertEqual(os.fstat(fd), original)
            finally:
                os.close(fd)
            self.assertEqual(hashlib.sha256(target.read_bytes()).digest(),
                             hashlib.sha256(raw).digest())
            self.assertEqual(target.lstat().st_mode & 0o777, 0o400)
            # No assertion infers reclaimed pages or runtime admission from a hint.


if __name__ == '__main__':
    unittest.main()
