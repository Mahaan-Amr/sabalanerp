"""Native browser observations from cold OCI layers, without image execution."""
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import sys
sys.dont_write_bytecode = True
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('maintenance_browser', ROOT / 'deploy/scripts/maintenance-image-archive.py')
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


def tar_bytes(files):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w') as archive:
        for name, value in files.items():
            entry = tarfile.TarInfo(name)
            if value is None:
                entry.type = tarfile.SYMTYPE
                entry.linkname = '/untrusted'
                archive.addfile(entry)
            elif value is True:
                entry.type = tarfile.DIRTYPE
                archive.addfile(entry)
            else:
                entry.size = len(value)
                archive.addfile(entry, io.BytesIO(value))
    return output.getvalue()


class ColdBrowserTests(unittest.TestCase):
    def observe(self, role, layers):
        graph = {'platform': 'sha256:' + 'a' * 64}
        descriptors = [{'digest': 'sha256:' + str(i + 1) * 64, 'mediaType': 'application/vnd.oci.image.layer.v1.tar'} for i in range(len(layers))]
        files = {'blobs/sha256/' + 'a' * 64: json.dumps({'layers': descriptors}).encode()}
        files.update({'blobs/sha256/' + row['digest'][7:]: tar_bytes(layer) for row, layer in zip(descriptors, layers)})
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'cold.tar'
            file.write_bytes(tar_bytes(files))
            return reader.browser_from_layers(file, graph, role)

    def test_erp_native_identity_and_inquiry_distinct_deployment_identity(self):
        result = self.observe('frontend', [{'app/.next-build/BUILD_ID': b'erp_exact_image123', 'app/.next-build/browser-build-identity.json': json.dumps({'format': 'sabalan-browser-build/v1', 'browserBuildId': 'erp_exact_image123', 'nativeBuildId': 'erp_exact_image123'}).encode()}])
        self.assertEqual(result['id'], 'erp_exact_image123')
        self.assertEqual(result['nativeBuildId'], 'erp_exact_image123')
        self.assertEqual(len(result['manifestSha256']), 64)
        inquiry = self.observe('inquiry', [{'app/.next/BUILD_ID': b'build-native-next', 'app/.next/required-server-files.json': json.dumps({'config': {'deploymentId': 'inquiry_exact_image123', 'env': {'NEXT_PUBLIC_INQUIRY_BUILD_ID': 'inquiry_exact_image123'}}}).encode()}])
        self.assertEqual(inquiry['nativeBuildId'], 'build-native-next')
        self.assertEqual(inquiry['id'], 'inquiry_exact_image123')

    def test_ordinary_inquiry_native_build_without_deployment_id_uses_existing_carrier_identity(self):
        import hashlib
        native = b'build-native-next'
        result = self.observe('inquiry', [{'app/.next/BUILD_ID': native, 'app/.next/required-server-files.json': b'{"config":{}}'}])
        self.assertEqual(result['id'], 'inquiry_legacy_' + hashlib.sha256(native).hexdigest())
        self.assertEqual(result['nativeBuildId'], 'build-native-next')
        with self.assertRaises(AssertionError):
            self.observe('inquiry', [{'app/.next/BUILD_ID': native, 'app/.next/required-server-files.json': b'{"config":{"env":{"NEXT_PUBLIC_INQUIRY_BUILD_ID":"inquiry_wrong"}}}'}])

    def test_changed_native_identity_whiteout_and_symlink_refuse(self):
        valid = {'app/.next-build/BUILD_ID': b'erp_exact_image123', 'app/.next-build/browser-build-identity.json': json.dumps({'format': 'sabalan-browser-build/v1', 'browserBuildId': 'erp_exact_image123', 'nativeBuildId': 'erp_exact_image123'}).encode()}
        conventional = {'./app/': True, './app/.next-build/': True, **{'./' + name: raw for name, raw in valid.items()}}
        self.assertEqual(self.observe('frontend', [conventional])['id'], 'erp_exact_image123')
        for same_layer in [{**valid, '.wh..wh..opq': b''}, {'.wh..wh..opq': b'', **valid}]:
            self.assertEqual(self.observe('frontend', [valid, same_layer])['id'], 'erp_exact_image123')
        for later in [{'.wh.app': b''}, {'.wh..wh..opq': b''}, {'app/.wh..wh..opq': b''}, {'app/.next-build/BUILD_ID': b'erp_other_image123'}, {'app/.next-build/.wh.BUILD_ID': b''}, {'app/.next-build': None}, {'app//.next-build': None}, {'app///.next-build': None}]:
            with self.assertRaises(AssertionError):
                self.observe('frontend', [valid, later])
        inquiry = {'app/.next/BUILD_ID': b'build-native-next', 'app/.next/required-server-files.json': b'{"config":{}}'}
        with self.assertRaises(AssertionError):
            self.observe('inquiry', [inquiry, {'app//.next': None}])



class ArchiveProofDependencyTests(unittest.TestCase):
    def test_real_observer_and_exporter_authenticate_config_and_index_with_default_strictness(self):
        import hashlib
        import subprocess
        blobs = {}
        def add(raw):
            digest = 'sha256:' + hashlib.sha256(raw).hexdigest()
            blobs['blobs/sha256/' + digest[7:]] = raw
            return {'digest': digest, 'size': len(raw)}
        def document(value):
            return add(json.dumps(value).encode())
        def archive(config_env=None):
            layer_stream = io.BytesIO()
            with tarfile.open(fileobj=layer_stream, mode='w') as layer:
                entry = tarfile.TarInfo('app/ordinary.txt'); entry.size = 4
                layer.addfile(entry, io.BytesIO(b'data'))
            layer = add(layer_stream.getvalue())
            config = document({'os': 'linux', 'architecture': 'amd64', 'rootfs': {'type': 'layers', 'diff_ids': [layer['digest']]}, 'config': {'Env': config_env or []}})
            platform = document({'schemaVersion': 2, 'config': config, 'layers': [{**layer, 'mediaType': 'application/vnd.oci.image.layer.v1.tar'}]})
            index = document({'schemaVersion': 2, 'manifests': [{**platform, 'platform': {'os': 'linux', 'architecture': 'amd64'}}]})
            blobs['manifest.json'] = json.dumps([{'Config': 'blobs/sha256/' + config['digest'][7:], 'Layers': ['blobs/sha256/' + layer['digest'][7:]]}]).encode()
            blobs['index.json'] = json.dumps({'schemaVersion': 2, 'manifests': [index]}).encode()
            return config['digest'], index['digest']
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'image.tar'
            def save():
                with tarfile.open(file, 'w') as output:
                    for name, raw in blobs.items():
                        entry = tarfile.TarInfo(name); entry.size = len(raw)
                        output.addfile(entry, io.BytesIO(raw))
            config, index = archive(); save()
            observed = reader.observe(str(file.resolve()), config, 'backend')
            self.assertEqual(observed['graph']['config'], config)
            self.assertEqual(observed['graph']['index'], index)
            exporter = sys.modules['maintenance_oci_proof']
            self.assertEqual(exporter.oci_proof(file, index)['index'], index)
            with self.assertRaises(subprocess.CalledProcessError):
                exporter.oci_proof(file, config)
            with self.assertRaises(subprocess.CalledProcessError):
                reader.observe(str(file.resolve()), 'sha256:' + '0' * 64, 'backend')
            blobs.clear(); secret_config, _ = archive(['DATABASE_URL=private']); save()
            with self.assertRaisesRegex(RuntimeError, 'EMBEDDED_CONFIG_SECRET'):
                reader.observe(str(file.resolve()), secret_config, 'backend')

if __name__ == '__main__':
    unittest.main()
