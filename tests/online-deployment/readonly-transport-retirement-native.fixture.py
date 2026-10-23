"""Diagnostic fixture glue; never imports a previously running owner.

The original top-level controller must use spawn_backend at the FIRST Popen
creation, observe_active while alive, and retain this same object through the
edge-stage -> coherent capture/restore -> normal backend closure -> certificate
sequence. There is no after-the-fact registration or continuation constructor.
"""
import hashlib
import fcntl
import subprocess
from urllib.parse import urlsplit,unquote
import importlib.util
import json
import os
import re
import stat
from pathlib import Path
import time


def require(value):
    if not value:
        raise RuntimeError('READONLY_TRANSPORT_FIXTURE_ORIGINAL_LIFECYCLE_UNPROVEN')


class OriginalReadonlyTransportFixture:
    def __init__(self, root):
        self.root = Path(root)
        require(self.root.resolve(strict=True) == self.root)
        spec = importlib.util.spec_from_file_location('original_readonly_transport_issuer', self.root / 'readonly-transport-retirement.py')
        self.api = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.api)
        self.owner = self.api.OriginalReadonlyTransportController(self.root)
        self.edge = None
        self.stage = None
        self.stage_raw = None
        self.alive_negative = False
        self.business_ready = None
        self.business_ready_raw = None
        self.channel_negatives = []
        self.sql_negative = None

    def spawn_backend(self, *args, **kwargs):
        return self.owner.spawn_backend(*args, **kwargs)

    def observe_active(self, original_child):
        return self.owner.observe_active(original_child)

    def spawn_edge(self, command, *, env, stdout, stderr, instance_id, publication_lock_file, remote_browser=None):
        directory = self.root / 'readonly-transport-retirement'
        directory.mkdir(mode=0o700)
        self.edge = self.owner.spawn_edge(command, env=env, stdout=stdout, stderr=stderr, instance_id=instance_id,
            publication_lock_file=publication_lock_file, publication_descriptor=20, retirement_directory=directory,
            remote_browser=remote_browser)
        return self.edge

    def _original_private_publication_pending(self, filename):
        """Retry only our original edge's exact transient second hard link."""
        require(filename in {'browser-business-ready.json', 'readonly-transport-stopped.json'})
        file = self.root / filename
        try:
            before = file.lstat()
        except FileNotFoundError:
            # Do not enter strict read after observing absence: publication may
            # link the final inode before that read, while its temp link remains.
            return True
        if before.st_nlink != 2:
            return False
        prefix = file.name + '.publishing-' + str(self.edge.pid) + '-'
        candidates = [item for item in self.root.iterdir()
                      if item.name.startswith(prefix) and re.fullmatch(r'[a-f0-9]{32}', item.name[len(prefix):])]
        if len(candidates) != 1:
            return False
        try:
            temporary = candidates[0].lstat()
            after = file.lstat()
        except FileNotFoundError:
            return False
        identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns,
                                  value.st_ctime_ns, value.st_mode, value.st_uid, value.st_nlink)
        return (identity(before) == identity(temporary) == identity(after)
                and stat.S_ISREG(after.st_mode) and after.st_uid == os.getuid()
                and after.st_mode & 0o777 == 0o600 and 0 < after.st_size <= 8*1024*1024)

    def observe_business_ready_for_negative_abort(self, seconds=5):
        """Read only this owner's completed stage; never claim capture success."""
        require(self.edge is not None and self.edge.poll() is None)
        if self.business_ready_raw is None:
            self.wait_business_ready(seconds=seconds)
        return self.business_ready_raw

    def wait_business_ready(self, seconds=180):
        require(self.edge is not None and self.business_ready is None)
        deadline = time.monotonic() + seconds
        while True:
            require(self.edge.poll() is None and time.monotonic() < deadline)
            if self._original_private_publication_pending('browser-business-ready.json'):
                time.sleep(0.02)
                continue
            try:
                value, raw = self.api.read(self.root / 'browser-business-ready.json', maximum=8*1024*1024)
                break
            except FileNotFoundError:
                time.sleep(0.02)
        require(set(value) == {'format', 'operation', 'originalEdgePid', 'enrollmentId', 'businessStage', 'productionAdmission'}
                and value['format'] == 'sabalan-original-browser-business-stage/v1'
                and value['operation'] == self.root.name and value['originalEdgePid'] == self.edge.pid
                and value['enrollmentId'] == self.owner._enrollment['enrollmentId']
                and value['productionAdmission'] is False)
        self.business_ready, self.business_ready_raw = value, raw
        return value['businessStage']

    def qualify_forged_channel_inputs(self):
        require(self.business_ready is not None and self.edge.poll() is None and not self.channel_negatives)
        for mode in ['regular-file', 'write-only-pipe', 'substituted-source']:
            owned = []
            try:
                if mode == 'regular-file':
                    file = self.root / 'readonly-channel-negative-input'
                    file.write_bytes(b'not a native inherited pipe\n')
                    os.chmod(file, 0o400)
                    raw = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
                    descriptor = fcntl.fcntl(raw, fcntl.F_DUPFD_CLOEXEC, 30); os.close(raw)
                    owned.append(descriptor)
                else:
                    reader, writer = os.pipe2(os.O_CLOEXEC)
                    retained_reader = fcntl.fcntl(reader, fcntl.F_DUPFD_CLOEXEC, 30)
                    retained_writer = fcntl.fcntl(writer, fcntl.F_DUPFD_CLOEXEC, 30)
                    os.close(reader); os.close(writer)
                    owned.extend([retained_reader, retained_writer])
                    descriptor = retained_writer if mode == 'write-only-pipe' else retained_reader
                    if mode == 'substituted-source':
                        value = json.loads(self.api.encode(self.owner._enrollment))
                        pipe = os.fstat(retained_reader)
                        value['pipe'] = dict(device=str(pipe.st_dev), inode=str(pipe.st_ino),
                                             readerDescriptor=retained_reader, writerDescriptor=retained_writer)
                        value['sources']['application-worker.cjs'] = '0' * 64
                        raw = self.api.encode(value); require(len(raw) <= 4096)
                        require(os.write(retained_writer, raw) == len(raw))
                environment = dict(os.environ, SABALAN_READONLY_RETIREMENT_FD=str(descriptor))
                original = subprocess.Popen(['node', str(self.root / 'readonly-channel-negative.mjs'), mode],
                    env=environment, stdin=subprocess.DEVNULL, pass_fds=(descriptor, 20), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                original_birth = self.api.birth(original.pid)
                if mode == 'substituted-source':
                    os.close(retained_reader); owned.remove(retained_reader)
                out, err = original.communicate(timeout=10)
                require(original.returncode == 0 and len(out) <= 16384 and len(err) <= 16384)
                observed = json.loads(out)
                require(observed == dict(format='sabalan-original-channel-negative/v1', mode=mode,
                                         rejected=True, productionAdmission=False))
                self.channel_negatives.append(dict(mode=mode, originalPopenPid=original.pid, originalBirth=original_birth,
                                                   status=0, refused=True))
            finally:
                for descriptor in reversed(owned):
                    os.close(descriptor)

    def qualify_closed_namespace_sql_refusal(self):
        require(self.alive_negative and self.edge.poll() is None and self.sql_negative is None)
        owner = self.owner._owners[0]
        require(all(item['child'].poll() == 0 for item in self.owner._owners))
        source = urlsplit(owner['environment']['DATABASE_URL'])
        environment = {key:value for key,value in owner['environment'].items() if not key.startswith('PG')}
        environment.update(PGHOST=source.hostname, PGPORT=str(source.port or 5432), PGUSER=unquote(source.username),
            PGPASSWORD=unquote(source.password), PGDATABASE='postgres', PGAPPNAME=owner['active']['namespace'],
            PGCONNECT_TIMEOUT='5', PGOPTIONS='-c statement_timeout=5000 -c default_transaction_read_only=on -c search_path=pg_catalog')
        original = subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-c','SELECT pg_sleep(3)'],
            env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            original_birth = self.api.birth(original.pid)
            observer = dict(environment, PGAPPNAME='readonly-retirement-negative-observer')
            deadline = time.monotonic() + 2
            while True:
                require(original.poll() is None and time.monotonic() < deadline)
                result = subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-c',
                    "SELECT count(*) FROM pg_stat_activity WHERE application_name='" + owner['active']['namespace'] + "' AND datname='postgres'"],
                    env=observer, stdin=subprocess.DEVNULL, capture_output=True)
                require(result.returncode == 0)
                if result.stdout.strip() == b'1':
                    break
                time.sleep(0.01)
            try:
                self.owner.reconcile(self.stage['pendingEvidence'], self.stage['socketInstanceId'])
            except RuntimeError as error:
                require(str(error) == 'READONLY_TRANSPORT_ORIGINAL_OWNER_UNPROVEN' and not self.owner._issued)
            else:
                raise RuntimeError('READONLY_TRANSPORT_BUSY_RETIRED_NAMESPACE_WAS_RECONCILED')
        finally:
            out, err = original.communicate(timeout=10)
        require(original.returncode == 0 and len(out) <= 16384 and len(err) <= 16384)
        self.sql_negative = dict(originalPopenPid=original.pid, originalBirth=original_birth, status=0,
            actualNamespace=owner['active']['namespace'], database='postgres', readOnly=True, completedNaturally=True,
            freshCrossDatabaseNamespaceSessionRefused=True)

    def signal_capture_finished(self):
        require(self.edge is not None and self.edge.poll() is None and self.business_ready is not None)
        require(self.api.read(self.root / 'browser-business-ready.json', maximum=8*1024*1024)[1] == self.business_ready_raw)
        raw = self.api.encode(dict(format='sabalan-original-browser-capture-finished/v1', operation=self.root.name,
            enrollmentId=self.owner._enrollment['enrollmentId'], readySha256=hashlib.sha256(self.business_ready_raw).hexdigest()))
        fd = os.open(self.root / 'browser-finish.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
        try:
            offset = 0
            while offset < len(raw):
                count = os.write(fd, raw[offset:])
                require(count > 0)
                offset += count
            os.fsync(fd)
        finally:
            os.close(fd)

        directory = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)

    def signal_capture_aborted(self, proof):
        require(self.business_ready_raw is not None and self.edge is not None and self.edge.poll() is None)
        require(self.api.read(self.root / 'browser-business-ready.json', maximum=8*1024*1024)[1] == self.business_ready_raw)
        self.owner.abort_capture(proof, self.business_ready_raw)

    def wait_stopped_stage(self, seconds=180):
        require(self.edge is not None and self.stage is None)
        deadline = time.monotonic() + seconds
        while True:
            require(self.edge.poll() is None and time.monotonic() < deadline)
            if self._original_private_publication_pending('readonly-transport-stopped.json'):
                time.sleep(0.02)
                continue
            try:
                value, raw = self.api.read(self.root / 'readonly-transport-stopped.json', maximum=8*1024*1024)
                break
            except FileNotFoundError:
                time.sleep(0.02)
        require(set(value) == {'format', 'productionAdmission', 'socketInstanceId', 'journalInstanceId', 'pendingEvidence',
                              'businessStage', 'uiMutationPending', 'apiMutationPending', 'originalOperationOutcome', 'buildOrImageGcEligible',
                              'substitutedStoppedIntentRefused'}
                and value['format'] == 'sabalan-original-edge-readonly-retirement-stage/v1'
                and value['productionAdmission'] is False and value['buildOrImageGcEligible'] is False
                and value['uiMutationPending'] == value['apiMutationPending'] == 0
                and value['originalOperationOutcome'] == 'UNKNOWN' and value['substitutedStoppedIntentRefused'] is True
                and value['journalInstanceId'] == self.owner._enrollment['instanceId'])
        self.stage, self.stage_raw = value, raw
        # A REAL original backend is still alive and its actual ACTIVE/FD9 proof
        # revalidates. Failure here may not be hidden by an earlier malformed input.
        require(all(item['child'].poll() is None for item in self.owner._owners))
        for item in self.owner._owners:
            self.owner.observe_active(item['child'])
        try:
            self.owner.reconcile(value['pendingEvidence'], value['socketInstanceId'])
        except RuntimeError as error:
            require(str(error) == 'READONLY_TRANSPORT_ORIGINAL_OWNER_UNPROVEN' and not self.owner._issued)
            self.alive_negative = True
        else:
            raise RuntimeError('READONLY_TRANSPORT_ALIVE_BACKEND_WAS_RECONCILED')
        require(not (self.root / 'readonly-transport-retirement/READONLY_TRANSPORT_RECONCILED.json').exists())
        return value['businessStage']

    def reconcile_after_original_backend_closure(self):
        require(self.alive_negative and self.stage is not None and self.edge.poll() is None)
        require(self.api.read(self.root / 'readonly-transport-stopped.json', maximum=8*1024*1024)[1] == self.stage_raw)
        require(len(self.channel_negatives) == 3)
        self.qualify_closed_namespace_sql_refusal()
        certificate = self.owner.reconcile(self.stage['pendingEvidence'], self.stage['socketInstanceId'])
        # Only this ORIGINAL edge can consume its inherited reader capability.
        # Deadline failure retains UNKNOWN and never authorizes replacement.
        self.edge.wait(timeout=30)
        require(self.edge.returncode == 0)
        observed, raw = self.api.read(self.root / 'readonly-transport-retirement/READONLY_TRANSPORT_RECONCILED.json', maximum=8*1024*1024)
        require(observed == certificate and raw == self.api.encode(certificate))
        require(self.api.read(self.root / 'readonly-transport-stopped.json', maximum=8*1024*1024)[1] == self.stage_raw)
        return dict(format='sabalan-readonly-transport-fixture/v1', passResult=True, productionAdmission=False,
            aliveOriginalBackendRefused=True, originalEdgePopenStatus=0, channelNegatives=self.channel_negatives,
            actualSqlNamespaceNegative=self.sql_negative, substitutedStoppedIntentRefused=True,
            certificateSha256=hashlib.sha256(raw).hexdigest(), stageSha256=hashlib.sha256(self.stage_raw).hexdigest(),
            readonlyPendingRetained=len(certificate['pendingEvidence']), originalOperationOutcome='UNKNOWN',
            mutationReconciled=False, buildOrImageGcEligible=False)
