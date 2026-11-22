import ast
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest

fixture = Path(__file__).with_name('historical-capsule-preflight.fixture.py')
tree = ast.parse(fixture.read_bytes())
selected = [node for node in tree.body if isinstance(node, ast.FunctionDef)
            and node.name in ['check', 'digest', 'identity', 'read', 'native', 'original_inventory']]
namespace = dict(ast=ast, hashlib=hashlib, json=json, os=os, Path=Path, stat=stat)
exec(compile(ast.Module(body=selected, type_ignores=[]), str(fixture), 'exec'), namespace)


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()

    def tearDown(self):
        self.temp.cleanup()

    def test_extracted_original_inventory_serializes_real_files(self):
        source = fixture.with_name('application-native-prisma.fixture.py').read_bytes()
        self.assertEqual(hashlib.sha256(source).hexdigest(),
                         '7af630e015aaf87872823b3f4e41bdfccd23214c356432604a7c149dcb347a79')
        (self.root / 'client.js').write_bytes(b'client')
        rows = [dict(path='client.js', bytes=6, sha256=hashlib.sha256(b'client').hexdigest())]
        expected = dict(files=1, bytes=6, sha256=hashlib.sha256(
            json.dumps(rows, sort_keys=True, separators=(',', ':')).encode()).hexdigest())
        inventory = namespace['original_inventory'](source)
        self.assertEqual(inventory(self.root, namespace['check']), expected)

    def test_hidden_historical_root_cannot_pass_preflight(self):
        for name in ['application-prisma-ebcfd40fff0a28e39d983c6616893b50',
                     'inquiry-coherent-7878c93646acd9ac37cef95e27a4029d']:
            with self.assertRaises(FileNotFoundError):
                namespace['identity'](self.root / name, True)

    def test_original_read_returns_exact_regular_content(self):
        file = self.root / 'proof.json'
        file.write_bytes(b'{"proof":true}')
        self.assertEqual(namespace['read'](file), file.read_bytes())

    def test_directory_cannot_substitute_for_proof(self):
        with self.assertRaisesRegex(AssertionError, 'CAPSULE_TYPE'):
            namespace['read'](self.root)

    def test_hardlinked_proof_refuses(self):
        file = self.root / 'proof.json'
        file.write_bytes(b'{}')
        os.link(file, self.root / 'alias.json')
        with self.assertRaisesRegex(AssertionError, 'CAPSULE_LINK_COUNT'):
            namespace['read'](file)

    def test_native_proof_hash_and_quiet_flags_are_required(self):
        file = self.root / 'native.json'
        value = dict(phase='QUIESCENT', nativeReaped=True, sqliteNativeClosed=True,
                     guardian=dict(pid=2147483647))
        raw = json.dumps(value).encode()
        file.write_bytes(raw)
        self.assertEqual(namespace['native'](file, hashlib.sha256(raw).hexdigest()), raw)
        with self.assertRaisesRegex(AssertionError, 'CAPSULE_NATIVE_CLOSURE_CHANGED'):
            namespace['native'](file, '0' * 64)
        value['nativeReaped'] = False
        raw = json.dumps(value).encode()
        file.write_bytes(raw)
        with self.assertRaisesRegex(AssertionError, 'CAPSULE_NATIVE_CLOSURE_CHANGED'):
            namespace['native'](file, hashlib.sha256(raw).hexdigest())


if __name__ == '__main__':
    unittest.main()
