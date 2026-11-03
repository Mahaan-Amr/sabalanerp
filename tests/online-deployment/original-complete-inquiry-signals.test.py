"""Real POSIX signals/children, modeled probe-start boundary; no native admission."""
import hashlib
import os
import signal
import subprocess
import sys
import threading
import types
import unittest


class OriginalInquirySignalTests(unittest.TestCase):
    def load_owner(self):
        value = types.ModuleType('fixed_original_inquiry_owner_test')
        exec(compile(INQUIRY_OWNER_SOURCE, '<fixed-inquiry-owner>', 'exec'), value.__dict__)
        return value

    def test_signal_between_popen_return_and_assignment_keeps_original_handle(self):
        module = self.load_owner()
        signals = module.OriginalInquirySignals()
        held = None
        def original_spawn():
            original = subprocess.Popen([sys.executable, '-I', '-B', '-c', 'print("ORIGINAL_CLOSED")'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            os.kill(os.getpid(), signal.SIGTERM)
            return original
        try:
            held = original_spawn()
            self.assertTrue(signals.cancelled)
            with self.assertRaises(module.OriginalInquiryCancellation): signals.check()
            out, err = held.communicate()
            self.assertEqual(held.returncode, 0)
            self.assertEqual(out, b'ORIGINAL_CLOSED\n')
            self.assertEqual(err, b'')
            self.assertTrue(held.stdout.closed and held.stderr.closed)
        finally:
            if held is not None and held.poll() is None: held.wait()
            signals.close_after_originals()

    def test_cancel_wakes_owned_pipe_read_without_async_exception(self):
        module = self.load_owner()
        signals = module.OriginalInquirySignals()
        read, write = os.pipe()
        timer = threading.Timer(.03, lambda: os.kill(os.getpid(), signal.SIGTERM))
        try:
            with os.fdopen(read, 'rb', buffering=0) as stream:
                timer.start()
                with self.assertRaises(module.OriginalInquiryCancellation): signals.read_frame(stream)
            timer.join()
            self.assertTrue(signals.cancelled)
        finally:
            timer.join()
            os.close(write)
            signals.close_after_originals()
