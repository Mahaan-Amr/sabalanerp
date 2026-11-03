"""Real file/SQLite boundary tests; no service, Docker or native authority."""
import hashlib
import json
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('probe', Path(__file__).parents[2] / 'deploy/scripts/restored-inquiry-probe.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class ProbeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.parent = Path(self.temporary.name).resolve()
        self.original = self.parent / 'original.db'
        self.restored = self.parent / 'restored.db'
        for file in [self.original, self.restored]:
            database = sqlite3.connect(file)
            try:
                database.execute('CREATE TABLE retained(value TEXT)')
                database.execute("INSERT INTO retained VALUES ('123456789.12345678')")
                database.commit()
            finally:
                database.close()
        self.digest = hashlib.sha256(self.restored.read_bytes()).hexdigest()

    def prepare(self, nonce='a' * 32, digest=None):
        return probe.RestoredInquiryProbe.prepare(self.parent, nonce, self.restored, digest or self.digest, self.original)

    def test_private_copy_integrity_and_exact_retirement_preserve_original(self):
        before = probe.sqlite_snapshot(self.original)
        owner = self.prepare()
        self.assertEqual(owner.input_receipt['sha256'], self.digest)
        self.assertNotEqual(owner.database.stat().st_ino, self.original.stat().st_ino)
        self.assertEqual(owner.state, 'PREPARED')
        result = owner.retire()
        self.assertFalse(owner.root.exists())
        self.assertTrue(result['retired'])
        self.assertTrue(json.loads(owner.retired_file.read_text())['retired'])
        self.assertEqual(probe.sqlite_snapshot(self.original), before)
        self.assertTrue(self.restored.exists())
        with self.assertRaises(RuntimeError):
            owner.retire()
        with self.assertRaises(RuntimeError):
            self.prepare()

    def test_exclusive_child_and_hash_failure_never_replace_prior_data(self):
        owner = self.prepare()
        with self.assertRaises(FileExistsError):
            self.prepare()
        with self.assertRaises(RuntimeError):
            self.prepare('b' * 32, '0' * 64)
        self.assertEqual(owner.database.read_bytes(), self.restored.read_bytes())

    def test_engine_rejects_corrupt_file_even_with_matching_digest(self):
        self.restored.write_bytes(b'SQLite format 3\x00' + b'corrupt' * 100)
        with self.assertRaises((RuntimeError, sqlite3.DatabaseError)):
            self.prepare(digest=hashlib.sha256(self.restored.read_bytes()).hexdigest())

    def test_original_mutation_or_unowned_child_blocks_retirement(self):
        for name in ['original', 'unowned']:
            with self.subTest(name=name):
                owner = self.prepare(('c' if name == 'original' else 'd') * 32)
                if name == 'original':
                    self.original.write_bytes(b'changed original')
                else:
                    (owner.root / 'foreign').write_text('held')
                with self.assertRaises(RuntimeError):
                    owner.retire()
                self.assertTrue(owner.root.exists())

    def test_pending_native_or_reader_evidence_cannot_be_retired(self):
        owner = self.prepare()
        with owner.reader():
            with self.assertRaises(RuntimeError):
                owner.retire()
        owner.retire()

    def test_wal_or_hardlinked_restored_input_is_refused(self):
        sidecar = Path(str(self.restored) + '-wal')
        sidecar.write_bytes(b'pending')
        with self.assertRaises(RuntimeError):
            self.prepare()
        sidecar.unlink()
        import os
        os.link(self.restored, self.parent / 'alias.db')
        with self.assertRaises(RuntimeError):
            self.prepare('e' * 32)

    def test_loopback_policy_refuses_foreign_wildcard_or_ambiguous_listener(self):
        row = '0: 0100007F:0CD7 00000000:0000 0A 0:0 00:0 0 0 0 123'
        self.assertEqual(probe.qualify_loopback_listener(row, {'123'}, 3287), '123')
        for text, inodes in [(row, {'456'}), (row.replace('0100007F', '00000000'), {'123'}),
                             (row + '\n' + row, {'123'}), ('', {'123'})]:
            with self.assertRaises(RuntimeError):
                probe.qualify_loopback_listener(text, inodes, 3287)

    def test_interrupted_retirement_never_publishes_success(self):
        owner = self.prepare()
        # A real pre-existing pending publication is an unresolved original;
        # the exact child is retained rather than overwritten or replayed.
        owner.retired_file.write_text(json.dumps({'retired':False, 'phase':'RETIRING'}))
        with self.assertRaises(FileExistsError):
            owner.retire()
        self.assertTrue(owner.root.exists())
        self.assertFalse(json.loads(owner.retired_file.read_text())['retired'])


if __name__ == '__main__':
    unittest.main()
