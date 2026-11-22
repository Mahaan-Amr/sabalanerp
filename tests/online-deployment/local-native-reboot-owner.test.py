"""Native lock and fail-closed file behavior, using only a temporary directory."""
import fcntl
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[2] / 'deploy/scripts/backend-runtime-owner.py'
spec = importlib.util.spec_from_file_location('backend_runtime_owner', SOURCE)
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)


class LocalNativeOwnerBoundary(unittest.TestCase):
    def test_advisory_session_stays_live_until_receipt_is_durable(self):
        original = subprocess.Popen
        fake = ("import sys; q=sys.stdin.readline(); "
                "assert q==\"SELECT 'SABALAN_LOCAL_REBOOT_LOCKED' FROM pg_advisory_lock(436, 20261112);\\n\"; "
                "print('SABALAN_LOCAL_REBOOT_LOCKED',flush=True);sys.stdin.read()")
        with patch.object(owner.subprocess, 'Popen', side_effect=lambda *_args, **_kwargs:
                          original([sys.executable, '-c', fake], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)):
            session = owner.acquire_local_reboot_advisory({})
        try:
            self.assertIsNone(session.poll())
            session.stdin.close()
            self.assertEqual(session.wait(timeout=5), 0)
        finally:
            if session.poll() is None:
                session.kill()
                session.wait(timeout=5)
            session.stdout.close()
            session.stderr.close()

    def test_fd9_must_be_the_live_exclusive_owner(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            lock = directory / 'deployment-runtime-control.lock'
            fd = os.open(lock, os.O_CREAT | os.O_RDWR, 0o600)
            saved = None
            try:
                try:
                    saved = os.dup(9)
                except OSError:
                    pass
                os.dup2(fd, 9)
                with patch.dict(os.environ, BACKEND_CONTROL_LOCK_FD='9',
                                BACKEND_CONTROL_LOCK_FILE=str(lock)):
                    with self.assertRaises(RuntimeError):
                        owner.assert_control_lock(directory)
                    fcntl.flock(9, fcntl.LOCK_EX)
                    self.assertEqual(owner.assert_control_lock(directory).st_ino, lock.stat().st_ino)
                    fcntl.flock(9, fcntl.LOCK_UN)
                    with self.assertRaises(RuntimeError):
                        owner.assert_control_lock(directory)
            finally:
                os.close(fd)
                if saved is None:
                    os.close(9)
                else:
                    os.dup2(saved, 9)
                    os.close(saved)

    def test_active_is_never_normal_quiescent_and_exclusive_failure_keeps_bytes(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            active = directory / 'deployment-runtime-native.json'
            raw = owner.encode(dict(format='sabalan-runtime-native/v1', phase='ACTIVE'))
            owner.write_exclusive(active, raw)
            with self.assertRaises(RuntimeError):
                owner.assert_closed(directory)
            with self.assertRaises(FileExistsError):
                owner.write_exclusive(active, b'corrupt\n')
            self.assertEqual(active.read_bytes(), raw)


if __name__ == '__main__':
    unittest.main()
