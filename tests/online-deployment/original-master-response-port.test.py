"""Exercise the launcher's original pipe demultiplexer without starting deploy."""
import ast
import json
import os
from pathlib import Path
import queue
import threading
import unittest


class OriginalMasterResponsePortTest(unittest.TestCase):
    def namespace(self, descriptor):
        source = Path(__file__).parents[2] / 'deploy/scripts/online-release-launcher.py'
        tree = ast.parse(source.read_text())
        names = {'require', 'OriginalInputEOF', 'OriginalMasterPort'}
        selected = ast.Module(body=[node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names], type_ignores=[])
        stream = os.fdopen(descriptor, 'rb', buffering=0)
        def frame(_descriptor, maximum):
            raw = stream.readline(maximum)
            if not raw or not raw.endswith(b'\n'):
                raise values['OriginalInputEOF']('ORIGINAL_TEST_PIPE_CLOSED')
            return json.loads(raw)
        values = dict(threading=threading, queue=queue, frame=frame)
        exec(compile(selected, str(source), 'exec'), values)
        return values, stream

    def test_original_pipe_routes_out_of_order_point_and_wal_replies(self):
        read, write = os.pipe()
        values, stream = self.namespace(read)
        port = values['OriginalMasterPort']()
        point = port.expect(('point', 'point-challenge'))
        wal = port.expect(('wal', 'wal-challenge'))
        records = [dict(format='sabalan-signed-original-wal-window-verification/v1', decision=dict(challenge='wal-challenge')),
                   dict(format='sabalan-original-physical-point-verification-response/v1', challenge='point-challenge')]
        for value in records:
            os.write(write, json.dumps(value).encode() + b'\n')
        self.assertEqual(port.receive(point), records[1])
        self.assertEqual(port.receive(wal), records[0])
        os.close(write)
        port.thread.join(2)
        self.assertFalse(port.thread.is_alive())
        self.assertIsNotNone(port.error)
        stream.close()

    def test_unknown_reply_fails_all_original_waiters_without_adoption(self):
        read, write = os.pipe()
        values, stream = self.namespace(read)
        port = values['OriginalMasterPort']()
        waiting = port.expect(('metadata', 'actual-point'))
        os.write(write, b'{"format":"caller-approved"}\n')
        with self.assertRaises(RuntimeError):
            port.receive(waiting)
        port.thread.join(2)
        with self.assertRaises(RuntimeError):
            port.expect(('metadata', 'other'))
        os.close(write)
        stream.close()


if __name__ == '__main__':
    unittest.main()
