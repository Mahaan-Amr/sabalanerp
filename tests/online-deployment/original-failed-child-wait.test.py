"""Real original child exit after a negative diagnostic deadline; no native admission."""
import ast
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class FailedOriginalWaitTests(unittest.TestCase):
    def load_wait(self, root):
        source = Path(__file__).with_name('application-native.fixture.py').read_text(encoding='utf8')
        selected = next(node for node in ast.parse(source).body
                        if isinstance(node, ast.FunctionDef) and node.name == 'wait_failed_original_child')
        namespace = dict(subprocess=subprocess, root=root, sys=sys,
                         encoded=lambda value: json.dumps(value).encode(),
                         write=lambda file, raw: file.write_bytes(raw))
        exec(compile(ast.Module(body=[selected], type_ignores=[]), '<actual-original-wait-helper>', 'exec'), namespace)
        return namespace['wait_failed_original_child']

    def test_late_nonzero_exit_is_reaped_by_same_original_handle(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = subprocess.Popen([sys.executable, '-I', '-B', '-c',
                                         'import time;time.sleep(0.15);raise SystemExit(7)'],
                                        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                self.assertTrue(self.load_wait(root)(original, 0.005))
                self.assertEqual(original.returncode, 7)
                self.assertEqual(original.poll(), 7)
                receipt = json.loads((root / ('failure-original-child-wait-' + str(original.pid) + '.json')).read_bytes())
                self.assertEqual(receipt['originalPopenPid'], original.pid)
                self.assertFalse(receipt['originalPass'])
                self.assertFalse(receipt['deadlineAuthorizesClosure'])
                self.assertFalse(receipt['signalSent'])
            finally:
                original.wait()

    def test_original_exit_before_budget_does_not_mint_deadline_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = subprocess.Popen([sys.executable, '-I', '-B', '-c', 'raise SystemExit(1)'],
                                        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                self.assertFalse(self.load_wait(root)(original, 5))
                self.assertEqual(original.returncode, 1)
                self.assertEqual(list(root.iterdir()), [])
            finally:
                original.wait()


if __name__ == '__main__':
    unittest.main()
