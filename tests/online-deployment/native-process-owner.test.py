"""Real Linux process-tree acceptance for the native recovery command owner."""
import pathlib
import os
import signal
import fcntl
import subprocess
import tempfile
import time
import unittest


class NativeProcessOwner(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work = tempfile.TemporaryDirectory(prefix='sabalan-process-owner-')
        cls.binary = pathlib.Path(cls.work.name) / 'owner'
        source = pathlib.Path(__file__).resolve().parents[2] / 'deploy/scripts/native-process-owner.c'
        subprocess.run(['cc', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', str(source), '-o', str(cls.binary)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.work.cleanup()

    def test_deadline_reaps_detached_descendant_before_completion(self):
        marker = pathlib.Path(self.work.name) / 'escaped-write'
        # setsid and a double fork must not escape the subreaper's ownership.
        script = 'import os,time; p=os.fork(); (os._exit(0) if p else None); os.setsid(); p=os.fork(); (os._exit(0) if p else None); time.sleep(2); open(' + repr(str(marker)) + ',"w").write("bad")'
        result = subprocess.run([str(self.binary), '1', 'tree-test', 'python3', '-c', script], capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 125)  # parent exited with outstanding descendants
        self.assertIn(b'SABALAN_NATIVE_REAPED tree-test 125\n', result.stderr)
        time.sleep(2.1)
        self.assertFalse(marker.exists())

    def test_deadline_kills_signal_ignoring_command_and_reports_completion(self):
        script = 'import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(10)'
        started = time.monotonic()
        result = subprocess.run([str(self.binary), '1', 'deadline-test', 'python3', '-c', script], capture_output=True, timeout=4)
        self.assertEqual(result.returncode, 124)
        self.assertLess(time.monotonic() - started, 3)
        self.assertIn(b'SABALAN_NATIVE_REAPED deadline-test 124\n', result.stderr)

    def test_native_exit_code_and_bytes_are_preserved(self):
        result = subprocess.run([str(self.binary), '2', 'native-exit', 'sh', '-c', 'printf payload; exit 7'], capture_output=True, timeout=4)
        self.assertEqual(result.stdout, b'payload')
        self.assertEqual(result.returncode, 7)
        self.assertIn(b'SABALAN_NATIVE_REAPED native-exit 7\n', result.stderr)

    def test_orchestration_plugin_cannot_continue_after_parent_deadline(self):
        marker = pathlib.Path(self.work.name) / 'late-service-switch'
        script = 'import os,time,signal; p=os.fork(); signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(2); (open(' + repr(str(marker)) + ',"w").write("late") if p==0 else None); time.sleep(5)'
        result = subprocess.run([str(self.binary), '1', 'orchestration-test', 'python3', '-c', script], capture_output=True, timeout=4)
        self.assertEqual(result.returncode, 124)
        self.assertIn(b'SABALAN_NATIVE_REAPED orchestration-test 124\n', result.stderr)
        time.sleep(1.2)
        self.assertFalse(marker.exists())

    def test_interruption_reaps_descendants_before_receipt(self):
        child = subprocess.Popen([str(self.binary), '10', 'cancel-test', 'sleep', '20'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        time.sleep(.1)
        os.kill(child.pid, signal.SIGTERM)
        _, errors = child.communicate(timeout=4)
        self.assertEqual(child.returncode, 124)
        self.assertIn(b'SABALAN_NATIVE_REAPED cancel-test 124\n', errors)

    def test_host_filesystem_failures_keep_exclusive_owner_after_spawn(self):
        fixture = pathlib.Path(__file__).with_name('capture-owner-fault.fixture.py')
        for fault in ['log-open', 'log-write', 'ownership-read']:
            with self.subTest(fault=fault), tempfile.TemporaryDirectory(prefix='sabalan-owner-fault-') as directory:
                root = pathlib.Path(directory)
                owner = root / 'owner.lock'
                descriptor = os.open(owner, os.O_CREAT | os.O_RDWR, 0o600)
                if descriptor != 9:
                    os.dup2(descriptor, 9)
                    os.close(descriptor)
                fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
                host = subprocess.Popen(['python3', str(fixture), str(root), str(self.binary), fault],
                                        pass_fds=(9,), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                os.close(9)  # The host fixture is now the sole lock owner.
                try:
                    deadline = time.monotonic() + 4
                    while not (root / 'native-pid').exists() and host.poll() is None and time.monotonic() < deadline:
                        time.sleep(.01)
                    self.assertTrue((root / 'native-pid').exists(), host.stderr.read() if host.poll() is not None else '')
                    time.sleep(.4)
                    self.assertIsNone(host.poll(), 'fault released the owner')
                    with owner.open('r+') as probe:
                        with self.assertRaises(BlockingIOError):
                            fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    native_pid = int((root / 'native-pid').read_text())
                    native_status = pathlib.Path('/proc') / str(native_pid) / 'status'
                    # The real native owner has finished reaping, while the host
                    # conservatively retains FD9 because it lost the receipt.
                    self.assertTrue(not native_status.exists() or 'State:\tZ' in native_status.read_text())
                finally:
                    host.kill()  # Only this test-owned host, after native completion.
                    host.communicate(timeout=3)

    def test_proven_native_completion_allows_post_execution_failure_to_release_owner(self):
        fixture = pathlib.Path(__file__).with_name('capture-owner-fault.fixture.py')
        with tempfile.TemporaryDirectory(prefix='sabalan-owner-proven-') as directory:
            root = pathlib.Path(directory)
            descriptor = os.open(root / 'owner.lock', os.O_CREAT | os.O_RDWR, 0o600)
            if descriptor != 9:
                os.dup2(descriptor, 9)
                os.close(descriptor)
            fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
            host = subprocess.Popen(['python3', str(fixture), str(root), str(self.binary), 'none'],
                                    pass_fds=(9,), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            os.close(9)
            _, errors = host.communicate(timeout=4)
            self.assertEqual(host.returncode, 1)
            self.assertIn(b'JSONDecodeError', errors)  # intentionally empty fake psql output
            with (root / 'owner.lock').open('r+') as probe:
                fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)


if __name__ == '__main__':
    unittest.main()
