import gzip
import hashlib
import importlib.util
import io
import json
import random
from pathlib import Path
import tarfile
import tempfile
import unittest

source = Path(__file__).resolve().parents[2] / 'deploy/scripts/materialize-private-image.py'
spec = importlib.util.spec_from_file_location('private_image', source)
image = importlib.util.module_from_spec(spec)
spec.loader.exec_module(image)


def digest(data):
    return 'sha256:' + hashlib.sha256(data).hexdigest()


def fixture(root, bad_layer=False, bad_diff=False, bad_platform_size=False, bomb=False, unsafe=False):
    blobs = {}

    def add(data):
        name = digest(data)
        blobs['blobs/sha256/' + name[7:]] = data
        return {'digest': name, 'size': len(data)}

    raw = [b'x' * 8192, b'plain layer'] if bomb else [b'compressed layer', b'plain layer']
    encoded = [gzip.compress(raw[0], mtime=0), raw[1]]
    layers = [dict(add(data), mediaType='application/vnd.oci.image.layer.v1.tar' + ('+gzip' if n == 0 else ''))
              for n, data in enumerate(encoded)]
    config_bytes = json.dumps({'os': 'linux', 'architecture': 'amd64', 'rootfs': {'type': 'layers',
        'diff_ids': [digest(b'wrong') if bad_diff and n == 0 else digest(data) for n, data in enumerate(raw)]}}).encode()
    config = add(config_bytes)
    platform = add(json.dumps({'schemaVersion': 2, 'config': config, 'layers': layers}).encode())
    platform_digest = platform['digest']
    if bad_platform_size:
        platform['size'] += 1
    index = add(json.dumps({'schemaVersion': 2, 'manifests': [dict(platform, platform={'os': 'linux', 'architecture': 'amd64'})]}).encode())
    if bad_layer:
        blobs['blobs/sha256/' + layers[0]['digest'][7:]] = b'!' * len(encoded[0])
    archive = root / 'retained.tar.gz'
    with tarfile.open(archive, 'w:gz') as output:
        for name, data in {**blobs, 'unrelated-image.bin': random.Random(42).randbytes(4096)}.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            output.addfile(info, io.BytesIO(data))
        if unsafe:
            info = tarfile.TarInfo('../escape')
            info.size = 1
            output.addfile(info, io.BytesIO(b'x'))
    return archive, image.sha(archive), index['digest'], platform_digest, config['digest'], raw, config_bytes


class PrivateImageMaterialization(unittest.TestCase):
    def run_fixture(self, **options):
        with tempfile.TemporaryDirectory(prefix='sabalan-image-materialize-') as directory:
            root = Path(directory).resolve()
            archive, checksum, index, platform, config, raw, config_bytes = fixture(root, **options)
            destination = root / 'selected'
            result = image.materialize(archive, destination, checksum, index, platform, config)
            self.assertFalse(result['healthyApplicationPoint'])
            self.assertFalse(result['publicOnlineAdmission'])
            self.assertEqual(result['tagAssignments'], [])
            self.assertEqual(result['sourceIndex'], index)
            self.assertEqual(result['configImageId'], config)
            self.assertEqual(image.sha(archive), checksum)
            with tarfile.open(destination / 'image.tar') as output:
                manifest = json.load(output.extractfile('manifest.json'))
                self.assertEqual(len(manifest), 1)
                self.assertIsNone(manifest[0]['RepoTags'])
                self.assertEqual(output.extractfile(manifest[0]['Config']).read(), config_bytes)
                self.assertEqual([output.extractfile(name).read() for name in manifest[0]['Layers']], raw)
            self.assertEqual(image.sha(destination / 'image.tar'), result['archiveSha256'])

    def test_one_selected_graph_becomes_an_untagged_classic_archive(self):
        self.run_fixture()

    def test_changed_selected_blob_cannot_hide_behind_a_new_whole_archive_checksum(self):
        with self.assertRaisesRegex(RuntimeError, 'IMAGE_LAYER_HASH_INVALID'):
            self.run_fixture(bad_layer=True)

    def test_valid_compressed_hash_cannot_replace_the_uncompressed_diff_id(self):
        with self.assertRaisesRegex(RuntimeError, 'IMAGE_DIFF_ID_MISMATCH'):
            self.run_fixture(bad_diff=True)

    def test_descriptor_sizes_are_checked_independently_of_content_address_names(self):
        with self.assertRaisesRegex(RuntimeError, 'IMAGE_GRAPH_IDENTITY_MISMATCH'):
            self.run_fixture(bad_platform_size=True)

    def test_unused_traversal_entries_do_not_reach_a_candidate_archive(self):
        with self.assertRaisesRegex(RuntimeError, 'IMAGE_ARCHIVE_MEMBER_UNSAFE'):
            self.run_fixture(unsafe=True)

    def test_expansion_is_bounded_before_classic_publication(self):
        with tempfile.TemporaryDirectory(prefix='sabalan-image-bomb-') as directory:
            root = Path(directory).resolve()
            archive, checksum, index, platform, config, *_ = fixture(root, bomb=True)
            with self.assertRaisesRegex(RuntimeError, 'IMAGE_EXPANSION_LIMIT'):
                image.materialize(archive, root / 'selected', checksum, index, platform, config,
                                  maximum_layer_bytes=2048, maximum_image_bytes=16384)
            self.assertFalse((root / 'selected/image.tar').exists())
            self.assertFalse((root / 'selected/private-image-proof.json').exists())

    def test_unknown_existing_work_and_wrong_source_checksum_are_preserved(self):
        with tempfile.TemporaryDirectory(prefix='sabalan-image-refusal-') as directory:
            root = Path(directory).resolve()
            archive, checksum, index, platform, config, *_ = fixture(root)
            destination = root / 'selected'
            destination.mkdir()
            marker = destination / 'foreign'
            marker.write_bytes(b'keep')
            with self.assertRaises(FileExistsError):
                image.materialize(archive, destination, checksum, index, platform, config)
            self.assertEqual(marker.read_bytes(), b'keep')
            with self.assertRaisesRegex(RuntimeError, 'IMAGE_ARCHIVE_CHANGED'):
                image.materialize(archive, root / 'new', '0' * 64, index, platform, config)
            self.assertFalse((root / 'new').exists())


if __name__ == '__main__':
    unittest.main()
