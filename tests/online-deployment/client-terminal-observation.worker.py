"""Actual Linux directory-FD and HTTP checks; source is supplied on stdin.

Run only as a finite fixture inside the existing approved local service.
"""
import http.server
import os
import pathlib
import sys
import tempfile
import threading
import unittest

assert sys.platform == 'linux' and os.getuid() == 0
raw = sys.stdin.buffer.read(65537)
assert 0 < len(raw) <= 65536
namespace = {'__name__': 'terminal_observation_native_fixture'}
exec(compile(raw, 'online-client-terminal-observation.py', 'exec'), namespace)
observe = namespace['observe']


class NativeObservation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='sabalan-terminal-native-', dir='/tmp')
        self.root = pathlib.Path(self.temp.name) / 'coordination'
        self.root.mkdir(mode=0o700)
        self.requests = 0
        self.status = 200
        self.body = b'healthy'
        self.on_request = lambda: None
        fixture = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                fixture.requests += 1
                fixture.on_request()
                self.send_response(fixture.status)
                self.send_header('Content-Length', str(len(fixture.body)))
                self.end_headers()
                try:
                    self.wfile.write(fixture.body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def log_message(self, *arguments):
                pass

        self.server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.value = {'coordinationDirectory': str(self.root), 'targets': {name: 'http://127.0.0.1:%s/' % self.server.server_port for name in ('backend', 'frontend', 'inquiry', 'nginx')}}

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def test_actual_four_complete_http_reads_and_held_directory(self):
        result = observe(self.value)
        self.assertEqual(self.requests, 4)
        self.assertTrue(result['maintenanceAbsent'])
        self.assertEqual([row['status'] for row in result['endpoints']], [200] * 4)

    def test_existing_marker_refuses_before_any_http(self):
        (self.root / 'deployment-maintenance.json').write_text('{}')
        with self.assertRaises(RuntimeError):
            observe(self.value)
        self.assertEqual(self.requests, 0)

    def test_dangling_marker_symlink_remains_active(self):
        (self.root / 'deployment-maintenance.json').symlink_to(self.root / 'missing')
        with self.assertRaises(RuntimeError):
            observe(self.value)

    def test_marker_created_during_http_refuses_terminal_success(self):
        self.on_request = lambda: (self.root / 'deployment-maintenance.json').write_text('{}')
        with self.assertRaises(RuntimeError):
            observe(self.value)
        self.assertEqual(self.requests, 4)

    def test_parent_replacement_during_http_is_refused(self):
        def replace():
            if self.requests == 1:
                self.root.rename(pathlib.Path(self.temp.name) / 'original')
                self.root.mkdir(mode=0o700)
        self.on_request = replace
        with self.assertRaises(AssertionError):
            observe(self.value)

    def test_unhealthy_endpoint_and_oversized_body_refuse(self):
        self.status = 503
        with self.assertRaises(AssertionError):
            observe(self.value)
        self.status = 200
        self.body = b'x' * 1048577
        with self.assertRaises(AssertionError):
            observe(self.value)

    def test_unsafe_directory_and_external_proxy_url_refuse(self):
        self.root.chmod(0o777)
        with self.assertRaises(AssertionError):
            observe(self.value)
        self.root.chmod(0o700)
        self.value['targets']['backend'] = 'http://user:secret@127.0.0.1/'
        with self.assertRaises(AssertionError):
            observe(self.value)


unittest.main(argv=['client-terminal-observation.worker.py'])
