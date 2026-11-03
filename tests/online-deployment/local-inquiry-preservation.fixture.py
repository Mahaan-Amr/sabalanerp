"""Behavioral conservation checks on a real existing RO SQLite mount."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest

root = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('conservation', root / 'local-inquiry-preservation.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
original = Path(os.environ['INQUIRY_CONSERVATION_ORIGINAL'])
contract = json.loads((root / 'local-inquiry-original.json').read_bytes())
baseline = root / 'inquiry-baseline.json'


class ConservationTests(unittest.TestCase):
    def test_exact_original_is_conserved_without_canonical_admission(self):
        before = guard.snapshot(original)
        result = guard.verify(original, contract, baseline)
        self.assertEqual(result['phase'], 'CARRIER_READY_NOT_SERVING')
        self.assertFalse(result['canonicalDatabaseAdmitted'])
        self.assertFalse(result['applicationHealthy'])
        self.assertEqual(guard.snapshot(original), before)

    def test_missing_ledger_still_fails_unchanged_canonical_verifier(self):
        before = guard.snapshot(original)
        value = subprocess.run(['/usr/local/bin/node', str(root / 'verify-inquiry-database.cjs')],
                               env={**os.environ, 'DATABASE_URL': 'file:' + str(original)},
                               capture_output=True)
        self.assertEqual(value.returncode, 1)
        self.assertEqual(value.stdout, b'')
        self.assertIn(b'INQUIRY_DATABASE_ADMISSION_FAILED', value.stderr)
        self.assertEqual(guard.snapshot(original), before)

    def test_original_write_is_denied_by_actual_mount(self):
        before = guard.snapshot(original)
        with self.assertRaises(OSError):
            descriptor = os.open(original, os.O_WRONLY | os.O_APPEND)
            os.close(descriptor)
        self.assertEqual(guard.snapshot(original), before)

    def test_wrong_snapshot_inode_role_and_baseline_refuse(self):
        for field in ['sha256', 'inode', 'mtimeNs', 'ctimeNs', 'mode']:
            altered = copy.deepcopy(contract)
            altered['original'][field] = '0' * 64 if field == 'sha256' else '0'
            with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, 'ORIGINAL_SNAPSHOT_CHANGED'):
                guard.verify(original, altered, baseline)
        for field, value in [('role', 'serving'), ('baselineSha256', '0' * 64)]:
            altered = {**contract, field: value}
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                guard.verify(original, altered, baseline)

    def test_writable_alias_and_writable_fixture_are_not_carriers(self):
        with tempfile.TemporaryDirectory(dir=root) as name:
            file = Path(name) / 'fixture.db'
            file.write_bytes(b'not-original')
            with self.assertRaisesRegex(RuntimeError, 'ORIGINAL_MOUNT_WRITABLE'):
                guard.readonly_mount(file)

    def test_sidecars_and_hardlink_are_rejected_without_opening_application(self):
        with tempfile.TemporaryDirectory(dir=root) as name:
            file = Path(name) / 'fixture.db'
            file.write_bytes(b'fixture')
            for suffix in ['-wal', '-shm', '-journal']:
                sidecar = Path(str(file) + suffix)
                sidecar.write_bytes(b'held')
                with self.assertRaisesRegex(RuntimeError, 'ORIGINAL_SIDECAR_PRESENT'):
                    guard.snapshot(file)
                sidecar.unlink()
            os.link(file, file.with_name('alias.db'))
            with self.assertRaisesRegex(RuntimeError, 'ORIGINAL_FILE_UNSAFE'):
                guard.snapshot(file)

    def test_changed_business_schema_cannot_gain_conservation_permission(self):
        altered = json.loads(baseline.read_bytes())
        altered['objects'] = altered['objects'][1:]
        with tempfile.TemporaryDirectory(dir=root) as name:
            file = Path(name) / 'baseline.json'
            file.write_text(json.dumps(altered))
            selected = {**contract, 'baselineSha256': hashlib.sha256(file.read_bytes()).hexdigest()}
            with self.assertRaisesRegex(RuntimeError, 'ORIGINAL_SCHEMA_CHANGED'):
                guard.verify(original, selected, file)

    def test_canonical_valid_ledger_still_verifies_on_isolated_fixture(self):
        data = json.loads(baseline.read_bytes())
        normalize = lambda rows: sorted([{**r, 'sql': __import__('re').sub(r'\s*([(),])\s*', r'\1',
                    __import__('re').sub(r'\s+', ' ', r['sql']).strip().removesuffix(';'))} for r in rows],
                    key=lambda r: r['type'] + ':' + r['name'])
        schema_digest = hashlib.sha256(json.dumps(normalize(data['objects']), separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
        with tempfile.TemporaryDirectory(dir=root) as name:
            file = Path(name) / 'owned-fixture.db'
            database = sqlite3.connect(file)
            try:
                database.executescript(';\n'.join(r['sql'] for r in data['objects']) + ';\n' + data['ledgerSql'])
                database.execute('INSERT INTO "_sabalan_inquiry_migrations" VALUES (?,?,?,?)',
                                 (data['id'], hashlib.sha256(data['ledgerSql'].encode()).hexdigest(), schema_digest, 'fixture'))
                database.execute('INSERT INTO Admin VALUES (?,?,?,?,?)', ('fixture', 'fixture@example.invalid', 'fixture-only', 'fixture', 'fixture'))
                database.commit()
            finally:
                database.close()
            before = guard.snapshot(file)
            value = subprocess.run(['/usr/local/bin/node', str(root / 'verify-inquiry-database.cjs')],
                                   env={**os.environ, 'DATABASE_URL': 'file:' + str(file)}, capture_output=True)
            self.assertEqual(value.returncode, 0)
            self.assertEqual(value.stdout, b'INQUIRY_DATABASE_VERIFIED\n')
            self.assertEqual(guard.snapshot(file), before)


if __name__ == '__main__':
    unittest.main()
