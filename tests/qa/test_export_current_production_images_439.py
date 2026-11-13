"""File-only proof tests for the #439 one-use exporter; no SSH or Docker."""
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('export439', ROOT / 'scripts/qa/export-current-production-images-439.py')
EXPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXPORT)


def pack(entries):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w') as archive:
        for name, content in entries:
            info = tarfile.TarInfo(name)
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))
    return output.getvalue()


def archive_fixture(diff_override=None, secret_path=False):
    layer = pack([('.env.prod' if secret_path else 'app/ready.txt', b'ready')])
    compressed = gzip.compress(layer, mtime=0)
    digest = lambda content: 'sha256:' + hashlib.sha256(content).hexdigest()
    diff = diff_override or digest(layer)
    config = json.dumps({'os':'linux','architecture':'amd64','rootfs':{'type':'layers','diff_ids':[diff]},
                         'config':{'Env':['PATH=/usr/bin']},'history':[]}, separators=(',', ':')).encode()
    manifest = json.dumps({'schemaVersion':2,'config':{'digest':digest(config),'size':len(config)},
                           'layers':[{'digest':digest(compressed),'size':len(compressed),
                                      'mediaType':'application/vnd.oci.image.layer.v1.tar+gzip'}]}, separators=(',', ':')).encode()
    index = json.dumps({'schemaVersion':2,'manifests':[{'digest':digest(manifest),'size':len(manifest),
                         'platform':{'os':'linux','architecture':'amd64'}}]}, separators=(',', ':')).encode()
    blob = lambda content: ('blobs/sha256/' + digest(content)[7:], content)
    compat = json.dumps([{'Config':blob(config)[0],'Layers':[blob(compressed)[0]]}]).encode()
    return pack([blob(index), blob(manifest), blob(config), blob(compressed), ('manifest.json', compat)]), digest(index)


class ExportProofTests(unittest.TestCase):
    def proof(self, data, image):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'image.docker.tar'
            path.write_bytes(data)
            return EXPORT.oci_proof(path, image)

    def test_accepts_matching_full_oci_graph_and_expanded_layer(self):
        data, image = archive_fixture()
        proof = self.proof(data, image)
        self.assertEqual(proof['index'], image)
        self.assertEqual(proof['archiveSha256'], hashlib.sha256(data).hexdigest())

    def test_rejects_false_rootfs_diff_id_even_with_valid_blob_hashes(self):
        data, image = archive_fixture('sha256:' + '0' * 64)
        with self.assertRaisesRegex(EXPORT.ExportGuardError, 'ROOTFS_DIFF_ID_MISMATCH'):
            self.proof(data, image)

    def test_rejects_embedded_private_environment_file(self):
        data, image = archive_fixture(secret_path=True)
        with self.assertRaisesRegex(EXPORT.ExportGuardError, 'EMBEDDED_SECRET_PATH'):
            self.proof(data, image)

    def test_rejects_other_common_secret_paths(self):
        for name in ('app/.env.local', 'app/secrets/value', 'app/service-account.json',
                     'app/client.pem', 'home/user/.kube/config'):
            with self.subTest(name=name):
                self.assertTrue(EXPORT.secret_path(name))

    def test_guards_remain_active_under_python_optimization(self):
        script = ROOT / 'scripts/qa/export-current-production-images-439.py'
        code = ("import importlib.util; p=" + repr(str(script)) + "; "
                "s=importlib.util.spec_from_file_location('export439',p); "
                "m=importlib.util.module_from_spec(s); s.loader.exec_module(m); "
                "m.require(False,'OPTIMIZED_GUARD_ACTIVE')")
        result = subprocess.run([sys.executable, '-O', '-c', code], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('OPTIMIZED_GUARD_ACTIVE', result.stderr)
        self.assertNotIn('assert ', EXPORT.SOURCE)


class FakeSSH:
    def __init__(self, output, stderr=b''):
        self.stdout = io.BytesIO(output)
        self.stderr = io.BytesIO(stderr)
        self.returncode = 0

    def wait(self, timeout=None):
        return self.returncode

    def poll(self):
        return self.returncode


class TransferTests(unittest.TestCase):
    def test_unencrypted_stage_stops_before_contacting_production(self):
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(EXPORT, 'require_efs', side_effect=EXPORT.ExportGuardError('EFS_REQUIRED')):
                with mock.patch.object(EXPORT.subprocess, 'Popen') as popen:
                    with self.assertRaisesRegex(EXPORT.ExportGuardError, 'EFS_REQUIRED'):
                        EXPORT.stream_one(Path(directory), 'backend', EXPORT.IMAGES['backend'], 0)
            popen.assert_not_called()

    def test_unencrypted_archive_stops_before_contacting_production(self):
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            def verify(path):
                if path.name.endswith('.partial'):
                    raise EXPORT.ExportGuardError('EFS_REQUIRED')
            with mock.patch.object(EXPORT, 'require_efs', side_effect=verify):
                with mock.patch.object(EXPORT.subprocess, 'Popen') as popen:
                    with self.assertRaisesRegex(EXPORT.ExportGuardError, 'EFS_REQUIRED'):
                        EXPORT.stream_one(stage, 'backend', EXPORT.IMAGES['backend'], 0)
            popen.assert_not_called()
            self.assertEqual(list(stage.iterdir()), [])

    def test_failed_stage_is_removed_for_clean_rerun(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / 'complete-images'
            stage = Path(directory) / 'complete-images.staging-run123'
            stage.mkdir()
            (stage / 'backend.docker.tar').write_bytes(b'earlier image')
            (stage / 'frontend.docker.tar.partial').write_bytes(b'failed image')
            with mock.patch.object(EXPORT, 'DEST', destination):
                EXPORT.discard_incomplete_stage(stage)
            self.assertFalse(stage.exists())
            self.assertFalse(destination.exists())

    def test_archive_size_limit_removes_partial_file(self):
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            with mock.patch.object(EXPORT, 'require_efs'):
                with mock.patch.object(EXPORT.subprocess, 'Popen', return_value=FakeSSH(b'abc')):
                    with mock.patch.object(EXPORT, 'MAX_ARCHIVE_BYTES', 2):
                        with self.assertRaisesRegex(EXPORT.ExportGuardError, 'ARCHIVE_SIZE_LIMIT_EXCEEDED'):
                            EXPORT.stream_one(stage, 'backend', EXPORT.IMAGES['backend'], 0)
            self.assertEqual(list(stage.iterdir()), [])

    def test_large_stderr_is_drained_and_bounded_while_stdout_streams(self):
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            source = {'selected':EXPORT.IMAGES['backend'], 'before':{'service':1},
                      'after':{'service':1}, 'capacity':EXPORT.SOURCE_RESERVE,
                      'rootfsDiffIds':['sha256:' + '1' * 64]}
            source['before'] = {str(i):i for i in range(6)}
            source['after'] = source['before'].copy()
            stderr = b'x' * (1024 * 1024) + b'\nSABALAN439_PROOF=' + json.dumps(source).encode() + b'\n'
            fake = FakeSSH(b'a' * 2048, stderr)
            with mock.patch.object(EXPORT, 'require_efs'):
                with mock.patch.object(EXPORT.subprocess, 'Popen', return_value=fake):
                    with mock.patch.object(EXPORT, 'D_RESERVE', 0):
                        with mock.patch.object(EXPORT, 'oci_proof', return_value={'rootfsDiffIds':source['rootfsDiffIds']}):
                            row = EXPORT.stream_one(stage, 'backend', EXPORT.IMAGES['backend'], 0)
            self.assertEqual(row['bytes'], 2048)
            self.assertTrue((stage / 'backend.docker.tar').exists())


if __name__ == '__main__':
    unittest.main()
