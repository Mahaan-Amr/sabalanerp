"""Physical Linux file-channel checks. No native/COMPLETE authority."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
if 'MAT_SOURCE' in globals():
    material = types.ModuleType('material_component')
    exec(compile(MAT_SOURCE, 'original-complete-material-reader.py', 'exec'), material.__dict__)
else:
    spec = importlib.util.spec_from_file_location('material_component', Path(__file__).resolve().parents[2] / 'deploy/scripts/original-complete-material-reader.py')
    material = importlib.util.module_from_spec(spec); spec.loader.exec_module(material)

@unittest.skipUnless(sys.platform == 'linux' and os.getuid() == 0, 'Requires actual root Linux inode/mode semantics')
class ActualMaterialChannel(unittest.TestCase):
    def request(self, kind, parent=None, namespace=None, **extra):
        return dict(operation='a'*32, kind=kind, parent=parent, namespace=namespace, **extra)

    def test_fixed_file_exchange_latches_real_namespace_and_durable_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory); parent.chmod(0o700); root = parent/'material'
            absent = material.exchange(root, self.request('read-request'))
            self.assertIsNone(absent['namespace']); root.mkdir(mode=0o700)
            raw = b'{"public":"request"}\n'
            written = material.exchange(root, self.request('write-request', absent['parent'], writeBase64=base64.b64encode(raw).decode()))
            result = material.exchange(root, self.request('read-request', written['parent'], written['namespace']))
            self.assertEqual(result, written); self.assertEqual(base64.b64decode(result['value']['rawBase64']), raw)
            with self.assertRaises(FileExistsError): material.exchange(root, self.request('write-request', writeBase64=base64.b64encode(raw).decode()))
            ack = material.exchange(root, self.request('read-ack', result['parent'], result['namespace']))
            self.assertIsNone(ack['value'])

    def test_namespace_replacement_mode_hardlink_symlink_and_path_selectors_are_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory); parent.chmod(0o700); root = parent/'material'; root.mkdir(mode=0o700)
            first = material.exchange(root, self.request('read-request'))
            root.rename(parent/'held-original'); root.mkdir(mode=0o700)
            with self.assertRaises(RuntimeError): material.exchange(root, self.request('read-request', first['parent'], first['namespace']))
            with self.assertRaises(RuntimeError): material.exchange(root, self.request('read-request', command='override'))
            file = root/material.NAMES['request']; file.write_bytes(b'{}'); file.chmod(0o600)
            with self.assertRaises(RuntimeError): material.exchange(root, self.request('read-request'))
            file.chmod(0o400); os.link(file, root/'held-link')
            with self.assertRaises(RuntimeError): material.exchange(root, self.request('read-request'))
            (root/'held-link').unlink(); file.rename(root/'held-file'); file.symlink_to(root/'held-file')
            with self.assertRaises(RuntimeError): material.exchange(root, self.request('read-request'))

    def test_application_is_read_only_and_missing_artifact_is_negative(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory); parent.chmod(0o700); root = parent/'material'; root.mkdir(mode=0o700)
            with self.assertRaises(RuntimeError): material.exchange(root, self.request('read-application'))
            file = root/material.NAMES['application']; file.write_bytes(b'{"application":"modeled"}'); file.chmod(0o400)
            result = material.exchange(root, self.request('read-application')); self.assertEqual(result['value']['bytes'], file.stat().st_size)
            with self.assertRaises(RuntimeError): material.exchange(root, self.request('write-application', writeBase64='e30='))
            self.assertEqual(base64.b64decode(result['value']['rawBase64']), file.read_bytes())

    def test_private_write_fields_and_operation_are_exact(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory); parent.chmod(0o700); root = parent/'material'; root.mkdir(mode=0o700)
            for changes in [dict(operation='../foreign'), dict(kind='read-request', writeBase64='e30='), dict(kind='write-request'), dict(path='/foreign')]:
                req = self.request('read-request'); req.update(changes)
                with self.assertRaises(RuntimeError): material.exchange(root, req)
            self.assertEqual(list(root.iterdir()), [])
