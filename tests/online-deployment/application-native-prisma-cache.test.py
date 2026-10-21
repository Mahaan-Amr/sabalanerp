"""Source-only contingency tests: real temp files/hash/FDs, fake process/cache advice."""
import ast
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import types
import unittest

SOURCE = Path(__file__).with_name('application-native-prisma.fixture.py').read_text()
TREE = ast.parse(SOURCE)
FUNCTIONS = [n for n in TREE.body if isinstance(n, ast.FunctionDef)
             and n.name in ('digest', 'inventory', 'hint_prepared_declarations')]


def check(value, code):
    if not value:
        raise RuntimeError(code)


class CacheTests(unittest.TestCase):
    def fixture(self, native_closed=True, bad_pin=False, active=None, advice_error=False):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        base = Path(temp.name)
        root, source, shared = base/'current', base/'qualified', base/'shared'
        roots = [source/'node_modules/@prisma/client', root/'node_modules/@prisma/client', shared]
        contents = {'client.d.ts': b'verified declarations', 'index.js': b'verified generated JS',
                    'engine.so.node': b'verified native engine'}
        for directory in roots:
            directory.mkdir(parents=True)
            for name, raw in contents.items():
                (directory/name).write_bytes(raw)
        advised, held, opened_paths = [], set(), {}
        target = shared/'engine.so.node'
        target_stat = target.stat()
        state = dict(target_hashed=False)

        class Descriptor:
            def stat(self):
                return target.stat()

        class Fds:
            def iterdir(self):
                return [Descriptor()] if active == 'fd' or (active == 'late_fd' and state['target_hashed']) else []

        class Maps:
            def read_text(self):
                if active != 'maps':
                    return ''
                major = os.major(target_stat.st_dev) if hasattr(os, 'major') else 0
                minor = os.minor(target_stat.st_dev) if hasattr(os, 'minor') else 0
                return f'0000-ffff r--p 0000 {major:x}:{minor:x} {target_stat.st_ino} /fixture\n'

        class Process:
            name = '987654321'
            def __truediv__(self, key):
                return Fds() if key == 'fd' else Maps()

        class Proc:
            def iterdir(self):
                if active == 'unreadable': raise PermissionError('fixture census inaccessible')
                return [Process()]

        class Api:
            O_RDONLY = os.O_RDONLY
            O_NOFOLLOW = getattr(os, 'O_NOFOLLOW', 0)
            O_CLOEXEC = getattr(os, 'O_CLOEXEC', 0)
            POSIX_FADV_DONTNEED = 4
            walk = staticmethod(os.walk)
            @staticmethod
            def read(fd, count):
                raw = os.read(fd, count)
                if os.fstat(fd).st_ino == target_stat.st_ino:
                    state['target_hashed'] = True
                return raw
            @staticmethod
            def fstat(fd):
                value = os.fstat(fd)
                if os.name == 'nt':
                    # Test boundary only: Windows named/descriptor device IDs
                    # differ. Production helper remains native Linux-only.
                    fields = {name: getattr(value, name) for name in dir(value) if name.startswith('st_')}
                    fields['st_dev'] = Path(opened_paths[fd]).stat().st_dev
                    fields['st_ctime_ns'] = Path(opened_paths[fd]).stat().st_ctime_ns
                    return types.SimpleNamespace(**fields)
                return value
            getpid = staticmethod(os.getpid)
            getuid = staticmethod(lambda: root.stat().st_uid)
            makedev = staticmethod(os.makedev if hasattr(os, 'makedev') else lambda a,b: target_stat.st_dev)
            @staticmethod
            def open(file, flags):
                self.assertEqual(flags, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_CLOEXEC', 0))
                fd = os.open(file, flags)
                held.add(fd)
                opened_paths[fd] = file
                return fd
            @staticmethod
            def close(fd):
                held.remove(fd)
                os.close(fd)
            @staticmethod
            def posix_fadvise(fd, offset, length, advice):
                self.assertEqual((offset, length, advice), (0, 0, 4))
                if advice_error:
                    raise OSError('fixture advice refusal')
                advised.append(os.fstat(fd).st_ino)

        cgroup = base/'cgroup'; cgroup.mkdir()
        (cgroup/'memory.current').write_text('406708224')
        (cgroup/'memory.max').write_text('805306368')
        (cgroup/'memory.events').write_text('oom 0\n')
        def mapped_path(value):
            if str(value) == '/app/node_modules/@prisma/client': return shared
            if str(value) == '/proc': return Proc()
            if str(value) == '/sys/fs/cgroup': return cgroup
            return Path(value)
        namespace = dict(os=Api, Path=mapped_path, hashlib=hashlib, json=json, stat=stat)
        exec(compile(ast.Module(body=FUNCTIONS, type_ignores=[]), 'actual-contingency-functions', 'exec'), namespace)
        capsule = namespace['inventory'](roots[1], check)
        entries = [dict(target=name, sha256=hashlib.sha256(raw).hexdigest()) for name,raw in contents.items()]
        if bad_pin:
            entries[0]['sha256'] = '0'*64
        receipt = dict(directory=str(source), result=dict(generated=dict(capsule=capsule,
                        linuxArtifact=dict(entries=entries))))
        receipt_raw = json.dumps(receipt).encode()
        (root/'qualified-prisma-receipt.json').write_bytes(receipt_raw)
        (root/'qualified-prisma-capsule.json').write_text(json.dumps(dict(
            receiptSha256=hashlib.sha256(receipt_raw).hexdigest(), sourceRoot=str(source))))
        (root/'initial-migration-coordination').mkdir()
        (root/'initial-migration-coordination/deployment-runtime-native.json').write_text(json.dumps(dict(
            phase='QUIESCENT' if native_closed else 'ACTIVE', nativeStatus=0,
            nativeReaped=native_closed, databaseQuiet=native_closed, stoppedBySignal=False)))
        (root/'index.json').write_text(json.dumps(dict(sharedClientInventory=capsule)))
        before = {str(f): (f.read_bytes(), f.stat().st_ino, f.stat().st_size,
                           f.stat().st_mtime_ns, f.stat().st_mode) for d in roots for f in d.iterdir()}
        return namespace['hint_prepared_declarations'], root, roots, advised, held, before

    def test_all_exact_three_capsules_include_inactive_js_and_engine(self):
        fn, root, roots, advised, held, before = self.fixture()
        result = fn(root, check)
        self.assertEqual(len(advised), 9)
        self.assertEqual(len(result['files']), 9)
        self.assertTrue(any(row['file'].endswith('index.js') for row in result['files']))
        self.assertTrue(any(row['file'].endswith('engine.so.node') for row in result['files']))
        self.assertEqual(result['hintedScope'], 'VERIFIED_INACTIVE_PRISMA_CAPSULE_FILES')
        self.assertFalse(result['cacheCreditUsed'])
        self.assertFalse(result['bytesChanged'])
        self.assertFalse(result['filesDeleted'])
        self.assertFalse(held)
        for file, pin in before.items():
            p = Path(file)
            self.assertEqual((p.read_bytes(), p.stat().st_ino, p.stat().st_size,
                              p.stat().st_mtime_ns, p.stat().st_mode), pin)

    def test_active_engine_open_fd_is_skipped(self):
        fn, root, roots, advised, held, before = self.fixture(active='fd')
        result = fn(root, check)
        self.assertEqual(len(result['files']), 8)
        self.assertNotIn((roots[2]/'engine.so.node').stat().st_ino, advised)
        self.assertFalse(held)

    def test_active_engine_mapping_is_skipped(self):
        fn, root, roots, advised, held, before = self.fixture(active='maps')
        result = fn(root, check)
        self.assertEqual(len(result['files']), 8)
        self.assertNotIn((roots[2]/'engine.so.node').stat().st_ino, advised)
        self.assertFalse(held)

    def test_engine_opened_during_hash_is_skipped_by_fresh_final_census(self):
        fn, root, roots, advised, held, before = self.fixture(active='late_fd')
        result = fn(root, check)
        self.assertEqual(len(result['files']), 8)
        self.assertNotIn((roots[2]/'engine.so.node').stat().st_ino, advised)
        self.assertFalse(held)

    def test_inaccessible_process_census_refuses_without_assuming_absence(self):
        fn, root, roots, advised, held, before = self.fixture(active='unreadable')
        with self.assertRaises(PermissionError):
            fn(root, check)
        self.assertFalse(advised)
        self.assertFalse(held)

    def test_nonquiescent_original_native_refuses_before_advice(self):
        fn, root, roots, advised, held, before = self.fixture(native_closed=False)
        with self.assertRaisesRegex(RuntimeError, 'PRIVATE_DECLARATION_PREPARE_NOT_CLOSED'):
            fn(root, check)
        self.assertFalse(advised)
        self.assertFalse(held)

    def test_wrong_exact_artifact_hash_refuses_and_closes_descriptor(self):
        fn, root, roots, advised, held, before = self.fixture(bad_pin=True)
        with self.assertRaisesRegex(RuntimeError, 'PRIVATE_DECLARATION_HASH_CHANGED'):
            fn(root, check)
        # Directory order varies: earlier verified files may be hinted, but
        # the mismatched file must never receive advice.
        self.assertTrue(all((directory/'client.d.ts').stat().st_ino not in advised
                            for directory in roots))
        self.assertFalse(held)

    def test_advice_error_is_not_success_or_credit(self):
        fn, root, roots, advised, held, before = self.fixture(advice_error=True)
        with self.assertRaisesRegex(OSError, 'fixture advice refusal'):
            fn(root, check)
        self.assertFalse(advised)
        self.assertFalse(held)


if __name__ == '__main__':
    unittest.main()
