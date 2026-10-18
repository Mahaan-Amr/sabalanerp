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


def fixture(root, bad_layer=False, bad_diff=False, bad_platform_size=False, bomb=False, unsafe=False, multi=False, repeat=False, reverse=False):
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
        entries = list({**blobs, 'unrelated-image.bin': random.Random(42).randbytes(4096)}.items())
        for name, data in reversed(entries) if reverse else entries:
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

    def test_stream_materialization_preserves_exact_config_layer_order_and_source(self):
        for reverse in [False, True]:
            with self.subTest(reverse=reverse), tempfile.TemporaryDirectory(prefix='sabalan-image-stream-') as directory:
                root = Path(directory).resolve()
                archive, checksum, index, platform, config, raw, config_bytes = fixture(root, reverse=reverse)

                class PartialSink(io.BytesIO):
                    def write(self, data):
                        return super().write(data[:137])

                sink = PartialSink()
                result = image.materialize_to_stream(archive, sink, checksum, index, platform, config)
                emitted = sink.getvalue()
                self.assertEqual(hashlib.sha256(emitted).hexdigest(), result['archiveSha256'])
                self.assertEqual(len(emitted), result['archiveBytes'])
                self.assertFalse(result['archiveReadbackVerified'])
                self.assertFalse(result['dockerImportVerified'])
                self.assertFalse(result['healthyApplicationPoint'])
                self.assertFalse(result['publicOnlineAdmission'])
                self.assertEqual(result['tagAssignments'], [])
                with tarfile.open(fileobj=io.BytesIO(emitted)) as output:
                    manifest = json.load(output.extractfile('manifest.json'))
                    self.assertIsNone(manifest[0]['RepoTags'])
                    self.assertEqual(output.extractfile(manifest[0]['Config']).read(), config_bytes)
                    self.assertEqual([output.extractfile(name).read() for name in manifest[0]['Layers']], raw)
                self.assertEqual(image.sha(archive), checksum)
                self.assertEqual(list(root.iterdir()), [archive])

    def test_stream_refuses_invalid_sources_and_unproven_repeated_layers_before_output(self):
        for options, expected in [({'bad_diff': True}, 'IMAGE_DIFF_ID_MISMATCH'),
                                  ({'repeat': True}, 'IMAGE_STREAM_REPEATED_LAYER_UNPROVEN'),
                                  ({'unsafe': True}, 'IMAGE_ARCHIVE_MEMBER_UNSAFE')]:
            with self.subTest(options=options), tempfile.TemporaryDirectory(prefix='sabalan-stream-refusal-') as directory:
                root = Path(directory).resolve()
                archive, checksum, index, platform, config, *_ = fixture(root, **options)
                sink = io.BytesIO()
                with self.assertRaisesRegex(RuntimeError, expected):
                    image.materialize_to_stream(archive, sink, checksum, index, platform, config)
                self.assertEqual(sink.getvalue(), b'')
                self.assertEqual(list(root.iterdir()), [archive])
                self.assertEqual(image.sha(archive), checksum)

    def test_stream_sink_failure_retains_original_source_without_success_proof(self):
        with tempfile.TemporaryDirectory(prefix='sabalan-stream-sink-') as directory:
            root = Path(directory).resolve()
            archive, checksum, index, platform, config, *_ = fixture(root)

            class BrokenSink:
                def write(self, data):
                    return 0

            with self.assertRaisesRegex(RuntimeError, 'IMAGE_STREAM_SINK_SHORT_WRITE'):
                image.materialize_to_stream(archive, BrokenSink(), checksum, index, platform, config)
            self.assertEqual(image.sha(archive), checksum)
            self.assertEqual(list(root.iterdir()), [archive])

    def test_stream_can_retain_source_compression_with_exact_config_and_diff_ids(self):
        with tempfile.TemporaryDirectory(prefix='sabalan-stream-compressed-') as directory:
            root = Path(directory).resolve()
            archive, checksum, index, platform, config, raw, config_bytes = fixture(root, multi=True, reverse=True)
            sink = io.BytesIO()
            result = image.materialize_to_stream(archive, sink, checksum, index, platform, config,
                                                preserve_source_encoding=True)
            self.assertEqual(result['layerEncoding'], 'source')
            self.assertEqual(result['rootfsDiffIds'], [digest(v) for v in raw])
            self.assertLess(result['archiveBytes'], sum(map(len, raw)))
            with tarfile.open(fileobj=io.BytesIO(sink.getvalue())) as output:
                manifest = json.load(output.extractfile('manifest.json'))
                self.assertIsNone(manifest[0]['RepoTags'])
                self.assertEqual(output.extractfile(manifest[0]['Config']).read(), config_bytes)
                self.assertEqual([gzip.decompress(output.extractfile(name).read()) for name in manifest[0]['Layers']], raw)
            self.assertEqual(image.sha(archive), checksum)
            self.assertEqual(list(root.iterdir()), [archive])

    def test_verified_callback_precedes_manifest_and_may_retire_owned_source(self):
        with tempfile.TemporaryDirectory(prefix='sabalan-stream-finalize-') as directory:
            root = Path(directory).resolve()
            archive, checksum, index, platform, config, raw, _ = fixture(root)
            sink, events = io.BytesIO(), []
            original_add = tarfile.TarFile.addfile

            def watched(target, info, fileobj=None):
                if target.fileobj.__class__.__name__ == '_Stream':
                    events.append(info.name)
                return original_add(target, info, fileobj)

            def finalized():
                events.append('VERIFIED_CALLBACK')
                self.assertEqual(image.sha(archive), checksum)
                archive.unlink()  # Disposable input; no production callback authority is inferred.

            with patch.object(tarfile.TarFile, 'addfile', watched):
                result = image.materialize_to_stream(archive, sink, checksum, index, platform, config,
                                                    before_manifest=finalized)
            self.assertEqual(events[-2:], ['VERIFIED_CALLBACK', 'manifest.json'])
            self.assertEqual(events.count('VERIFIED_CALLBACK'), 1)
            with tarfile.open(fileobj=io.BytesIO(sink.getvalue())) as output:
                manifest = json.load(output.extractfile('manifest.json'))
                self.assertEqual([output.extractfile(name).read() for name in manifest[0]['Layers']], raw)
            self.assertFalse(result['dockerImportVerified'])
            self.assertEqual(list(root.iterdir()), [])

    def test_callback_failure_or_invalid_source_never_emits_manifest(self):
        for invalid_source in [False, True]:
            with self.subTest(invalid_source=invalid_source), tempfile.TemporaryDirectory(prefix='sabalan-stream-callback-') as directory:
                root = Path(directory).resolve()
                archive, checksum, index, platform, config, *_ = fixture(root, bad_diff=invalid_source)
                sink, calls = io.BytesIO(), []

                def failed():
                    calls.append(True)
                    raise RuntimeError('FINALIZATION_REFUSED')

                expected = 'IMAGE_DIFF_ID_MISMATCH' if invalid_source else 'FINALIZATION_REFUSED'
                with self.assertRaisesRegex(RuntimeError, expected):
                    image.materialize_to_stream(archive, sink, checksum, index, platform, config,
                                                before_manifest=failed)
                self.assertEqual(len(calls), 0 if invalid_source else 1)
                self.assertNotIn(b'manifest.json', sink.getvalue())
                self.assertEqual(image.sha(archive), checksum)
                self.assertEqual(list(root.iterdir()), [archive])

    def test_lazy_finalizers_cannot_silently_publish_a_manifest(self):
        calls = []

        async def asynchronous():
            calls.append('async')

        def generator():
            calls.append('generator')
            yield None

        def returns_iterator():
            return iter([None])

        class AsyncCallable:
            async def __call__(self):
                calls.append('async-object')

        for callback in [asynchronous, generator, returns_iterator, AsyncCallable()]:
            with self.subTest(callback=type(callback).__name__), tempfile.TemporaryDirectory(prefix='sabalan-stream-lazy-') as directory:
                root = Path(directory).resolve()
                archive, checksum, index, platform, config, *_ = fixture(root)
                sink = io.BytesIO()
                with self.assertRaisesRegex(RuntimeError, 'IMAGE_STREAM_CALLBACK_'):
                    image.materialize_to_stream(archive, sink, checksum, index, platform, config,
                                                before_manifest=callback)
                self.assertNotIn(b'manifest.json', sink.getvalue())
                self.assertEqual(image.sha(archive), checksum)
        self.assertEqual(calls, [])

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
