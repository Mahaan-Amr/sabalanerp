"""Exercise the fixture's source-owned export API without starting its native entry."""
import ast
import hashlib
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


def fixture_api():
    tree = ast.parse((HERE / 'application-native.fixture.py').read_bytes())
    names = {'export_identity', 'publish_runtime_export', 'retire_runtime_exports'}
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    def check(ok, code):
        if not ok:
            raise RuntimeError(code)
    def write(path, data):
        with path.open('xb') as out:
            out.write(data)
    ns = dict(Path=Path, os=os, stat=stat, re=re, hashlib=hashlib, check=check, write=write)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'fixture-export-api', 'exec'), ns)
    return ns


class ExportRetirement(unittest.TestCase):
    def test_live_original_retains_exports_then_same_closed_original_permits_retirement(self):
        api = fixture_api()
        with tempfile.TemporaryDirectory() as folder:
            authority = Path(folder)
            key = authority / 'qualification-controller-public-key.pem'
            key.write_bytes(b'public-trust')
            owned = api['publish_runtime_export'](authority, 'a' * 64, b'original-scope')
            child = subprocess.Popen([sys.executable, '-I', '-B', '-c', 'import sys; sys.stdin.buffer.read()'],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            def closed():
                if child.poll() is None:
                    raise RuntimeError('READERS_UNKNOWN')
            try:
                with self.assertRaisesRegex(RuntimeError, 'READERS_UNKNOWN'):
                    api['retire_runtime_exports'](authority, [owned], closed)
                self.assertEqual((authority / owned['name']).read_bytes(), b'original-scope')
            finally:
                child.communicate()
            receipt = api['retire_runtime_exports'](authority, [owned], closed)
            self.assertEqual(sorted(p.name for p in authority.iterdir()), [key.name])
            self.assertEqual(key.read_bytes(), b'public-trust')
            self.assertEqual(receipt['retired'][0]['sha256'], hashlib.sha256(b'original-scope').hexdigest())
            self.assertFalse(receipt['productionAdmission'])
            self.assertFalse(receipt['timestampsRestored'])
            self.assertEqual(receipt['directoryAfter'], api['export_identity'](authority.stat()))
            with self.assertRaises((RuntimeError, FileNotFoundError)):
                api['retire_runtime_exports'](authority, [owned], closed)

    def test_polluted_namespace_retains_every_owned_export_and_foreign_entry(self):
        api = fixture_api()
        with tempfile.TemporaryDirectory() as folder:
            authority = Path(folder)
            entries = [api['publish_runtime_export'](authority, digit * 64, digit.encode()) for digit in ['a', 'b']]
            unknown = authority / ('c' * 64 + '.json')
            unknown.write_bytes(b'unknown-reader')
            with self.assertRaisesRegex(RuntimeError, 'NAMESPACE_POLLUTED'):
                api['retire_runtime_exports'](authority, entries, lambda: None)
            self.assertEqual(len(list(authority.iterdir())), 3)
            self.assertEqual(unknown.read_bytes(), b'unknown-reader')

    def test_changed_later_export_refuses_before_any_deletion(self):
        api = fixture_api()
        for change in ['bytes', 'inode', 'hardlink', 'timestamp']:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as folder:
                authority = Path(folder)
                entries = [api['publish_runtime_export'](authority, digit * 64, digit.encode()) for digit in ['a', 'b']]
                later = authority / entries[1]['name']
                if change == 'bytes':
                    later.write_bytes(b'changed')
                elif change == 'inode':
                    later.rename(authority / 'held-original')
                    later.write_bytes(b'b')
                    (authority / 'held-original').unlink()
                elif change == 'hardlink':
                    # Keep link outside the enumerated namespace, testing nlink itself.
                    with tempfile.TemporaryDirectory() as other:
                        os.link(later, Path(other) / 'alias')
                        with self.assertRaisesRegex(RuntimeError, 'IDENTITY_CHANGED'):
                            api['retire_runtime_exports'](authority, entries, lambda: None)
                        self.assertTrue((authority / entries[0]['name']).exists())
                    continue
                else:
                    value = later.stat()
                    os.utime(later, ns=(value.st_atime_ns, value.st_mtime_ns + 1000000000))
                with self.assertRaisesRegex(RuntimeError, 'IDENTITY_CHANGED|BYTES_CHANGED'):
                    api['retire_runtime_exports'](authority, entries, lambda: None)
                self.assertTrue((authority / entries[0]['name']).exists())
                self.assertTrue(later.exists())

    def test_recheck_of_original_readers_precedes_deletion(self):
        api = fixture_api()
        with tempfile.TemporaryDirectory() as folder:
            authority = Path(folder)
            entry = api['publish_runtime_export'](authority, 'a' * 64, b'scope')
            observations = []
            def closed():
                observations.append(1)
                if len(observations) == 2:
                    raise RuntimeError('READERS_UNKNOWN')
            with self.assertRaisesRegex(RuntimeError, 'READERS_UNKNOWN'):
                api['retire_runtime_exports'](authority, [entry], closed)
            self.assertTrue((authority / entry['name']).exists())


if __name__ == '__main__':
    unittest.main()
