"""Host negative checks: no child, database or native fixture is started."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('readonly_entry_subject', Path(__file__).resolve().parents[2] / 'deploy/scripts/readonly-transport-retirement.py')
subject = importlib.util.module_from_spec(spec)
spec.loader.exec_module(subject)


class ReadonlyEntryTests(unittest.TestCase):
    def prepared(self):
        directory = Path(__file__).resolve().parent
        command = ['/usr/bin/python3', '-I', '-B', str(directory / 'online-runtime-owner.py'),
                   '/usr/local/bin/node', '-e', subject.ORIGINAL_APPLICATION_BOOTSTRAP,
                   str(directory / 'application-worker.cjs'), 'application-http']
        environment = dict(NODE_PATH='/app/node_modules', NODE_ENV='test', APPLICATION_NATIVE_CWD=str(directory / 'app'),
                           APPLICATION_ACCEPTANCE_VERSION_ROOT=str(directory / 'versions'), APPLICATION_ACCEPTANCE_PHASE='seed')
        return directory, command, environment

    def test_unreviewed_program_or_extra_argument_refused(self):
        for mutation in ['bootstrap', 'program', 'extra', 'node-executable', 'python-executable']:
            with self.subTest(mutation=mutation):
                directory, command, environment = self.prepared()
                if mutation == 'bootstrap':
                    command[6] = 'require("unreviewed-module")'
                elif mutation == 'program':
                    command[7] = str(directory / 'other-worker.cjs')
                elif mutation == 'extra':
                    command.append('--other-mode')
                elif mutation == 'node-executable':
                    command[4] = 'node'
                else:
                    command[0] = 'python3'
                with self.assertRaisesRegex(RuntimeError, 'ORIGINAL_OWNER_UNPROVEN'):
                    subject.assert_reviewed_application_entry(directory, command, environment)

    def test_program_loading_environment_refused(self):
        for key, value in [('NODE_OPTIONS','--require=other.cjs'), ('NODE_OPTIONS','--import=other.mjs'),
                           ('NODE_OPTIONS','--eval=1'), ('NODE_PRELOAD','other.cjs'), ('LD_PRELOAD','other.so'),
                           ('LD_AUDIT','other.so'), ('LD_LIBRARY_PATH','/other'), ('PYTHONPATH','/other'),
                           ('NODE_PATH','/other')]:
            with self.subTest(key=key,value=value):
                directory, command, environment = self.prepared()
                environment[key] = value
                with self.assertRaisesRegex(RuntimeError, 'ORIGINAL_OWNER_UNPROVEN'):
                    subject.assert_reviewed_application_entry(directory, command, environment)


if __name__ == '__main__':
    unittest.main()
