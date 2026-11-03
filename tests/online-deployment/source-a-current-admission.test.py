"""The observed restart is narrow; no other drift earns crypto admission."""
import copy
import pathlib
import runpy
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
API = runpy.run_path(str(ROOT / 'scripts/lib/source-a-current-admission.py'))


class Tests(unittest.TestCase):
    def test_exact_actual_observation_and_historical_chain(self):
        base, actual, _ = API['observed']()
        self.assertEqual(API['transition'](base['expectedEight'], actual['currentEight']), actual['currentEight'])
        self.assertIs(actual['restartCauseProven'], False)

    def test_further_restart_or_other_identity_change_is_rejected(self):
        base, actual, _ = API['observed']()
        for key, changed in [('image', 'sha256:' + '0' * 64), ('restartCount', 4), ('health', 'starting'), ('id', '0' * 64)]:
            model = copy.deepcopy(actual['currentEight'])
            next(r for r in model if r['service'] == 'backend')[key] = changed
            with self.subTest(field=key), self.assertRaises(AssertionError):
                API['transition'](base['expectedEight'], model)


if __name__ == '__main__':
    unittest.main()
