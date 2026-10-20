import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('producer', Path(__file__).parents[2] / 'deploy/scripts/online-checkpoint-producer.py')
producer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(producer)


class OriginalChildren(unittest.TestCase):
    def test_original_interactive_pipe_is_visible_before_child_exit(self):
        import time
        with tempfile.TemporaryDirectory() as temporary:
            owner=producer.OriginalChildren(Path(temporary),lambda:None)
            child=owner.start('handshake',[sys.executable,'-c','import sys;sys.stdout.buffer.write(b"FROZEN\\n");sys.stdout.buffer.flush();assert sys.stdin.readline()=="BEGIN\\n"'],interactive=True)
            try:
                deadline=time.monotonic()+3
                while child.stdout.read_bytes()!=b'FROZEN\n' and time.monotonic()<deadline:
                    time.sleep(.01)
                self.assertEqual(child.stdout.read_bytes(),b'FROZEN\n')
                self.assertIsNone(child.process.poll())
                child.process.stdin.write(b'BEGIN\n');child.process.stdin.flush()
            finally:
                child.process.stdin.close()
                owner.finish(child)
            self.assertEqual(owner.finish(child),b'FROZEN\n')

    def test_failed_output_limit_waits_for_same_original_child_without_signalling(self):
        with tempfile.TemporaryDirectory() as temporary:
            owner = producer.OriginalChildren(Path(temporary), lambda: None)
            child = owner.start('bounded', [sys.executable, '-c', 'import sys,time;sys.stdout.write("x"*8192);sys.stdout.flush();time.sleep(.08)'], maximum=64)
            with self.assertRaisesRegex(RuntimeError, 'OUTPUT_BOUND'):
                owner.finish(child, maximum=64)
            self.assertEqual(child.process.returncode, 0)
            self.assertTrue(owner.closed())
            self.assertEqual(child.stdout.stat().st_size, 64)

    def test_guard_refuses_wrong_project_changed_or_missing_id_before_delegate(self):
        expected=['a'*64,'b'*64]
        producer.validate_census([{'ID':'a'*64,'Project':'sabalanerp'},{'ID':'b'*64,'Project':'sabalanerp'}],expected)
        for rows in ([{'ID':'a'*64,'Project':'wrong'}],
                     [{'ID':'a'*64,'Project':'sabalanerp'}],
                     [{'ID':'a'*64,'Project':'sabalanerp'},{'ID':'c'*64,'Project':'sabalanerp'}]):
            with self.assertRaisesRegex(RuntimeError,'CENSUS_CHANGED'):
                producer.validate_census(rows,expected)

    def test_actual_nonzero_child_never_becomes_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            owner = producer.OriginalChildren(Path(temporary), lambda: None)
            child = owner.start('failure', [sys.executable, '-c', 'raise SystemExit(7)'])
            with self.assertRaisesRegex(RuntimeError, 'CHILD_FAILED'):
                owner.finish(child)
            self.assertEqual(child.process.returncode, 7)
            self.assertTrue(owner.closed())


if __name__ == '__main__':
    unittest.main()
