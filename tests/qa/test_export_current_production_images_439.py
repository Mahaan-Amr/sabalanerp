"""File-only proof tests for the #439 one-use exporter; no SSH or Docker."""
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest


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
        with self.assertRaisesRegex(AssertionError, 'ROOTFS_DIFF_ID_MISMATCH'):
            self.proof(data, image)

    def test_rejects_embedded_private_environment_file(self):
        data, image = archive_fixture(secret_path=True)
        with self.assertRaisesRegex(AssertionError, 'EMBEDDED_SECRET_PATH'):
            self.proof(data, image)


if __name__ == '__main__':
    unittest.main()
