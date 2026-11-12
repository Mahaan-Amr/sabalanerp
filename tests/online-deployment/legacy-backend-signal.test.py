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
                 Config=dict(Cmd=bridge.LEGACY_COMMAND, Entrypoint=['docker-entrypoint.sh'], Env=[], Labels={
                     'com.docker.compose.project': 'sabalanerp', 'com.docker.compose.service': 'backend',
                     'io.sabalan.performance.source-commit': bridge.LEGACY_SOURCE_LABEL,
                     'io.sabalan.performance.source-hash': bridge.LEGACY_SOURCE_LABEL}),
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

    def test_known_legacy_image_records_accepted_sms_risk_without_claiming_completion(self):
        _, snapshot = fixture()
        receipt = bridge.legacy_effect_receipt(snapshot)
        self.assertEqual(receipt['image'], bridge.LEGACY_IMAGE)
        self.assertEqual(receipt['containerId'], snapshot['container']['containerId'])
        self.assertTrue(receipt['ownerAcceptedPossibleDuplicateOrUnknownSms'])
        self.assertFalse(receipt['externalEffectsCompleted'])
        self.assertIn('Web Push', receipt['additionalNotificationUncertainty'])
        native = copy.deepcopy(snapshot)
        native['container']['kind'] = 'NATIVE_WRAPPER_NOT_REQUIRED'
        self.assertIsNone(bridge.legacy_effect_receipt(native))

    def test_forward_refuses_old_plan_without_accepted_risk_receipt(self):
        _, snapshot = fixture()
        plan = dict(deploymentId='original_deployment', releaseId='original_release', snapshot=snapshot)
        host = SimpleNamespace(protected_boundary=lambda *_: None, snapshot=lambda _: copy.deepcopy(snapshot))
        with tempfile.TemporaryDirectory() as directory, patch.object(bridge.signal, 'pidfd_send_signal', create=True) as sent, \
                patch.object(bridge, 'save') as saved:
            with self.assertRaisesRegex(RuntimeError, 'LEGACY_EFFECT_RECEIPT_REQUIRED'):
                bridge.forward_original(host, plan, 'a'*64, Path(directory)/'intent', Path(directory)/'result', 'session')
        sent.assert_not_called()
        self.assertFalse(saved.call_args.args[1]['passResult'])

    def test_tax_broker_newly_enabled_is_outside_sms_acceptance(self):
        value, _ = fixture()
        value['Config']['Env'] = ['TAXPAYER_DELIVERY_BROKER_ENDPOINT=https://broker.example']
        with self.assertRaisesRegex(RuntimeError, 'LEGACY_TAX_BROKER_EFFECT_UNACCEPTED'):
            bridge.classify_container(value, bridge.LEGACY_IMAGE)

    def test_preflight_records_actual_legacy_identity_and_accepted_risk(self):
        _, snapshot = fixture()
        daemon = dict(pid=77, startTicks='12345', bootId='original-boot', serverVersion='29.2.1', dockerRoot='/var/lib/docker')
        host = SimpleNamespace(root=Path('/repo'), snapshot=lambda _: snapshot,
                               daemon_identity=lambda: daemon,
                               persisted_manual_stop=lambda _snapshot: dict(manuallyStopped=False, sha256='a'*64, restartCount=3))
        argv = ['legacy-backend-signal.py', '--preflight', '/repo/docker-compose.prod.yml', '/private/env',
                bridge.LEGACY_IMAGE, '/repo/.deploy-state/legacy-backend-drain-original_deployment.json']
        env = dict(DEPLOYMENT_ID='original_deployment', DEPLOYMENT_RELEASE_ID='original_release')
        with patch.object(sys, 'argv', argv), patch.dict(os.environ, env), \
                patch.object(bridge, 'OriginalHost', return_value=host), patch.object(bridge, 'save') as saved:
            with patch.object(bridge.os, 'pidfd_open', create=True, return_value=44), patch.object(bridge.os, 'close'), \
                    patch.object(bridge.signal, 'pidfd_send_signal', create=True), patch.object(bridge, 'proc_identity', return_value=snapshot['node']):
                bridge.main()
        plan = saved.call_args.args[1]
        self.assertEqual(plan['legacyExternalEffectRisk'], bridge.legacy_effect_receipt(snapshot))
        self.assertEqual(plan['manualStopPreflight']['dockerDaemon'], daemon)

    def test_preflight_refuses_already_suppressed_docker_restart_before_maintenance(self):
        _, snapshot = fixture()
        daemon = dict(pid=77, startTicks='12345', bootId='original-boot', serverVersion='29.2.1', dockerRoot='/var/lib/docker')
        host = SimpleNamespace(root=Path('/repo'), snapshot=lambda _: snapshot,
                               daemon_identity=lambda: daemon,
                               persisted_manual_stop=lambda _snapshot: dict(manuallyStopped=True, sha256='a'*64, restartCount=3))
        argv = ['legacy-backend-signal.py', '--preflight', '/repo/docker-compose.prod.yml', '/private/env',
                bridge.LEGACY_IMAGE, '/repo/.deploy-state/legacy-backend-drain-original_deployment.json']
        env = dict(DEPLOYMENT_ID='original_deployment', DEPLOYMENT_RELEASE_ID='original_release')
        with patch.object(sys, 'argv', argv), patch.dict(os.environ, env), \
                patch.object(bridge, 'OriginalHost', return_value=host), patch.object(bridge, 'save') as saved, \
                patch.object(bridge.os, 'pidfd_open', create=True, return_value=44), patch.object(bridge.os, 'close'), \
                patch.object(bridge, 'proc_identity', return_value=snapshot['node']):
            with self.assertRaisesRegex(RuntimeError, 'DOCKER_ALREADY_MANUALLY_STOPPED'):
                bridge.main()
        saved.assert_not_called()

    def test_actual_observer_passes_fd9_and_late_natural_close_is_failed_without_killing_child(self):
        clock = [1_000_000_000]
        class Child:
            pid = 123
            stdout = io.BytesIO(b'0\n')
            stderr = io.BytesIO(b'')
            def wait(self, timeout=None):
                clock[0] += 46_000_000_000
                return 0
        with patch.object(bridge.subprocess, 'Popen', return_value=Child()) as popen, patch.object(bridge.time, 'monotonic_ns', side_effect=lambda: clock[0]), patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'LATE_CHILD_CLOSED_HELD'):
                bridge.observed(['docker', 'wait', 'original'], role='docker-wait')
        self.assertEqual(popen.call_args.kwargs['pass_fds'], (9,))
        self.assertTrue(bridge.children[-1]['closed'])
        self.assertEqual(bridge.children[-1]['code'], 0)
        self.assertTrue(bridge.children[-1]['deadlineExceeded'])

    def test_docker_wait_timeout_closes_only_observer_and_fails_held(self):
        class Child:
            pid = 123
            stdout = io.BytesIO(b'')
            stderr = io.BytesIO(b'')
            calls = 0
            terminated = False
            killed = False
            def wait(self, timeout=None):
                self.calls += 1
                if self.calls == 1:
                    raise bridge.subprocess.TimeoutExpired(['docker', 'wait'], timeout)
                return 143
            def terminate(self):
                self.terminated = True
            def kill(self):
                self.killed = True
        child = Child()
        with patch.object(bridge.subprocess, 'Popen', return_value=child), patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'OBSERVER_NOT_CLOSED'):
                bridge.observed(['docker', 'wait', 'original'], role='docker-wait')
        self.assertTrue(child.terminated)
        self.assertFalse(child.killed)
        self.assertTrue(bridge.children[-1]['closed'])
        self.assertTrue(bridge.children[-1]['deadlineExceeded'])
        self.assertEqual(bridge.children[-1]['code'], 143)

    def test_capture_clock_is_nine_hundred_seconds(self):
        with patch.dict(os.environ, {'DEPLOYMENT_CAPTURE_PAUSE_STARTED_NS': '0'}), \
                patch.object(bridge.time, 'monotonic_ns', return_value=599_000_000_000):
            self.assertEqual(bridge.capture_deadline_ns(), 900_000_000_000)

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
                       lambda v: v['Config']['Labels'].update({'io.sabalan.performance.source-hash': 'f' * 64}),
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
        plan = dict(deploymentId='original_deployment', releaseId='original_release', snapshot=snapshot,
                    legacyExternalEffectRisk=bridge.legacy_effect_receipt(snapshot))
        host = SimpleNamespace(protected_boundary=lambda *_: None, snapshot=lambda _: copy.deepcopy(snapshot))
        audits = []
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'DEPLOYMENT_CAPTURE_PAUSE_STARTED_NS': '0'}), \
                patch.object(bridge.time, 'monotonic_ns', return_value=899_000_000_000), \
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

    def test_stopped_checkpoint_rejects_restart_or_missing_manual_flag(self):
        _, snapshot = fixture()
        container = snapshot['container']
        state = dict(ID=container['containerId'], Image=container['image'], Created=container['created'],
                     RestartCount=3, HasBeenManuallyStopped=True,
                     State=dict(StartedAt=container['startedAt'], Running=False, Pid=0,
                                ExitCode=0, OOMKilled=False))
        host = object.__new__(bridge.OriginalHost)
        barrier = dict(restartCount=3)
        with patch.object(bridge, 'private', return_value=(state, 'a'*64)):
            self.assertEqual(host.persisted_stopped(snapshot, barrier)['restartCount'], 3)
        for field, value in [('RestartCount', 4), ('HasBeenManuallyStopped', False)]:
            changed = copy.deepcopy(state)
            changed[field] = value
            with patch.object(bridge, 'private', return_value=(changed, 'a'*64)):
                with self.assertRaisesRegex(RuntimeError, 'STOPPED_CHECKPOINT_UNPROVEN'):
                    host.persisted_stopped(snapshot, barrier)

    def test_forward_validates_birth_twice_uses_one_pidfd_term_and_keeps_original_wait(self):
        _, snapshot = fixture()
        plan = dict(deploymentId='original_deployment', releaseId='original_release', snapshot=snapshot,
                    legacyExternalEffectRisk=bridge.legacy_effect_receipt(snapshot))
        events, audits = [], {}

        class Host:
            def protected_boundary(self, *_args): events.append('BOUNDARY')
            def snapshot(self, _image): events.append('SNAPSHOT'); return copy.deepcopy(snapshot)
            def manual_stop_barrier(self, _plan): events.append('DURABLE_MANUAL_STOP'); return dict(manualStopPersisted=True, restartCount=3, dockerDaemon=dict(pid=7))
            def daemon_identity(self): return dict(pid=7)
            def persisted_stopped(self, _snapshot, _barrier): return dict(manuallyStopped=True, restartCount=3)
            def docker(self, argv): events.append(argv[0]); return b'0\n'
            def inspect(self, _container):
                c = snapshot['container']
                return dict(Id=c['containerId'], Image=c['image'], Created=c['created'], RestartCount=3, State=dict(StartedAt=c['startedAt'], Pid=0,
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
        self.assertFalse(result['legacyExternalEffectRisk']['externalEffectsCompleted'])
        self.assertLess(events.index('BOUNDARY'), events.index('AUDIT'))
        self.assertLess(events.index('AUDIT'), events.index('BOUNDARY', events.index('BOUNDARY') + 1))
        self.assertIn('wait', events)
        self.assertTrue(audits[next(key for key in audits if key.endswith('result'))]['passResult'])

    def test_forward_persists_restart_suppression_before_signalling_node(self):
        _, snapshot = fixture()
        plan = dict(deploymentId='original_deployment', releaseId='original_release', snapshot=snapshot,
                    legacyExternalEffectRisk=bridge.legacy_effect_receipt(snapshot))
        events, audits = [], []

        class Host:
            def protected_boundary(self, *_args): events.append('BOUNDARY')
            def snapshot(self, _image): return copy.deepcopy(snapshot)
            def manual_stop_barrier(self, expected):
                events.append('DURABLE_MANUAL_STOP')
                self_outer.assertEqual(expected['snapshot'], snapshot)
                return dict(dockerDaemon=dict(pid=7), restartCount=3, manualStopPersisted=True)
            def daemon_identity(self): return dict(pid=7)
            def persisted_stopped(self, _snapshot, _barrier): return dict(manuallyStopped=True, restartCount=3)
            def docker(self, argv):
                events.append(argv[0])
                return b'0\n'
            def inspect(self, _container):
                c = snapshot['container']
                return dict(Id=c['containerId'], Image=c['image'], Created=c['created'], RestartCount=3, State=dict(
                    StartedAt=c['startedAt'], Pid=0, Running=False, OOMKilled=False, ExitCode=0, Error=''))

        self_outer = self
        def sent(*_args): events.append('NODE_SIGTERM')
        with tempfile.TemporaryDirectory() as directory, patch.object(bridge.os, 'pidfd_open', create=True, return_value=44), \
                patch.object(bridge.signal, 'pidfd_send_signal', create=True, side_effect=sent), \
                patch.object(bridge.os, 'close'), patch.object(bridge, 'proc_identity', return_value=snapshot['node']), \
                patch.object(bridge, 'save', side_effect=lambda _file, value: audits.append(copy.deepcopy(value))):
            bridge.forward_original(Host(), plan, 'a'*64, Path(directory)/'intent', Path(directory)/'result', 'session')
        self.assertLess(events.index('DURABLE_MANUAL_STOP'), events.index('NODE_SIGTERM'))
        self.assertTrue(audits[-1]['manualStopBarrier']['manualStopPersisted'])

    def test_forward_refuses_to_signal_node_when_docker_manual_stop_was_not_persisted(self):
        _, snapshot = fixture()
        daemon = dict(serverVersion='29.2.1', dockerRoot='/var/lib/docker', pid=77, startTicks='12345')
        plan = dict(deploymentId='original_deployment', releaseId='original_release', snapshot=snapshot,
                    legacyExternalEffectRisk=bridge.legacy_effect_receipt(snapshot),
                    manualStopPreflight=dict(dockerDaemon=daemon,
                                             checkpoint=dict(manuallyStopped=False, sha256='a'*64, restartCount=3)))
        events, audits = [], []

        class Host:
            manual_stop_barrier = bridge.OriginalHost.manual_stop_barrier
            def protected_boundary(self, *_args): pass
            def snapshot(self, _image): return copy.deepcopy(snapshot)
            def daemon_identity(self): return daemon
            def persisted_manual_stop(self, _snapshot):
                events.append('READ_PERSISTED')
                return dict(manuallyStopped=False, sha256='a'*64, restartCount=3)
            def docker(self, argv):
                events.append(argv[0])
                return (snapshot['container']['containerId']+'\n').encode()
            def inspect(self, _container): return {}

        with tempfile.TemporaryDirectory() as directory, patch.object(bridge.os, 'pidfd_open', create=True, return_value=44), \
                patch.object(bridge.os, 'close'), patch.object(bridge.signal, 'pidfd_send_signal', create=True) as sent, \
                patch.object(bridge, 'proc_identity', return_value=snapshot['node']), \
                patch.object(bridge, 'save', side_effect=lambda _file, value: audits.append(copy.deepcopy(value))):
            with self.assertRaisesRegex(RuntimeError, 'MANUAL_STOP_NOT_PERSISTED'):
                bridge.forward_original(Host(), plan, 'a'*64, Path(directory)/'intent', Path(directory)/'result', 'session')
        self.assertIn('kill', events)
        sent.assert_not_called()
        self.assertFalse(audits[-1]['passResult'])

    def test_daemon_birth_change_refuses_restart_suppression_before_cont(self):
        _, snapshot = fixture()
        preflight_daemon = dict(pid=77, startTicks='12345', bootId='original-boot', serverVersion='29.2.1', dockerRoot='/var/lib/docker')
        plan = dict(deploymentId='original_deployment', releaseId='original_release', snapshot=snapshot,
                    legacyExternalEffectRisk=bridge.legacy_effect_receipt(snapshot),
                    manualStopPreflight=dict(dockerDaemon=preflight_daemon,
                                             checkpoint=dict(manuallyStopped=False, sha256='a'*64, restartCount=3)))
        calls, audits = [], []

        class Host:
            manual_stop_barrier = bridge.OriginalHost.manual_stop_barrier
            def protected_boundary(self, *_args): pass
            def snapshot(self, _image): return copy.deepcopy(snapshot)
            def daemon_identity(self): return {**preflight_daemon, 'startTicks': 'replacement'}
            def persisted_manual_stop(self, _snapshot):
                calls.append('persisted')
                return dict(manuallyStopped=False, sha256='a'*64, restartCount=3)
            def docker(self, argv): calls.append(argv[0]); return b''
            def inspect(self, _container): return {}

        with tempfile.TemporaryDirectory() as directory, patch.object(bridge.os, 'pidfd_open', create=True, return_value=44), \
                patch.object(bridge.os, 'close'), patch.object(bridge.signal, 'pidfd_send_signal', create=True) as sent, \
                patch.object(bridge, 'proc_identity', return_value=snapshot['node']), \
                patch.object(bridge, 'save', side_effect=lambda _file, value: audits.append(copy.deepcopy(value))):
            with self.assertRaisesRegex(RuntimeError, 'DOCKER_DAEMON_CHANGED'):
                bridge.forward_original(Host(), plan, 'a'*64, Path(directory)/'intent', Path(directory)/'result', 'session')
        self.assertNotIn('kill', calls)
        sent.assert_not_called()
        self.assertFalse(audits[-1]['passResult'])

    def test_forward_records_same_container_new_runtime_after_wait_failure(self):
        _, snapshot = fixture()
        plan = dict(deploymentId='original_deployment', releaseId='original_release', snapshot=snapshot,
                    legacyExternalEffectRisk=bridge.legacy_effect_receipt(snapshot))
        audits = {}
        class Host:
            def protected_boundary(self, *_args): pass
            def snapshot(self, _image): return copy.deepcopy(snapshot)
            def manual_stop_barrier(self, _snapshot): return dict(manualStopPersisted=True)
            def docker(self, _argv): raise RuntimeError('LEGACY_SIGNAL_OBSERVER_NOT_CLOSED')
            def inspect(self, _container):
                return dict(Id=snapshot['container']['containerId'], Image=snapshot['container']['image'],
                            Created=snapshot['container']['created'], RestartCount=8,
                            State=dict(StartedAt='2026-10-20T00:01:00Z', FinishedAt='2026-10-20T00:00:59Z',
                                       Pid=222, Running=True, OOMKilled=False, ExitCode=0, Error=''))
        with tempfile.TemporaryDirectory() as directory, patch.object(bridge.os, 'pidfd_open', create=True, return_value=44), \
                patch.object(bridge.os, 'close'), patch.object(bridge.signal, 'pidfd_send_signal', create=True), \
                patch.object(bridge, 'proc_identity', return_value=snapshot['node']), \
                patch.object(bridge, 'save', side_effect=lambda file, value: audits.setdefault(str(file), copy.deepcopy(value))):
            with self.assertRaisesRegex(RuntimeError, 'OBSERVER_NOT_CLOSED'):
                bridge.forward_original(Host(), plan, 'a'*64, Path(directory)/'intent', Path(directory)/'result', 'session')
        result = audits[next(key for key in audits if key.endswith('result'))]
        self.assertFalse(result['passResult'])
        self.assertTrue(result['restartObserved'])
        self.assertEqual(result['postSignalContainer']['RestartCount'], 8)
        self.assertTrue(result['postSignalContainer']['State']['Running'])

    def test_changed_birth_bad_boundary_or_nonzero_exit_cannot_turn_into_success(self):
        _, snapshot = fixture()
        plan = dict(deploymentId='original_deployment', releaseId='original_release', snapshot=snapshot,
                    legacyExternalEffectRisk=bridge.legacy_effect_receipt(snapshot))
        for failure in ['boundary', 'birth', 'exit']:
            audits = []

            class Host:
                def protected_boundary(self, *_args):
                    if failure == 'boundary': raise RuntimeError('lease or public boundary lost')
                def snapshot(self, _image): return copy.deepcopy(snapshot)
                def manual_stop_barrier(self, _snapshot): return dict(manualStopPersisted=True)
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
