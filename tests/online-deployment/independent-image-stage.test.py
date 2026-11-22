import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

HERE = Path(__file__).resolve().parent

def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

stage = load('independent_image_stage', HERE / 'independent-image-stage.fixture.py')
real = load('canonical_image_materialization_fixture', HERE / 'private-image-materialization.test.py')

class IndependentImageStage(unittest.TestCase):
    def test_actual_verified_graph_and_source_encoded_stream_preserve_selected_config(self):
        with tempfile.TemporaryDirectory(prefix='sabalan-independent-image-') as directory:
            archive, checksum, index, platform, config, raw, config_bytes = real.fixture(Path(directory).resolve(), multi=True)
            measured = real.image.measure(archive, checksum, index, platform, config)
            layers = [row['diffId'] for row in measured['layers']]
            self.assertEqual(layers, [real.digest(value) for value in raw])
            budget = stage.import_budget(measured, [layers[:2]], archive.stat().st_size, 12345)
            self.assertEqual(budget['sharedPrefixLayers'], 2)
            self.assertEqual(budget['missingExpandedBytes'], len(raw[2]))
            output = io.BytesIO()
            result = real.image.materialize_to_stream(archive, output, checksum, index, platform, config, preserve_source_encoding=True)
            self.assertEqual(result['rootfsDiffIds'], layers)
            with tarfile.open(fileobj=io.BytesIO(output.getvalue())) as classic:
                manifest = json.load(classic.extractfile('manifest.json'))
                self.assertIsNone(manifest[0]['RepoTags'])
                self.assertEqual(classic.extractfile(manifest[0]['Config']).read(), config_bytes)
            self.assertEqual(budget['requiredDiskBytes'],len(raw[2])+max(12345,budget['sourceEncodedSpoolBytes']+128*stage.MIB))

    def test_shared_tail_with_different_parent_chain_never_reduces_import_budget(self):
        measured = {'layers': [{'diffId': 'sha256:a', 'expandedBytes': 100}, {'diffId': 'sha256:b', 'expandedBytes': 200}]}
        result = stage.import_budget(measured, [['sha256:x', 'sha256:b']], 1000, 999)
        self.assertEqual(result['sharedPrefixLayers'], 0)
        self.assertEqual(result['missingExpandedBytes'], 300)

    def test_only_longest_complete_ordered_prefix_is_shared(self):
        measured = {'layers': [{'diffId': 'sha256:a', 'expandedBytes': 100}, {'diffId': 'sha256:b', 'expandedBytes': 200}]}
        result = stage.import_budget(measured, [['sha256:b'], ['sha256:a']], 1000, 999)
        self.assertEqual(result['sharedPrefixLayers'], 1)
        self.assertEqual(result['missingExpandedBytes'], 200)

    def test_retired_import_spool_and_future_restore_are_sequential_peaks(self):
        measured = {'layers': [{'diffId': 'sha256:a', 'expandedBytes': 100}]}
        result = stage.import_budget(measured, [], 1000, 1024 * stage.MIB)
        self.assertEqual(result['requiredDiskBytes'],1024 * stage.MIB + 100)

    def test_genuine_wrong_diff_id_refuses_before_any_docker_load(self):
        with tempfile.TemporaryDirectory(prefix='sabalan-independent-image-negative-') as directory:
            archive, checksum, index, platform, config, *_ = real.fixture(Path(directory).resolve(), bad_diff=True)
            with self.assertRaisesRegex(RuntimeError, 'IMAGE_DIFF_ID_MISMATCH'):
                real.image.measure(archive, checksum, index, platform, config)

if __name__ == '__main__': unittest.main()
