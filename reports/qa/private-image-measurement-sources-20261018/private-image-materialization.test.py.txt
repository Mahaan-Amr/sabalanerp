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
from unittest.mock import patch

source = Path(__file__).resolve().parents[2] / 'deploy/scripts/materialize-private-image.py'
spec = importlib.util.spec_from_file_location('private_image', source)
image = importlib.util.module_from_spec(spec)
spec.loader.exec_module(image)


def digest(data):
    return 'sha256:' + hashlib.sha256(data).hexdigest()


def fixture(root, bad_layer=False, bad_diff=False, bad_platform_size=False, bomb=False, unsafe=False, multi=False, repeat=False):
    blobs = {}

    def add(data):
        name = digest(data)
        blobs['blobs/sha256/' + name[7:]] = data
        return {'digest': name, 'size': len(data)}

    raw = [b'x' * 8192, b'plain layer'] if bomb else [b'compressed layer', b'plain layer']
    if multi:
        raw = [b'a' * 4096, b'b' * 4096, b'c' * 4096]
    encoded = [gzip.compress(data, mtime=0) if multi or n == 0 else data for n, data in enumerate(raw)]
    layers = [dict(add(data), mediaType='application/vnd.oci.image.layer.v1.tar' + ('+gzip' if multi or n == 0 else ''))
              for n, data in enumerate(encoded)]
    if repeat:
        layers = [layers[0], *layers]
        raw = [raw[0], *raw]
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

    def test_measurement_verifies_expanded_identity_without_creating_artifacts(self):
        with tempfile.TemporaryDirectory(prefix='sabalan-image-measure-') as directory:
            root = Path(directory).resolve()
            archive, checksum, index, platform, config, raw, _ = fixture(root)
            before = {p.name: p.read_bytes() for p in root.iterdir()}
            result = image.measure(archive, checksum, index, platform, config)
            self.assertEqual(result['expandedLayerBytes'], sum(map(len, raw)))
            self.assertEqual([v['diffId'] for v in result['layers']], [digest(v) for v in raw])
            self.assertTrue(result['expandedLayerIdentityVerified'])
            self.assertFalse(result['dockerImportVerified'])
            self.assertFalse(result['healthyApplicationPoint'])
            self.assertFalse(result['publicOnlineAdmission'])
            self.assertEqual({p.name: p.read_bytes() for p in root.iterdir()}, before)

    def test_measurement_refuses_false_diff_ids_and_expansion_before_any_output(self):
        for options, expected in [({'bad_diff': True}, 'IMAGE_DIFF_ID_MISMATCH'),
                                  ({'bomb': True}, 'IMAGE_EXPANSION_LIMIT'),
                                  ({'bad_platform_size': True}, 'IMAGE_GRAPH_IDENTITY_MISMATCH'),
                                  ({'unsafe': True}, 'IMAGE_ARCHIVE_MEMBER_UNSAFE')]:
            with self.subTest(options=options), tempfile.TemporaryDirectory(prefix='sabalan-measure-refusal-') as directory:
                root = Path(directory).resolve()
                archive, checksum, index, platform, config, *_ = fixture(root, **options)
                with self.assertRaisesRegex(RuntimeError, expected):
                    image.measure(archive, checksum, index, platform, config,
                                  maximum_layer_bytes=2048, maximum_image_bytes=16384)
                self.assertEqual(list(root.iterdir()), [archive])
                self.assertEqual(image.sha(archive), checksum)

    def test_measurement_stops_at_aggregate_budget_before_later_layers(self):
        for repeat in [False, True]:
            with self.subTest(repeat=repeat), tempfile.TemporaryDirectory(prefix='sabalan-measure-total-') as directory:
                root = Path(directory).resolve()
                archive, checksum, index, platform, config, *_ = fixture(root, multi=True, repeat=repeat)
                original_scan, calls, observed = image.scan, [], []

                def watched(file):
                    calls.append(True)
                    measurement_pass = len(calls) == 2
                    for member, stream in original_scan(file):
                        if measurement_pass:
                            observed.append(member.name)
                        yield member, stream

                with patch.object(image, 'scan', watched), self.assertRaisesRegex(RuntimeError, 'IMAGE_EXPANSION_LIMIT'):
                    image.measure(archive, checksum, index, platform, config,
                                  maximum_layer_bytes=8192, maximum_image_bytes=6000)
                later = b'b' * 4096 if repeat else b'c' * 4096
                self.assertNotIn('blobs/sha256/' + digest(gzip.compress(later, mtime=0))[7:], observed)
                self.assertEqual(list(root.iterdir()), [archive])

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
