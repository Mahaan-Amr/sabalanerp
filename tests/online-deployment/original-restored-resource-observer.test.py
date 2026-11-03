"""Linux filesystem/Popen component tests; no application or COMPLETE proof."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import signal
import sys
import tempfile
import types
import unittest

if 'OBS_SOURCE' in globals():
    observer = types.ModuleType('original_resource_component')
    exec(compile(OBS_SOURCE, 'original-restored-resource-observer.py', 'exec'), observer.__dict__)
else:
    file = Path(__file__).resolve().parents[2] / 'deploy/scripts/original-restored-resource-observer.py'
    spec = importlib.util.spec_from_file_location('original_resource_component', file)
    observer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(observer)

if 'PUB_SOURCE' in globals():
    publisher = types.ModuleType('original_scope_publication_component')
    exec(compile(PUB_SOURCE, 'original-complete-scope-publication.py', 'exec'), publisher.__dict__)
else:
    file = Path(__file__).resolve().parents[2] / 'deploy/scripts/original-complete-scope-publication.py'
    spec = importlib.util.spec_from_file_location('original_scope_publication_component', file)
    publisher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(publisher)


@unittest.skipUnless(sys.platform == 'linux', 'Requires actual Linux inode/mode/pipe semantics')
class ActualOriginalResourceReaders(unittest.TestCase):
    def test_journals_and_immutable_namespace_keep_their_producers_exact_modes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ['deployment-runtime-native.json', 'state.json', 'claim.json', 'scope.json']:
                file = root / name
                file.write_bytes(b'{}')
                file.chmod(0o400 if name == 'scope.json' else 0o600)
            _, modes, snapshots = observer.http_record_snapshots(root, root)
            self.assertEqual(modes, [0o600, 0o600, 0o600, 0o400])
            self.assertEqual(len(snapshots), 4)
            (root / 'scope.json').chmod(0o600)
            with self.assertRaises(RuntimeError): observer.http_record_snapshots(root, root)
            (root / 'scope.json').chmod(0o400)
            (root / 'state.json').chmod(0o400)
            with self.assertRaises(RuntimeError): observer.http_record_snapshots(root, root)

    def publication_input(self, directory):
        operation = 'a'*32
        key = directory / 'qualification-controller-public-key.pem'
        key.write_bytes(b'component-key-bytes'); key.chmod(0o444)
        held = directory / 'held.json'
        held.write_bytes(b'component-held-negative'); held.chmod(0o400)
        grants = []
        for char in ['b', 'c', 'd']:
            scope = dict(runtimeId=char*64, releaseId='qa-complete-'+operation,
                         coordinationDirectory='/app/runtime-authority/application-native-'+operation+'/restored-complete-app/coherent-private/coordination')
            raw = json.dumps(scope).encode()
            grants.append(dict(name=char*64+'.json', sha256=observer.sha(raw), rawBase64=observer.base64.b64encode(raw).decode()))
        return dict(operation=operation, grants=grants, trustSha256=observer.sha(key.read_bytes()))

    def test_three_new_scopes_preserve_actual_old_entries_key_and_negative_holds(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); request = self.publication_input(root)
            before = publisher.snapshot(root)
            result = publisher.publish(root, request)
            self.assertTrue(result['originalTrustPreserved'])
            after = publisher.snapshot(root)
            self.assertEqual({k: after[k] for k in before}, before)
            self.assertEqual(len(after), len(before)+3)
            with self.assertRaises(RuntimeError): publisher.publish(root, request)
            self.assertEqual(publisher.snapshot(root), after)

    def test_all_scope_inputs_are_checked_before_any_write_and_no_symlink_is_adopted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); request = self.publication_input(root); before = publisher.snapshot(root)
            request['grants'][2]['sha256'] = '0'*64
            with self.assertRaises(RuntimeError): publisher.publish(root, request)
            self.assertEqual(publisher.snapshot(root), before)
            link = root / 'alias'; link.symlink_to(root / 'held.json')
            with self.assertRaises(RuntimeError): publisher.snapshot(root)

    def test_http_controls_require_actual_birth_scope_quiet_work_and_exact_sql_fence(self):
        # Real finite /proc child, explicitly modeled runtime/SQL records.
        child = subprocess.Popen([sys.executable, '-I', '-B', '-c', 'import sys; print("ready",flush=True); sys.stdin.read()'],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            self.assertEqual(child.stdout.readline(), b'ready\n')
            scope = dict(runtimeId='a'*64, role='serving', nonce='b'*64, releaseId='qa-complete-'+'c'*32,
                         image='sha256:'+'d'*64, database=dict(name='modeled_private_copy', systemIdentifier='123'))
            grant = dict(scope=scope, sha256='e'*64)
            encode = lambda v: json.dumps(v, sort_keys=True, separators=(',', ':')).encode()
            native = dict(format='sabalan-runtime-native/v1', phase='ACTIVE', guardian=observer.process_birth(os.getpid()),
                          role='serving', initialDatabase=dict(name=scope['database']['name']), clusterIdentifier='123',
                          onlineScope=dict(scope=scope, sha256=grant['sha256']))
            native_raw = encode(native)
            namespace_raw = encode(dict(format='sabalan-runtime-namespace/v1', scope=dict(runtimeId=scope['runtimeId'])))
            claim_raw = encode(dict(format='sabalan-runtime-claim/v2', birth=observer.process_birth(child.pid),
                                    native=dict(scopeSha256=grant['sha256'], claimSha256=observer.sha(native_raw)),
                                    scopeSha256=observer.sha(namespace_raw)))
            work = dict(format='sabalan-runtime-boundary/v1', phase='QUIESCENT', claimSha256=observer.sha(claim_raw))
            events = [dict(event=name, actorId='f'*64, scopeSha256=grant['sha256']) for name in ['READY', 'PREPARED']]
            target = dict(runtimeId=scope['runtimeId'], nonceSha256=observer.sha(scope['nonce'].encode()),
                          releaseId=scope['releaseId'], imageIdentity=scope['image'], scopeSha256=grant['sha256'], phase='ACTIVE')
            sql = dict(database=dict(name=scope['database']['name'], oid='99', systemIdentifier='123'),
                       visible=True, busy=0, prepared=0, targets=[target])
            def check(prepared=False):
                observer.validate_http_records(native_raw=native_raw, work_raw=encode(work), claim_raw=claim_raw,
                                               namespace_raw=namespace_raw, grant=grant, birth=observer.process_birth(os.getpid()),
                                               events=events if prepared else events[:1], actor_id='f'*64, prepared=prepared, sql=sql)
            check()
            with self.assertRaises(RuntimeError): check(True)
            target['phase'] = 'DRAINING'
            check(True)
            for key, value in [('busy', 1), ('prepared', 1), ('visible', False)]:
                old = sql[key]; sql[key] = value
                with self.assertRaises(RuntimeError): check(True)
                sql[key] = old
            work['phase'] = 'ACTIVE'
            with self.assertRaises(RuntimeError): check(True)
            work['phase'] = 'QUIESCENT'
            target['scopeSha256'] = '0'*64
            with self.assertRaises(RuntimeError): check(True)
            target['scopeSha256'] = grant['sha256']
            child.stdin.close(); child.wait()
            with self.assertRaises((RuntimeError, FileNotFoundError)): check(True)
        finally:
            if not child.stdin.closed: child.stdin.close()
            child.stdin = None
            child.communicate()

    def test_same_file_identity_and_bytes_are_read_without_modification(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'private.json'
            file.write_bytes(b'{"component":true}')
            file.chmod(0o400)
            before = observer.identity(file.stat())
            raw, held = observer.private(file)
            self.assertEqual(raw, file.read_bytes())
            self.assertEqual(observer.identity(held), before)
            self.assertEqual(observer.identity(file.stat()), before)

    def test_hardlinks_symlinks_modes_and_read_bounds_are_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'private.json'
            file.write_bytes(b'private')
            file.chmod(0o400)
            link = Path(directory) / 'alias'
            os.link(file, link)
            with self.assertRaises(RuntimeError):
                observer.private(file)
            link.unlink()
            link.symlink_to(file)
            with self.assertRaises(RuntimeError):
                observer.private(link)
            with self.assertRaises(RuntimeError):
                observer.private(file, maximum=2)
            file.chmod(0o600)
            with self.assertRaises(RuntimeError):
                observer.private(file)

    def test_same_original_popen_closes_both_pipes_naturally(self):
        readers = observer.OriginalReaders()
        try:
            raw = readers.run([sys.executable, '-I', '-B', '-c', 'import sys; print(sys.stdin.read()); print("err",file=sys.stderr)'], input_bytes=b'component')
            self.assertEqual(raw, b'component\n')
            child = readers.children[0]
            self.assertEqual(child.returncode, 0)
            self.assertTrue(child.stdout.closed and child.stderr.closed)
        finally:
            readers.close()

    def test_failed_input_retains_the_same_original_until_actual_reap(self):
        actual_popen, actual_write = subprocess.Popen, os.write
        original_children = []
        first = True

        def tracked_popen(*args, **kwargs):
            child = actual_popen(*args, **kwargs)
            original_children.append(child)
            return child

        def interrupted_once(*args, **kwargs):
            nonlocal first
            if first:
                first = False
                raise KeyboardInterrupt()
            return actual_write(*args, **kwargs)

        readers = observer.OriginalReaders()
        observer.subprocess.Popen, observer.os.write = tracked_popen, interrupted_once
        try:
            with self.assertRaises(RuntimeError):
                readers.run([sys.executable, '-I', '-B', '-c', 'import sys; sys.stdin.read(); print("closed")'], input_bytes=b'component')
            self.assertIs(readers.children[0], original_children[0])
            closure = readers.close()
            self.assertTrue(closure['failed'])
            self.assertEqual(original_children[0].returncode, 0)
            self.assertTrue(original_children[0].stdout.closed and original_children[0].stderr.closed)
        finally:
            observer.subprocess.Popen, observer.os.write = actual_popen, actual_write
            readers.close()

    def test_post_popen_setup_failure_cannot_hide_the_same_original_from_closure(self):
        class RefusingList(list):
            def append(self, _):
                raise MemoryError('injected-post-popen-setup')

        readers = observer.OriginalReaders()
        readers.children = RefusingList()
        try:
            with self.assertRaises(RuntimeError):
                readers.run([sys.executable, '-I', '-B', '-c', 'import sys; sys.stdin.read(); print("closed")'], input_bytes=b'component')
            self.assertEqual(len(readers.owners), 1)
            original = readers.owners[0]['child']
            self.assertIsInstance(original, subprocess.Popen)
            closure = readers.close()
            self.assertTrue(closure['failed'])
            self.assertEqual(closure['originals'][0]['pid'], original.pid)
            self.assertEqual(closure['originals'][0]['returncode'], 0)
            self.assertTrue(closure['originals'][0]['stdoutEof'] and closure['originals'][0]['stderrEof'])
        finally:
            readers.close()

    def test_output_overflow_stays_negative_but_both_actual_pipes_are_drained(self):
        readers = observer.OriginalReaders()
        try:
            with self.assertRaises(RuntimeError):
                readers.run([sys.executable, '-I', '-B', '-c', 'import os; os.write(1,b"x"*196608); os.write(2,b"y"*196608)'], maximum=1024)
            owner = readers.owners[0]
            self.assertLessEqual(sum(map(len, owner['out'])), 1024)
            self.assertLessEqual(sum(map(len, owner['err'])), 65536)
            closure = readers.close()
            self.assertTrue(closure['failed'])
            self.assertEqual(closure['originals'][0]['returncode'], 0)
            self.assertTrue(closure['originals'][0]['stdoutEof'] and closure['originals'][0]['stderrEof'])
        finally:
            readers.close()

    def test_actual_posix_signals_stay_negative_without_forwarding_or_orphaning(self):
        for sig in [signal.SIGINT, signal.SIGTERM]:
            with self.subTest(signal=sig):
                readers = observer.OriginalReaders()
                try:
                    with self.assertRaises(RuntimeError):
                        readers.run([sys.executable, '-I', '-B', '-c', 'import os,sys; os.kill(os.getppid(),' + str(int(sig)) + '); print("natural-zero"); print("err",file=sys.stderr)'])
                    closure = readers.close()
                    self.assertTrue(closure['failed'] and closure['cancelled'])
                    self.assertEqual(closure['originals'][0]['returncode'], 0)
                    self.assertTrue(closure['originals'][0]['stdoutEof'] and closure['originals'][0]['stderrEof'])
                finally:
                    readers.close()

    def test_oversized_request_is_refused_before_any_reader_is_spawned(self):
        original = sys.stdin
        try:
            sys.stdin = io.TextIOWrapper(io.BytesIO(b'x' * 4097))
            with self.assertRaises(RuntimeError):
                observer.main()
        finally:
            sys.stdin = original

    def test_changed_helper_path_never_changes_the_verified_executed_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            helper = root / 'private-qualification-observer.py'
            facts = dict(format='sabalan-original-private-qualification-observation/v1', originalSqlProbe=dict(returncode=0, reaped=True), baselineCompletion={'component': 'verified-snapshot'})
            raw = ('print(' + repr(json.dumps(facts)) + ')').encode()
            for file, value in [(helper, raw), (root / 'index.json', json.dumps(dict(sourceDatabaseRole='VERIFIED_COMPLETE_RESTORED_QA', restoredQaLineage={})).encode()), (root / 'config.json', json.dumps(dict(sourcePins={helper.name: observer.sha(raw)})).encode())]:
                file.write_bytes(value)
                file.chmod(0o400)
            readers = observer.OriginalReaders()
            actual_run = readers.run

            def changed_path(*args, **kwargs):
                helper.chmod(0o600)
                helper.write_bytes(b'raise RuntimeError("unverified-code-executed")')
                helper.chmod(0o400)
                return actual_run(*args, **kwargs)

            readers.run = changed_path
            try:
                with self.assertRaises(RuntimeError):
                    observer.material(root, observer.sha(raw), readers)
                # The negative came from post-execution metadata conservation;
                # the actual child executed the original verified RAM bytes.
                self.assertEqual(readers.children[0].returncode, 0)
                self.assertEqual(json.loads(b''.join(readers.owners[0]['out']))['baselineCompletion'], {'component': 'verified-snapshot'})
            finally:
                readers.close()

    def test_operation_root_cannot_be_selected_by_paths_or_old_report_objects(self):
        for value in [None, {}, '../other', 'A' * 32, 'a' * 31, '/app/runtime-authority/x']:
            with self.assertRaises(RuntimeError):
                observer.root_for(value)


if __name__ == '__main__':
    unittest.main()
