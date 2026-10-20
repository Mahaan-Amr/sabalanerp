"""Pure bridge guards; real Linux pidfd smoke is explicitly separate."""
import copy
import io
import importlib.util
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[2] / 'deploy/scripts/legacy-backend-signal.py'
spec = importlib.util.spec_from_file_location('legacy_bridge_test_subject', SOURCE)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


def fixture():
    value = dict(Id='1' * 64, Created='2026-10-19T00:00:00Z', Image=bridge.LEGACY_IMAGE,
                 Config=dict(Cmd=bridge.LEGACY_COMMAND, Entrypoint=['docker-entrypoint.sh'], Labels={
                     'com.docker.compose.project': 'sabalanerp', 'com.docker.compose.service': 'backend',
                     'io.sabalan.performance.source-commit': bridge.LEGACY_COMMIT}),
                 State=dict(Running=True, Pid=120, OOMKilled=False, StartedAt='2026-10-20T00:00:00Z'), Mounts=[])
    container = bridge.classify_container(value, bridge.LEGACY_IMAGE)
    init = dict(pid=120, ppid=10, startTicks='1234', pidNamespace='pid:[123]', exe='/usr/bin/dash',
                cwd='/app', cgroup='/docker/' + value['Id'], argv=bridge.LEGACY_COMMAND)
    node = dict(pid=121, ppid=120, startTicks='1235', pidNamespace=init['pidNamespace'], exe='/usr/local/bin/node',
                cwd='/app', cgroup=init['cgroup'], argv=['node', 'dist/index.js'])
    snapshot = dict(container=container, init=init, node=node, bootId='original-boot')
    return value, snapshot


class LegacyGuards(unittest.TestCase):
    def setUp(self):
        bridge.children.clear()
        bridge.interrupted = False

    def test_actual_observer_passes_fd9_and_late_natural_close_is_failed_without_killing_child(self):
        clock = [1_000_000_000]
        class Child:
            pid = 123
            stdout = io.BytesIO(b'0\n')
            stderr = io.BytesIO(b'')
            def wait(self):
                clock[0] += 46_000_000_000
                return 0
        with patch.object(bridge.subprocess, 'Popen', return_value=Child()) as popen, patch.object(bridge.time, 'monotonic_ns', side_effect=lambda: clock[0]), patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'LATE_CHILD_CLOSED_HELD'):
                bridge.observed(['docker', 'wait', 'original'], role='docker-wait')
        self.assertEqual(popen.call_args.kwargs['pass_fds'], (9,))
        self.assertTrue(bridge.children[-1]['closed'])
        self.assertEqual(bridge.children[-1]['code'], 0)
        self.assertTrue(bridge.children[-1]['deadlineExceeded'])

    @unittest.skipUnless(os.name == 'posix', 'actual inherited FD9 is Linux-only')
    def test_actual_native_child_inherits_original_fd9(self):
        previous = None
        try:
            previous = os.dup(9)
        except OSError:
            pass
        try:
            with tempfile.TemporaryFile() as original:
                os.dup2(original.fileno(), 9)
                result = bridge.observed([sys.executable, '-c', 'import os; print(os.fstat(9).st_ino)'])
                self.assertEqual(int(result), os.fstat(9).st_ino)
        finally:
            if previous is not None:
                os.dup2(previous, 9)
                os.close(previous)
            else:
                os.close(9)

    def test_known_immutable_image_exact_parent_node_and_namespace_required(self):
        value, snapshot = fixture()
        bridge.validate_process_shape(snapshot['container'], snapshot['init'], snapshot['node'], [(120, 10), (121, 120)], 'pid:[host]')
        for mutate in [lambda v: v.update(Image='sha256:' + 'f' * 64),
                       lambda v: v['Config'].update(Cmd=['sh', '-c', 'node other.js']),
                       lambda v: v['Config']['Labels'].update({'com.docker.compose.project': 'fintech'}),
                       lambda v: v['Config']['Labels'].update({'io.sabalan.performance.source-commit': 'f' * 40}),
                       lambda v: v['Mounts'].append(dict(Destination='/app'))]:
            changed = copy.deepcopy(value)
            mutate(changed)
            with self.assertRaises(RuntimeError):
                bridge.classify_container(changed, bridge.LEGACY_IMAGE)
        for mutate in [lambda s: s['node'].update(ppid=999), lambda s: s['node'].update(pidNamespace='pid:[foreign]'),
                       lambda s: s['node'].update(argv=['node', 'dist/other.js']),
                       lambda s: s['node'].update(exe='/tmp/node'), lambda s: s['node'].update(cgroup='/docker/foreign')]:
            changed = copy.deepcopy(snapshot)
            mutate(changed)
            with self.assertRaises(RuntimeError):
                bridge.validate_process_shape(changed['container'], changed['init'], changed['node'], [(120, 10), (121, 120)], 'pid:[host]')
        with self.assertRaises(RuntimeError):
            bridge.validate_process_shape(snapshot['container'], snapshot['init'], snapshot['node'], [(120, 10), (121, 120), (122, 121)], 'pid:[host]')

    def test_original_capture_budget_must_allow_graceful_shutdown_before_any_signal(self):
        _, snapshot = fixture()
        plan = dict(deploymentId='original_deployment', releaseId='original_release', snapshot=snapshot)
        host = SimpleNamespace(protected_boundary=lambda *_: None, snapshot=lambda _: copy.deepcopy(snapshot))
        audits = []
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'DEPLOYMENT_CAPTURE_PAUSE_STARTED_NS': '0'}), \
                patch.object(bridge.time, 'monotonic_ns', return_value=599_000_000_000), \
                patch.object(bridge.os, 'pidfd_open', create=True, return_value=44), patch.object(bridge.os, 'close'), \
                patch.object(bridge.signal, 'pidfd_send_signal', create=True) as sent, \
                patch.object(bridge, 'proc_identity', return_value=snapshot['node']), \
                patch.object(bridge, 'save', side_effect=lambda _, value: audits.append(copy.deepcopy(value))):
            with self.assertRaisesRegex(RuntimeError, 'INSUFFICIENT_CAPTURE_BUDGET'):
                bridge.forward_original(host, plan, 'a'*64, Path(directory)/'intent', Path(directory)/'result', 'session')
        sent.assert_not_called()
        self.assertEqual(len(audits), 2)
        self.assertFalse(audits[-1]['passResult'])

    def test_native_guardian_shape_needs_no_forwarding_and_unknown_wrapper_refuses(self):
        value, snapshot = fixture()
        value['Config']['Cmd'] = bridge.NATIVE_COMMAND
        value['Image'] = 'sha256:' + 'f' * 64
        container = bridge.classify_container(value, value['Image'])
        init = {**snapshot['init'], 'argv': ['python3', '/app/scripts/backend-runtime-owner.py', 'sh', 'scripts/start-backend.sh'], 'exe': '/usr/bin/python3.11'}
        bridge.validate_process_shape(container, init, None, [(120, 10)], 'pid:[host]')
        self.assertEqual(container['kind'], 'NATIVE_WRAPPER_NOT_REQUIRED')
        with self.assertRaises(RuntimeError):
            bridge.validate_process_shape(container, {**init, 'argv': ['python3', '/tmp/fake.py']}, None, [(120, 10)], 'pid:[host]')

    def test_wait_zero_never_hides_nonzero_forced_oom_or_replaced_container(self):
        _, snapshot = fixture()
        expected = snapshot['container']
        actual = dict(Id=expected['containerId'], Created=expected['created'], Image=expected['image'], State=dict(
            StartedAt=expected['startedAt'], Pid=0, Running=False, OOMKilled=False, ExitCode=0, Error=''))
        bridge.verify_exited(actual, expected, b'0\n')
        for mutate in [lambda v: v['State'].update(ExitCode=137), lambda v: v['State'].update(OOMKilled=True),
                       lambda v: v['State'].update(StartedAt='different'), lambda v: v.update(Id='f' * 64), lambda v: v.update(Created='different'),
                       lambda v: v['State'].update(Pid=123, Running=True)]:
            changed = copy.deepcopy(actual)
            mutate(changed)
            with self.assertRaises(RuntimeError):
                bridge.verify_exited(changed, expected, b'0')
        with self.assertRaises(RuntimeError):
            bridge.verify_exited(actual, expected, b'1')

    def test_forward_validates_birth_twice_uses_one_pidfd_term_and_keeps_original_wait(self):
        _, snapshot = fixture()
        plan = dict(deploymentId='original_deployment', releaseId='original_release', snapshot=snapshot)
        events, audits = [], {}

        class Host:
            def protected_boundary(self, *_args): events.append('BOUNDARY')
            def snapshot(self, _image): events.append('SNAPSHOT'); return copy.deepcopy(snapshot)
            def docker(self, argv): events.append(argv[0]); return b'0\n'
            def inspect(self, _container):
                c = snapshot['container']
                return dict(Id=c['containerId'], Image=c['image'], Created=c['created'], State=dict(StartedAt=c['startedAt'], Pid=0,
                            Running=False, OOMKilled=False, ExitCode=0, Error=''))

        def save(file, value): audits[str(file)] = copy.deepcopy(value); events.append('AUDIT')
        with tempfile.TemporaryDirectory() as directory, patch.object(bridge.os, 'pidfd_open', create=True, return_value=44) as opened, \
                patch.object(bridge.signal, 'pidfd_send_signal', create=True) as sent, patch.object(bridge.os, 'close') as closed, \
                patch.object(bridge, 'proc_identity', return_value=snapshot['node']), patch.object(bridge, 'save', side_effect=save):
            result = bridge.forward_original(Host(), plan, 'a' * 64, Path(directory) / 'intent', Path(directory) / 'result', 'session')
        opened.assert_called_once_with(121, 0)
        sent.assert_called_once_with(44, signal.SIGTERM, None, 0)
        closed.assert_called_once_with(44)
        self.assertTrue(result['legacyContainerExitedCleanly'])
        self.assertFalse(result['applicationNativeClosureInferred'])
        self.assertLess(events.index('BOUNDARY'), events.index('AUDIT'))
        self.assertLess(events.index('AUDIT'), events.index('BOUNDARY', events.index('BOUNDARY') + 1))
        self.assertIn('wait', events)
        self.assertTrue(audits[next(key for key in audits if key.endswith('result'))]['passResult'])

    def test_changed_birth_bad_boundary_or_nonzero_exit_cannot_turn_into_success(self):
        _, snapshot = fixture()
        plan = dict(deploymentId='original_deployment', releaseId='original_release', snapshot=snapshot)
        for failure in ['boundary', 'birth', 'exit']:
            audits = []

            class Host:
                def protected_boundary(self, *_args):
                    if failure == 'boundary': raise RuntimeError('lease or public boundary lost')
                def snapshot(self, _image): return copy.deepcopy(snapshot)
                def docker(self, _argv): return b'1'
                def inspect(self, _container): return {}

            def save(_file, value): audits.append(copy.deepcopy(value))
            identity = snapshot['node'] if failure != 'birth' else {**snapshot['node'], 'startTicks': 'replacement'}
            with tempfile.TemporaryDirectory() as directory, patch.object(bridge.os, 'pidfd_open', create=True, return_value=44), \
                    patch.object(bridge.signal, 'pidfd_send_signal', create=True) as sent, patch.object(bridge.os, 'close'), \
                    patch.object(bridge, 'proc_identity', return_value=identity), patch.object(bridge, 'save', side_effect=save):
                with self.assertRaises((RuntimeError, KeyError)):
                    bridge.forward_original(Host(), plan, 'a' * 64, Path(directory) / 'intent', Path(directory) / 'result', 'session')
                self.assertEqual(sent.call_count, 1 if failure == 'exit' else 0)
            self.assertFalse(audits[-1]['passResult'])

    def test_actual_boundary_method_requires_session_marker_sql_lease_and_both_public_503s(self):
        _, snapshot = fixture()
        plan = dict(deploymentId='original_deployment', releaseId='original_release', snapshot=snapshot)
        session = dict(deploymentId=plan['deploymentId'], releaseId=plan['releaseId'], leaseToken='original_lease_token', phase='TRAFFIC_BLOCKED')
        environment = dict(DEPLOYMENT_ID=plan['deploymentId'], DEPLOYMENT_RELEASE_ID=plan['releaseId'], DEPLOYMENT_PHASE='TRAFFIC_BLOCKED')
        for failure in [None, 'session', 'marker', 'lease', 'public']:
            events = []
            current = copy.deepcopy(session)
            marker = dict(deploymentId=plan['deploymentId'], releaseId=plan['releaseId'])
            if failure == 'session': current['phase'] = 'SERVING'
            if failure == 'marker': marker['releaseId'] = 'unrelated_release'

            class Connection:
                def __init__(self, domain, **_kwargs): events.append(domain)
                def request(self, method, url): self.assertion = (method, url)
                def getresponse(self): return SimpleNamespace(status=200 if failure == 'public' else 503)
                def close(self): pass

            with tempfile.TemporaryDirectory() as directory:
                env_file = Path(directory) / 'environment'
                env_file.write_text('DOMAIN=erp.example\nINQUIRY_DOMAIN=inquiry.example\n')
                value = dict(Mounts=[dict(Destination='/app/recovery-coordination', RW=True, Source=directory)])
                host = SimpleNamespace(inspect=lambda _id: value, compose=['docker', 'compose'], environment=env_file,
                                       assert_original=lambda: events.append('ORIGINAL'))
                def private(file, mode):
                    self.assertEqual(mode, 0o600)
                    return (marker if str(file).endswith('deployment-maintenance.json') else current), 'hash'
                def observed(argv, stdin=None, role=None):
                    self.assertEqual(role, 'read-only-original-lease')
                    self.assertIn(b"phase='TRAFFIC_BLOCKED'", stdin)
                    self.assertIn(b'"leaseExpiresAt">clock_timestamp()', stdin)
                    events.append('LEASE')
                    return json.dumps(dict(owned=failure != 'lease')).encode()
                with patch.dict(os.environ, environment), patch.object(bridge, 'private', side_effect=private), \
                        patch.object(bridge, 'observed', side_effect=observed), patch.object(bridge.http.client, 'HTTPSConnection', Connection):
                    if failure:
                        with self.assertRaises(RuntimeError):
                            bridge.OriginalHost.protected_boundary(host, plan, Path(directory) / 'session')
                    else:
                        bridge.OriginalHost.protected_boundary(host, plan, Path(directory) / 'session')
                        self.assertEqual(events, ['LEASE', 'erp.example', 'inquiry.example', 'ORIGINAL'])


if __name__ == '__main__':
    unittest.main()
