"""Small protocol boundary tests; no native process or Docker activity."""
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('stop', Path(__file__).with_name('inquiry-requested-stop.fixture.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RequestedStopTests(unittest.TestCase):
    def inputs(self):
        guardian = {'pid': 42, 'startTicks': '123', 'bootId': 'private-test'}
        request = {'format': 'sabalan-private-inquiry-requested-stop/v1', 'guardian': guardian,
                   'activeClaimSha256': 'a' * 64, 'signal': 'SIGTERM', 'expectedNativeStatus': 143,
                   'naturalExitZeroExpected': False}
        initial = {'phase': 'ACTIVE', 'guardian': guardian}
        final = {'phase': 'QUIESCENT', 'guardian': guardian, 'activeClaimSha256': 'a' * 64,
                 'nativeReaped': True, 'sqliteNativeClosed': True, 'stoppedBySignal': True, 'nativeStatus': 143}
        return copy.deepcopy((request, initial, final))

    def test_requested_retirement_preserves_actual_nonzero_status(self):
        self.assertEqual(module.qualify_requested_stop(*self.inputs(), 128),
                         {'retiredByRequestedSigterm': True, 'nativeStatus': 143, 'naturalExitZero': False})

    def test_unrequested_or_unclosed_outcomes_refuse(self):
        mutations = [('nativeReaped', False), ('sqliteNativeClosed', False), ('stoppedBySignal', False),
                     ('phase', 'ACTIVE'), ('nativeStatus', 0), ('nativeStatus', 137),
                     ('activeClaimSha256', 'b' * 64), ('guardian', {'pid': 99})]
        for field, value in mutations:
            with self.subTest(field=field, value=value), self.assertRaises(AssertionError):
                request, initial, final = self.inputs()
                final[field] = value
                module.qualify_requested_stop(request, initial, final, 128)
        for field, value in [('signal', 'SIGKILL'), ('expectedNativeStatus', 0), ('naturalExitZeroExpected', True)]:
            with self.subTest(field=field), self.assertRaises(AssertionError):
                request, initial, final = self.inputs()
                request[field] = value
                module.qualify_requested_stop(request, initial, final, 128)
        with self.assertRaises(AssertionError):
            module.qualify_requested_stop(*self.inputs(), 0)


if __name__ == '__main__':
    unittest.main()
