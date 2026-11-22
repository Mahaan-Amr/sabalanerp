"""Actual host children: recoverable observer errors never discard custody."""
import importlib.util
import os
from pathlib import Path
import signal
import sys
import threading
import unittest
from unittest.mock import patch

source=Path(__file__).resolve().parents[2]/'scripts/lib/production-backend-base-observer.py'
spec=importlib.util.spec_from_file_location('backend_base_observer',source)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class CustodyTests(unittest.TestCase):
    def owned_failure(self,observers):
        owner=observers.owners[0]
        self.assertTrue(owner['closed'])
        self.assertEqual(owner['actor'].returncode,0)
        observers.assert_closed()
        self.assertGreater(owner['stdoutBytes'],0)

    def test_actual_pipe_setup_error_waits_same_original_child(self):
        observers=module.OriginalReadonlyObservers();original=os.set_blocking;calls=[]
        def fail_once(fd,value):
            calls.append(fd)
            if len(calls)==1:raise OSError('injected observation failure after actual Popen registration')
            return original(fd,value)
        try:
            with patch.object(module.os,'set_blocking',side_effect=fail_once):
                with self.assertRaisesRegex(RuntimeError,'OBSERVER_FAILED'):
                    observers.run([sys.executable,'-c',"import sys,time;time.sleep(.08);print('actual child');sys.stderr.write('actual stderr')"])
            self.owned_failure(observers)
            self.assertEqual(observers.owners[0]['failure'],'OSError')
            self.assertGreater(observers.owners[0]['stderrBytes'],0)
        finally:observers.restore_signals()

    def test_actual_sigterm_is_deferred_until_original_child_natural_exit(self):
        observers=module.OriginalReadonlyObservers()
        # Windows os.kill(SIGTERM) is TerminateProcess, not a catchable signal.
        # raise_signal delivers a real runtime SIGTERM to our installed handler.
        timer=threading.Timer(.05,lambda:signal.raise_signal(signal.SIGTERM) if os.name=='nt' else os.kill(os.getpid(),signal.SIGTERM))
        try:
            timer.start()
            with self.assertRaisesRegex(RuntimeError,'OBSERVER_FAILED'):
                observers.run([sys.executable,'-c',"import time;time.sleep(.15);print('natural closure after parent interruption')"])
            timer.join();self.owned_failure(observers)
            self.assertIn(signal.SIGTERM,observers.signals)
            with self.assertRaisesRegex(RuntimeError,'CONTROLLER_INTERRUPTED'):
                observers.run([sys.executable,'-c',"raise RuntimeError('must never launch')"])
            self.assertEqual(len(observers.owners),1)
        finally:timer.join();observers.restore_signals()

    def test_overflow_is_bounded_but_drained_until_original_exit(self):
        observers=module.OriginalReadonlyObservers()
        try:
            with self.assertRaisesRegex(RuntimeError,'OBSERVER_FAILED'):
                observers.run([sys.executable,'-c',"print('x'*65536)"],maximum=128)
            self.owned_failure(observers)
            self.assertTrue(observers.owners[0]['exceeded'])
            self.assertEqual(observers.owners[0]['stdoutBytes'],65537+int(os.name=='nt'))
        finally:observers.restore_signals()


if __name__=='__main__':unittest.main()
