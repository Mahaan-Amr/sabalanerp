"""Exercise real quiescence polling without importing the executable fixture."""
import ast
from pathlib import Path
import time
import unittest

source = Path(__file__).with_name('application-prisma-qualification.fixture.py')
tree = ast.parse(source.read_text())
selected = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ('check', 'wait_private_prisma_database_quiet')], type_ignores=[])
namespace = {'time': time}
exec(compile(selected, str(source), 'exec'), namespace)
wait = namespace['wait_private_prisma_database_quiet']
observer = dict(pid=71, backendStart='original-backend-start')

def snapshot(session=True):
    return dict(visible=True, oid='123', prepared=0, sessions=[dict(**observer, applicationName='private-prisma-qualification', backendType='client backend', state='idle')] if session else [])

class QuiescenceTest(unittest.TestCase):
    def harness(self, frames, timeout=1.0):
        records, sleeps = [], []
        now = [0.0]
        def sleep(seconds):
            sleeps.append(seconds)
            now[0] += seconds
        def observe():
            return frames.pop(0) if len(frames) > 1 else frames[0]
        def run():
            return wait(observe, observer, '123', records.append, timeout_seconds=timeout, poll_seconds=0.1, monotonic=lambda: now[0], sleep=sleep)
        return run, records, sleeps

    def test_exact_original_observer_teardown_is_observed_until_real_zero(self):
        run, records, sleeps = self.harness([snapshot(), snapshot(), snapshot(False)])
        self.assertEqual(run()['sessions'], [])
        self.assertEqual(len(records), 3)
        self.assertEqual(len(sleeps), 2)

    def test_unknown_pid_birth_state_or_prepared_work_refuses_without_waiting(self):
        for mutate in (lambda v: v['sessions'][0].update(pid=72), lambda v: v['sessions'][0].update(backendStart='other'), lambda v: v['sessions'][0].update(state='idle in transaction'), lambda v: v.update(prepared=1), lambda v: v.update(oid='124'), lambda v: v.update(visible=False)):
            value = snapshot()
            mutate(value)
            run, records, sleeps = self.harness([value])
            with self.assertRaises(RuntimeError):
                run()
            self.assertEqual(records, [value])
            self.assertEqual(sleeps, [])

    def test_own_observer_timeout_records_every_poll_and_never_claims_closure(self):
        run, records, sleeps = self.harness([snapshot()], timeout=0.25)
        with self.assertRaisesRegex(RuntimeError, 'DATABASE_NOT_QUIET'):
            run()
        self.assertEqual(len(records), 4)
        self.assertAlmostEqual(sum(sleeps), 0.25)
        self.assertTrue(all(row['sessions'] for row in records))

    def test_initial_real_zero_needs_no_sleep(self):
        run, records, sleeps = self.harness([snapshot(False)])
        run()
        self.assertEqual(len(records), 1)
        self.assertEqual(sleeps, [])

if __name__ == '__main__':
    unittest.main()
