"""Offline OCI semantic mutants; no Docker, app execution or admission."""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('archive', Path(__file__).parents[2] / 'scripts/verify-local-inquiry-carrier-archive.py')
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)
sha = lambda raw: 'sha256:' + hashlib.sha256(raw).hexdigest()
health = dict(Test=['CMD', 'node', '/app/local-inquiry-preservation-carrier.cjs', 'health'],
              Interval=5_000_000_000, Timeout=15_000_000_000, StartPeriod=5_000_000_000, Retries=3)


def layer(entries):
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode='w') as stream:
        for name, body, mode, uid, gid in entries:
            item = tarfile.TarInfo(name)
            item.mode, item.uid, item.gid = mode, uid, gid
            if body is None:
                item.type = tarfile.DIRTYPE
                stream.addfile(item)
            else:
                item.size = len(body)
                stream.addfile(item, io.BytesIO(body))
    return result.getvalue()


def fixture(root, *, extra=(), owner=(0, 0), changed_health=None, omit=False):
    base = layer([('app', None, 0o755, 0, 0)])
    body = b'fixture-not-executable'
    name = 'app/local-inquiry-preservation-carrier.cjs'
    entries = [] if omit else [(name, body, 0o644, *owner)]
    overlay = layer(entries + list(extra))
    config = dict(architecture='amd64', os='linux', rootfs=dict(type='layers', diff_ids=[sha(base), sha(overlay)]),
                  config=dict(Cmd=['node', '/app/local-inquiry-preservation-carrier.cjs'],
                              Healthcheck=changed_health or health, Labels={'io.sabalan.carrier.role': 'local-preservation-only'}))
    blobs = {sha(base): base, sha(overlay): overlay}
    def blob(value):
        raw = json.dumps(value).encode()
        blobs[sha(raw)] = raw
        return dict(digest=sha(raw), size=len(raw))
    configuration = blob(config)
    manifest = blob(dict(schemaVersion=2, config=configuration, layers=[dict(digest=sha(r), size=len(r)) for r in [base, overlay]]))
    index = blob(dict(schemaVersion=2, manifests=[{**manifest, 'platform': {'architecture': 'amd64', 'os': 'linux'}}]))
    file = root / 'fixture.tar'
    with tarfile.open(file, 'w') as stream:
        for digest, raw in blobs.items():
            item = tarfile.TarInfo('blobs/sha256/' + digest.split(':')[1])
            item.size = len(raw)
            stream.addfile(item, io.BytesIO(raw))
    recipe = dict(baseDiffIds=[sha(base)], baseConfig={}, healthcheck=health,
                  files={name: dict(sha256=hashlib.sha256(body).hexdigest(), mode=0o644)})
    return file, index['digest'], recipe


class ArchiveTests(unittest.TestCase):
    def check(self, reason, **mutant):
        with tempfile.TemporaryDirectory() as name:
            args = fixture(Path(name), **mutant)
            with self.assertRaisesRegex(RuntimeError, '^' + reason + '$'):
                archive.verify(*args)

    def test_fixture_reaches_dependency_gate_without_claiming_executable_image(self):
        # Positive overlay/config validation reaches the deliberately missing ELF
        # gate. This synthetic archive is never labeled a usable image.
        self.check('STARTUP_DEPENDENCY_MISSING')

    def test_added_directory_cannot_change_inherited_permissions_or_ownership(self):
        for mode, uid, gid in [(0o777, 0, 0), (0o755, 1, 0), (0o755, 0, 1)]:
            with self.subTest(mode=mode, uid=uid, gid=gid):
                self.check('OVERLAY_DIRECTORY_METADATA_CHANGED', extra=[('app', None, mode, uid, gid)])

    def test_unrelated_directory_is_not_a_declared_copy(self):
        self.check('UNDECLARED_OVERLAY_DIRECTORY', extra=[('arbitrary', None, 0o755, 0, 0)])

    def test_nonroot_file_owner_is_rejected_even_with_correct_file_bytes(self):
        self.check('OVERLAY_FILE_OWNER_CHANGED', owner=(1, 0))
        self.check('OVERLAY_FILE_OWNER_CHANGED', owner=(0, 1))

    def test_health_timing_and_extra_fields_are_part_of_reviewed_contract(self):
        for field, value in [('Timeout', 1), ('Retries', 0), ('StartInterval', 1)]:
            with self.subTest(field=field):
                self.check('HEALTH_CONTRACT_CHANGED', changed_health={**health, field: value})

    def test_missing_startup_file_is_not_hidden_by_valid_oci_digests(self):
        self.check('STARTUP_FILE_MISSING', omit=True)


if __name__ == '__main__':
    unittest.main()
