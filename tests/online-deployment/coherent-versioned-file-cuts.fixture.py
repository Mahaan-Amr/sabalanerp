"""Focused real-filesystem/real-flock cut handoff, not recovery admission."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

scripts = Path(__import__('sys').argv[1]).resolve()
spec = importlib.util.spec_from_file_location('cuts', scripts / 'coherent-versioned-file-cuts.py')
cuts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cuts)
import fcntl


class CutHandoff(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='sabalan-coherent-cut-')
        self.root = Path(self.temporary.name)
        self.gate = os.open(self.root / 'gate', os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
        fcntl.flock(self.gate, fcntl.LOCK_EX)
        self.capture = 'a' * 64
        self.sources = []
        for name in ['uploads', 'contracts']:
            live, store = self.root / name, self.root / (name + '-store')
            live.mkdir(mode=0o700); store.mkdir(mode=0o700)
            for part in ['objects', 'versions', 'seals']:
                (store / part).mkdir(mode=0o700)
            value = live.stat()
            self.sources.append(dict(name=name, path=str(live), device=str(value.st_dev),
                                     inode=str(value.st_ino), storeRoot=str(store)))

    def tearDown(self):
        os.close(self.gate)
        self.temporary.cleanup()

    def seal(self, source, change=None):
        value = os.fstat(self.gate)
        record = dict(format='sabalan-file-version-cut/v1', captureId=self.capture,
                      gate=dict(device=str(value.st_dev), inode=str(value.st_ino), ownerUid=os.getuid()),
                      source={key: source[key] for key in ['path', 'device', 'inode']}, heads=[])
        if change: change(record)
        raw = cuts.reader.encoded(record)
        target = Path(source['storeRoot']) / 'seals' / (self.capture + '.json')
        target.write_bytes(raw); target.chmod(0o400)
        return dict(name=source['name'], captureId=self.capture, storeRoot=source['storeRoot'],
                    sha256=cuts.reader.digest(raw))

    def test_new_cuts_bind_and_full_reader_still_restores(self):
        owner = cuts.VersionedFileCuts(self.sources, self.capture, self.gate)
        selected = [self.seal(source) for source in self.sources]
        result = owner.accept(selected)
        self.assertEqual(result['versionedCuts'], selected)
        owner.assert_unchanged()
        restored = cuts.reader.SealedVersionedFiles(selected[0]['storeRoot'], self.capture,
                                                   selected[0]['sha256']).restore(str(self.root / 'restored'))
        self.assertEqual(restored['files'], [])

    def test_preexisting_cut_is_not_this_freeze(self):
        self.seal(self.sources[0])
        with self.assertRaisesRegex(RuntimeError, 'PREEXISTING'):
            cuts.VersionedFileCuts(self.sources, self.capture, self.gate)

    def test_cut_during_sql_lock_acquisition_is_not_this_freeze(self):
        owner = cuts.VersionedFileCuts(self.sources, self.capture, self.gate)
        self.seal(self.sources[0])
        with self.assertRaisesRegex(RuntimeError, 'PREEXISTING'):
            owner.assert_unsealed()

    def test_partial_handoff_and_foreign_gate_refused(self):
        owner = cuts.VersionedFileCuts(self.sources, self.capture, self.gate)
        selected = [self.seal(source) for source in self.sources]
        with self.assertRaises(RuntimeError): owner.accept(selected[:1])
        path = Path(self.sources[0]['storeRoot']) / 'seals' / (self.capture + '.json')
        path.chmod(0o600); record = json.loads(path.read_text()); record['gate']['inode'] = '1'
        path.write_bytes(cuts.reader.encoded(record)); path.chmod(0o400)
        selected[0]['sha256'] = cuts.reader.digest(path.read_bytes())
        with self.assertRaisesRegex(RuntimeError, 'GATE'): owner.accept(selected)

    def test_live_replacement_alias_and_shared_gate_refused(self):
        alias = [self.sources[0], dict(self.sources[0], name='alias')]
        with self.assertRaises(RuntimeError): cuts.VersionedFileCuts(alias, self.capture, self.gate)
        owner = cuts.VersionedFileCuts(self.sources, self.capture, self.gate)
        selected = [self.seal(source) for source in self.sources]
        live = Path(self.sources[0]['path']); live.rename(str(live) + '-old'); live.mkdir(mode=0o700)
        with self.assertRaises(RuntimeError): owner.accept(selected)
        fcntl.flock(self.gate, fcntl.LOCK_SH)
        with self.assertRaisesRegex(RuntimeError, 'GATE'): owner.assert_unchanged()

    def test_metadata_does_not_weaken_full_history_validation(self):
        owner = cuts.VersionedFileCuts(self.sources, self.capture, self.gate)
        selected = [self.seal(self.sources[0], lambda record: record.update(heads=[dict(key='missing.pdf', sha256='b' * 64)])),
                    self.seal(self.sources[1])]
        owner.accept(selected)  # No historical/object IO belongs in the pause.
        with self.assertRaises(FileNotFoundError):
            cuts.reader.SealedVersionedFiles(selected[0]['storeRoot'], self.capture, selected[0]['sha256'])

    def test_immutable_seal_replacement_and_hardlink_refused(self):
        owner = cuts.VersionedFileCuts(self.sources, self.capture, self.gate)
        selected = [self.seal(source) for source in self.sources]
        seal = Path(self.sources[0]['storeRoot']) / 'seals' / (self.capture + '.json')
        os.link(seal, str(seal) + '.link')
        with self.assertRaisesRegex(RuntimeError, 'RECORD_UNSAFE'):
            owner.accept(selected)
        os.unlink(str(seal) + '.link')
        owner.accept(selected)
        seal.chmod(0o600)
        with self.assertRaisesRegex(RuntimeError, 'SEAL_CHANGED'):
            owner.assert_unchanged()

    def test_full_reader_checks_lineage_and_actual_bytes_after_exclusive_release(self):
        source = self.sources[0]
        owner = cuts.VersionedFileCuts(self.sources, self.capture, self.gate)
        store = Path(source['storeRoot'])
        previous = dict(format='sabalan-file-version/v1', key='original.pdf', generation=1,
                        previousSha256=None, operation='DELETE', object=None, live=None)
        raw = cuts.reader.encoded(previous); previous_sha = cuts.reader.digest(raw)
        (store / 'versions' / (previous_sha + '.json')).write_bytes(raw)
        body = b'EXACT ORIGINAL BYTES'
        name = '11111111-1111-1111-1111-111111111111'
        current = dict(format='sabalan-file-version/v1', key='original.pdf', generation=2,
                       previousSha256=previous_sha, operation='PUT',
                       object=dict(name=name, sha256=cuts.reader.digest(body), bytes=len(body)),
                       live=dict(device='1', inode='1', bytes=str(len(body)), modified='1', changed='1'))
        raw = cuts.reader.encoded(current); current_sha = cuts.reader.digest(raw)
        (store / 'versions' / (current_sha + '.json')).write_bytes(raw)
        (store / 'objects' / name).write_bytes(body)
        for path in [* (store / 'versions').iterdir(), store / 'objects' / name]: path.chmod(0o400)
        selected = [self.seal(source, lambda record: record.update(heads=[dict(key='original.pdf', sha256=current_sha)])),
                    self.seal(self.sources[1])]
        owner.accept(selected)
        fcntl.flock(self.gate, fcntl.LOCK_UN)
        restored = self.root / 'restored-original'
        reader = cuts.reader.SealedVersionedFiles(source['storeRoot'], self.capture, selected[0]['sha256'])
        reader.restore(str(restored))
        self.assertEqual((restored / 'files/original.pdf').read_bytes(), body)
        self.assertEqual(reader.history_records, 2)
        (store / 'objects' / name).chmod(0o600)
        (store / 'objects' / name).write_bytes(b'X' * len(body)); (store / 'objects' / name).chmod(0o400)
        with self.assertRaisesRegex(RuntimeError, 'OBJECT_CHANGED'):
            cuts.reader.SealedVersionedFiles(source['storeRoot'], self.capture, selected[0]['sha256']).restore(str(self.root / 'corrupt-output'))


if __name__ == '__main__':
    unittest.main(argv=[__import__('sys').argv[0]])
