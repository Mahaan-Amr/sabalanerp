"""Real host children only: no Docker, database, browser, or application owner."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest


spec = importlib.util.spec_from_file_location('migration_custody_subject',
    Path(__file__).with_name('application-native-migration.fixture.py'))
subject = importlib.util.module_from_spec(spec)
spec.loader.exec_module(subject)


class OriginalMigrationCustodyTests(unittest.TestCase):
    def test_deadline_keeps_same_live_child_until_natural_nonzero_exit(self):
        child = subprocess.Popen([sys.executable, '-I', '-B', '-c',
            'import time; time.sleep(1.4); raise SystemExit(7)'])
        seen = []
        def record(value):
            self.assertIsNone(child.poll())
            self.assertEqual(value['originalPid'], child.pid)
            self.assertTrue(value['originalHandleRetained'])
            self.assertFalse(value['terminationRequested'])
            seen.append(value)
        try:
            exceeded = subject.wait_original_migration_owner(child, record, timeout=0.01)
            self.assertTrue(exceeded)
            self.assertEqual(len(seen), 1)
            self.assertEqual(child.returncode, 7)
        finally:
            child.wait()

    def test_evidence_failure_is_reported_only_after_original_child_exits(self):
        child = subprocess.Popen([sys.executable, '-I', '-B', '-c',
            'import time; time.sleep(1.4)'])
        def fail_record(_):
            self.assertIsNone(child.poll())
            raise OSError('test evidence write failure')
        try:
            with self.assertRaisesRegex(OSError, 'test evidence write failure'):
                subject.wait_original_migration_owner(child, fail_record, timeout=0.01)
            self.assertEqual(child.returncode, 0)
        finally:
            child.wait()

    def test_normal_original_exit_does_not_invent_deadline(self):
        child = subprocess.Popen([sys.executable, '-I', '-B', '-c', 'pass'])
        try:
            exceeded = subject.wait_original_migration_owner(child,
                lambda _: self.fail('unexpected deadline'), timeout=120)
            self.assertFalse(exceeded)
            self.assertEqual(child.returncode, 0)
        finally:
            child.wait()

    def test_observer_interrupt_does_not_release_original_child(self):
        child = subprocess.Popen([sys.executable, '-I', '-B', '-c',
            'import time; time.sleep(0.15)'])
        original_wait = child.wait
        interrupted = False
        def interrupt_once(timeout=None):
            nonlocal interrupted
            if not interrupted:
                interrupted = True
                raise KeyboardInterrupt('test observer interruption')
            return original_wait(timeout=timeout)
        child.wait = interrupt_once
        try:
            with self.assertRaisesRegex(KeyboardInterrupt, 'test observer interruption'):
                subject.wait_original_migration_owner(child,
                    lambda _: self.fail('unexpected deadline'), timeout=120)
            self.assertEqual(child.returncode, 0)
        finally:
            original_wait()

    def test_late_zero_exit_does_not_erase_crossed_deadline(self):
        child = subprocess.Popen([sys.executable, '-I', '-B', '-c',
            'import time; time.sleep(0.15)'])
        seen = []
        try:
            exceeded = subject.wait_original_migration_owner(child, seen.append, timeout=0.01)
            self.assertTrue(exceeded)
            self.assertEqual(child.returncode, 0)
            self.assertEqual(len(seen), 1)
            self.assertFalse(seen[0]['ownerStillRunning'])
            self.assertFalse(seen[0]['originalResult'])
        finally:
            child.wait()


if __name__ == '__main__':
    unittest.main()
