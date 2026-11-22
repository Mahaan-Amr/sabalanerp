#!/usr/bin/env python3
"""Same-launcher WAL ownership across one real release cycle.

This module is imported by the original launcher. It never adopts a prior
receiver, invents a remote readback, or turns a live prefix into terminal proof.
The launcher supplies its fixed original Node/SSH ports, not an admin runner.
"""
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import threading
import time

LIVE_PHASES = ('ONLINE_CHECKPOINTING', 'ONLINE_EXPANDING', 'ONLINE_ACCEPTING',
               'ONLINE_READY', 'ONLINE_PUBLISHING', 'ONLINE_SERVING', 'ONLINE_ROLLBACK_PUBLISHING')
DOMAIN = b'sabalan-original-wal-window-verification/v1\n'


def require(value, code):
    if not value:
        raise RuntimeError('CONTINUOUS_WAL_' + code)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def lsn(value):
    require(isinstance(value, str) and re.fullmatch(r'(0|[1-9A-F][0-9A-F]{0,7})/(0|[1-9A-F][0-9A-F]{0,7})', value), 'LSN_INVALID')
    high, low = value.split('/')
    return int(high, 16) * 2**32 + int(low, 16)


def date(value):
    require(isinstance(value, str), 'CERTIFICATE_TIME_INVALID')
    result = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(result.tzinfo is not None, 'CERTIFICATE_TIME_INVALID')
    return result.timestamp()


def validate_window_certificate(request, envelope, now=None):
    """Structural binding only; the owner separately verifies actual Ed25519."""
    now = time.time() if now is None else now
    require(envelope.get('format') == 'sabalan-signed-original-wal-window-verification/v1', 'CERTIFICATE_FORMAT')
    decision = envelope['decision']
    require(set(decision) == {'format', 'requestSha256', 'challenge', 'independentTokenSha256',
                             'windowSha256', 'sourceIdentity', 'objects', 'issuedAt', 'expiresAt'}, 'CERTIFICATE_FIELDS')
    require(decision['format'] == 'sabalan-original-wal-window-verification/v1'
            and decision['requestSha256'] == sha(canonical(request))
            and decision['challenge'] == request['challenge']
            and decision['windowSha256'] == request['windowSha256']
            and decision['sourceIdentity'] == request['sourceIdentity']
            and decision['objects'] == request['objects']
            and re.fullmatch(r'[a-f0-9]{64}', decision['independentTokenSha256']), 'CERTIFICATE_BINDING')
    issued, expires = date(decision['issuedAt']), date(decision['expiresAt'])
    require(issued <= now + 30 and issued <= now < expires and 0 < expires - issued <= 600, 'CERTIFICATE_EXPIRED')
    signature = base64.b64decode(envelope['signature'], validate=True)
    require(len(signature) == 64, 'CERTIFICATE_SIGNATURE_INVALID')
    return DOMAIN + canonical(decision), signature


def assert_window_chain(windows, source, through=None):
    require(bool(windows), 'WINDOW_CHAIN_EMPTY')
    end = None
    size = source['segmentBytes']
    for value in windows:
        require(all(value['source'][key] == source[key] for key in
                    ('databaseName', 'databaseOid', 'systemIdentifier', 'timeline', 'segmentBytes')), 'SOURCE_CHANGED')
        start, finish = lsn(value['startLsn']), lsn(value['endLsn'])
        require(start < finish and finish % size == 0, 'WINDOW_RANGE_INVALID')
        if end is not None:
            require(start // size * size <= end and finish > end, 'WINDOW_CHAIN_GAP')
        end = finish
    if through is not None:
        require(end >= lsn(through), 'WINDOW_CHAIN_SHORT')
    return end


class OriginalOnlineWalCoverage:
    def __init__(self, producer, ports, helper_module):
        require(os.name == 'posix' and os.getuid() == 0, 'ORIGINAL_LINUX_ROOT_REQUIRED')
        require(type(producer) is helper_module.Producer, 'ORIGINAL_PRODUCER_REQUIRED')
        helper_module.assert_host_lock(producer.config)
        require(not producer.role_created and producer.receiver is None, 'FRESH_PRODUCER_REQUIRED')
        self.p, self.ports, self.h = producer, ports, helper_module
        self.lock = threading.RLock()
        self.windows, self.closed = [], []
        self.error = None
        self.terminal = False
        self.stop = threading.Event()
        self.point = None
        self.scope = producer.config['capture']['runtimeId']
        self.initial = tuple(producer.config['expectedContainerIds'])
        self.root = producer.root / 'continuous-wal'
        self.root.mkdir(mode=0o700)
        self.sequence = 0
        self.owner = dict(pid=os.getpid(), startTicks=Path('/proc/self/stat').read_text().split(') ', 1)[1].split()[19],
                          bootId=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                          pidNamespace=os.readlink('/proc/self/ns/pid'))
        self.state_file = Path(producer.config['capture']['boundaryDirectoryHost']) / 'continuous-wal-state.json'
        self.state_raw = None
        self._state('OPENING')
        self._original_sql = producer.sql
        # This exact implementation installs a fixed phase-aware SQL boundary.
        # No callback SQL/runner or status document grants ownership.
        producer.sql = self._sql
        self._context()
        prepared = producer.prepare_original_source()
        self.password, self.source = prepared['password'], prepared['source']
        self._launch(first=True)
        self._state('ACTIVE')
        self.thread = threading.Thread(target=self._loop, name='original-online-wal-owner', daemon=False)
        self.thread.start()

    def _state(self, phase, terminal=None):
        self.p.ownership()
        parent = self.state_file.parent
        observed = parent.lstat()
        require(parent.resolve(strict=True) == parent and stat.S_ISDIR(observed.st_mode)
                and observed.st_uid == 0 and not observed.st_mode & 0o022, 'REGISTRY_ROOT_INVALID')
        if self.state_raw is None:
            require(not os.path.lexists(self.state_file), 'PRIOR_REGISTRY_REQUIRES_RECOVERY')
        else:
            require(self.h.private_bytes(self.state_file, 4*1024*1024, immutable=True) == self.state_raw, 'REGISTRY_CHANGED')
        value = dict(format='sabalan-original-continuous-wal-state/v1', phase=phase,
                     captureId=self.p.config['captureId'], originalOwner=self.owner,
                     deploymentId=self.p.config['lease']['deploymentId'], releaseId=self.p.config['lease']['releaseId'],
                     sourceDatabase=self.p.config['database'], workspace=str(self.p.root),
                     windowsCreated=len(self.windows), closedWindows=len(self.closed),
                     latestNamespace=self.windows[-1]['namespace'] if self.windows else None,
                     finalIntervalCompletion=phase == 'COMPLETE', terminal=terminal)
        raw = self.h.encoded(value)
        if self.state_raw is None:
            self.h.publish(self.state_file, raw)
        else:
            temporary = parent / ('continuous-wal-state-' + secrets.token_hex(16) + '.tmp')
            self.h.publish(temporary, raw)
            require(self.h.private_bytes(self.state_file, 4*1024*1024, immutable=True) == self.state_raw, 'REGISTRY_CHANGED')
            os.replace(temporary, self.state_file)
            fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try: os.fsync(fd)
            finally: os.close(fd)
        self.state_raw = raw

    def _context(self):
        context = self.ports.read_original_continuous_context(self.scope)
        require(context['format'] == 'sabalan-original-continuous-checkpoint-context/v1'
                and context['runtimeId'] == self.scope and context['phase'] in LIVE_PHASES, 'CONTEXT_INVALID')
        expected = self.p.config['lease']
        require(all(context['lease'][key] == expected[key] for key in ('deploymentId', 'releaseId', 'leaseToken', 'advisory')), 'LEASE_CHANGED')
        ids = context['expectedContainerIds']
        require(isinstance(ids, list) and len(ids) == len(set(ids)) and set(self.initial).issubset(ids)
                and all(re.fullmatch(r'[a-f0-9]{64}', value) for value in ids), 'CENSUS_INVALID')
        backend = self.p.config['backend']
        require(all(context['sourceBackend'][key] == backend[key] for key in ('containerId', 'image', 'startedAt')), 'SOURCE_BACKEND_CHANGED')
        self.p.config['expectedContainerIds'] = list(ids)
        return context

    def _sql(self, query):
        context = self._context()
        # Preserve the canonical lease/advisory expression; substitute only the
        # original controller-observed phase from the fixed set above.
        assertion = self.h.lease_assertion(self.p.config['lease'])
        require(assertion.count("phase='ONLINE_CHECKPOINTING'") == 1, 'LEASE_BOUNDARY_CHANGED')
        assertion = assertion.replace("phase='ONLINE_CHECKPOINTING'", "phase='" + context['phase'] + "'")
        pg = self.p.config['postgres']
        require(re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,62}', pg['user']), 'SQL_USER_INVALID')
        child = self.p.docker(['exec', '-i', pg['containerId'], 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                               '-U', pg['user'], '-d', self.p.config['database']['name']], interactive=True)
        return self.p.complete(child, ("SET statement_timeout='10s';SET lock_timeout='500ms';\n" + assertion + query + '\n').encode()).decode().strip()

    def _launch(self, first=False):
        current = self.p.profile()
        require(all(current[key] == self.source[key] for key in
                    ('databaseName', 'databaseOid', 'systemIdentifier', 'timeline', 'segmentBytes')), 'SOURCE_CHANGED')
        coverage = self.h.load_coverage(self.p.config['helpers']['coverage']['file'])
        planned = coverage.plan_receiver(current)
        # pg_receivewal starts at the beginning of the current full segment.
        # Declare exactly those bytes, preserving raw currentLsn in ACTIVE.source.
        planned['startLsn'] = coverage.text_lsn(lsn(planned['startLsn']) // current['segmentBytes'] * current['segmentBytes'])
        if self.windows:
            previous = self.windows[-1]
            require(lsn(planned['startLsn']) // self.source['segmentBytes'] * self.source['segmentBytes'] <= lsn(previous['range']['endLsn'])
                    and lsn(planned['endLsn']) > lsn(previous['range']['endLsn']), 'SUCCESSOR_HORIZON_INVALID')
        number = len(self.windows) + 1
        directory = self.p.root / 'receiver' if first else self.root / f'window-{number:06d}'
        directory.mkdir(mode=0o700)
        namespace = self.p.namespace if first else 'sabalan-wal-' + secrets.token_hex(16)
        config = dict(planned, root=self.p.runtime(directory), namespace=namespace, replicationUser=self.p.replication_user,
                      **{key:self.source[key] for key in ('databaseName', 'databaseOid', 'systemIdentifier')})
        self.h.publish(directory / 'configuration.json', config)
        self.h.publish(directory / 'replication-password', self.password.encode())
        self.h.publish(directory / 'receive-postgres-wal.py', self.h.private_bytes(self.p.config['helpers']['receiver']['file'], 16*1024*1024, True))
        fd = os.open(directory / 'receiver.lock', os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
        try: os.fsync(fd)
        finally: os.close(fd)
        launcher = ("import fcntl,os,sys;from pathlib import Path;root=Path(sys.argv[1]);"
                    "fd=os.open(root/'receiver.lock',os.O_RDWR|os.O_NOFOLLOW);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);"
                    "os.dup2(fd,9,inheritable=True);os.execv(sys.executable,[sys.executable,'-I','-B',str(root/'receive-postgres-wal.py'),str(root/'configuration.json')])")
        child = self.p.docker(['exec', '-e', 'DATABASE_URL', self.p.config['backend']['containerId'], '/usr/bin/python3', '-I', '-B',
                              '-c', launcher, self.p.runtime(directory)], environment=dict(os.environ, DATABASE_URL=self.p.config['databaseUrl']))
        row = dict(directory=directory, namespace=namespace, range=planned, process=child, launched=time.monotonic())
        self.windows.append(row)
        sender = self.p.wait_for(lambda:self._sender(row), child, 30, 'ORIGINAL_SUCCESSOR_NOT_STREAMING')
        raw = self.h.private_bytes(directory / 'capture-state.json')
        active = json.loads(raw)
        require(active['phase'] == 'ACTIVE' and active['namespace'] == namespace
                and active['configurationSha256'] == sha(self.h.private_bytes(directory / 'configuration.json', immutable=True)), 'ORIGINAL_ACTIVE_INVALID')
        row.update(active=raw, sender=sender)
        if first:
            self.p.receiver, self.p.range = child, planned
        if not first: self._state('ACTIVE')
        return row

    def _sender(self, row):
        value = self.p.query("SELECT COALESCE(json_agg(json_build_object('pid',pid,'backendStart',backend_start::text,"
            "'state',state,'flushLsn',flush_lsn::text)), '[]'::json) FROM pg_stat_replication WHERE application_name='" + row['namespace'] +
            "' AND usename='" + self.p.replication_user + "' AND host(client_addr)='" + self.p.config['backend']['privateAddress'] + "'")
        if not value: return None
        require(len(value) == 1 and value[0]['state'] == 'streaming' and row['process'].process.poll() is None, 'SENDER_INVALID')
        if value[0]['flushLsn'] is None: return None
        return value[0]

    def _switch_to(self, end):
        for _ in range(8):
            if lsn(self.p.profile()['currentLsn']) >= end: return
            self.p.sql('SELECT pg_switch_wal()')
        require(lsn(self.p.profile()['currentLsn']) >= end, 'HORIZON_NOT_REACHED')

    def _close(self, row):
        self.p.children.finish(row['process'])
        raw = self.h.private_bytes(row['directory'] / 'capture-state.json')
        value = json.loads(raw)
        require(value['phase'] == 'COMPLETE' and value['nativeReaped'] is True and value['databaseQuiet'] is True
                and value['nativeStatus'] == 0 and value['namespace'] == row['namespace']
                and value['configurationSha256'] == sha(self.h.private_bytes(row['directory'] / 'configuration.json', immutable=True)), 'NATIVE_CLOSURE_INVALID')
        require(value['startLsn'] == row['range']['startLsn'] and value['endLsn'] == row['range']['endLsn'], 'NATIVE_RANGE_CHANGED')
        require(self.p.query("SELECT to_json(count(*)) FROM pg_stat_activity WHERE application_name='" + row['namespace'] + "'") == 0, 'NATIVE_SQL_ACTIVE')
        row.update(closure=value, closureRaw=raw)
        self._seal_and_verify(row)
        self.closed.append(row)
        assert_window_chain([item['closure'] for item in self.closed], self.source)
        self._state('ACTIVE')

    def _seal_and_verify(self, row):
        # The fixed original launcher owns the crypto executor. Production uses
        # the existing deployment-control service; local QA uses the canonical
        # host codec with private host keys. Serving app containers get no keys.
        response = self.ports.seal_original_wal_window(dict(
            root=self.p.runtime(row['directory']), captureSha256=sha(row['closureRaw']),
            configurationSha256=row['closure']['configurationSha256']))
        require(isinstance(response, bytes) and 0 < len(response) <= 262144, 'SEAL_ORIGINAL_RESULT_REQUIRED')
        summary = json.loads(response)
        raw = self.h.private_bytes(row['directory'] / 'sealed/seal-state.json')
        seal = json.loads(raw)
        require(summary == seal and seal['phase'] == 'SEALED' and seal['captureSha256'] == sha(row['closureRaw']), 'SEAL_INVALID')
        objects = []
        for item in seal['objects']:
            file = row['directory'] / 'sealed' / item['name']
            require(file.parent == row['directory'] / 'sealed' and re.fullmatch(r'[A-Za-z0-9_.-]+', item['name']), 'CIPHER_NAME_INVALID')
            require(file.resolve(strict=True) == file, 'CIPHER_ALIAS')
            fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                before = os.fstat(fd); digest = hashlib.sha256(); count = 0
                require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and before.st_nlink == 1
                        and not before.st_mode & 0o077 and before.st_size == item['encryptedBytes'], 'CIPHER_PRIVATE_FILE_REQUIRED')
                while chunk := os.read(fd, 262144):
                    count += len(chunk); digest.update(chunk)
                    require(count <= item['encryptedBytes'], 'CIPHER_CHANGED')
                identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns,
                                           value.st_ctime_ns, value.st_mode, value.st_uid, value.st_nlink)
                require(before.st_size == count == item['encryptedBytes'] and digest.hexdigest() == item['encryptedSha256']
                        and identity(before) == identity(os.fstat(fd)) == identity(file.lstat()), 'CIPHER_CHANGED')
            finally: os.close(fd)
            objects.append(dict(name=item['name'], bytes=count, sha256=digest.hexdigest()))
        self.sequence += 1
        request = dict(format='sabalan-original-wal-window-verification-request/v1', sequence=self.sequence,
                       challenge=secrets.token_hex(32), deploymentId=self.p.config['lease']['deploymentId'],
                       releaseId=self.p.config['lease']['releaseId'], windowSha256=sha(raw),
                       sourceIdentity={key:self.source[key] for key in ('systemIdentifier', 'timeline')}, objects=objects)
        # The port transfers these exact original-held artifacts and consumes a
        # genuine independent readback token before the fixed-Q signer answers.
        response = self.ports.verify_original_wal_window(request, str(row['directory'] / 'sealed'))
        require(isinstance(response, bytes) and len(response) <= 262144, 'CERTIFICATE_BYTES_REQUIRED')
        message, signature = validate_window_certificate(request, json.loads(response))
        verify = row['directory'] / 'certificate-verification'; verify.mkdir(mode=0o700)
        self.h.publish(verify / 'message', message); self.h.publish(verify / 'signature', signature)
        public = self.ports.read_original_qualification_public_key_path()
        public_before = self.h.private_bytes(public, 65536, True)
        require(sha(public_before) == self.p.config['qualificationPublicKeySha256'], 'QUALIFICATION_KEY_CHANGED')
        process = self.p.command('verify-window-certificate', ['/usr/bin/openssl', 'pkeyutl', '-verify', '-pubin',
            '-inkey', public, '-rawin', '-in', str(verify / 'message'), '-sigfile', str(verify / 'signature')], inherited=(9,))
        self.p.complete(process)
        require(self.h.private_bytes(public, 65536, True) == public_before, 'QUALIFICATION_KEY_CHANGED')
        accepted_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
        validate_window_certificate(request, json.loads(response), date(accepted_at))
        self.h.publish(row['directory'] / 'window-request.json', request)
        self.h.publish(row['directory'] / 'window-certificate.json', response)
        self.h.publish(row['directory'] / 'certificate-acceptance.json', dict(acceptedAt=accepted_at,
            requestSha256=sha(canonical(request)), certificateSha256=sha(response), windowSha256=sha(raw)))
        row.update(request=request, certificate=response, sealRaw=raw, sealSha256=sha(raw), acceptedAt=accepted_at)

    def checkpoint(self):
        require(self.point is None and not self.error, 'POINT_ALREADY_ATTEMPTED')
        # Do not hold manager.lock across the real base/cut: the owner thread
        # must keep monitoring and rotating WAL during a slow capture.
        material = self.p.capture_original_point()
        with self.lock:
            self._check_error()
            first = self.windows[0]
            if len(self.windows) == 1:
                self._switch_to(lsn(first['range']['endLsn']) - 2*self.source['segmentBytes'])
                self._launch()
            if first not in self.closed:
                self._switch_to(lsn(first['range']['endLsn'])); self._close(first)
            self.point = self.p.close_original_point(first['closure'], first['active'], first['sender'])
            return dict(point=self.point, liveCoverage=self._live())

    def _check_error(self):
        require(not self.error and not self.terminal and not self.p.cancelled, 'OWNER_NOT_LIVE')
        self.p.ownership()

    def tick(self):
        with self.lock:
            self._check_error()
            current = self.p.profile(); newest = self.windows[-1]
            end = lsn(newest['range']['endLsn']); position = lsn(current['currentLsn'])
            require(position <= end, 'RECEIVER_HORIZON_OVERRUN')
            if time.monotonic() - newest['launched'] > 240:
                self._switch_to(end - 2*self.source['segmentBytes']); position = lsn(self.p.profile()['currentLsn'])
            if position >= end - 2*self.source['segmentBytes']:
                self._launch()
            for row in self.windows[:-1]:
                if row not in self.closed:
                    self._switch_to(lsn(row['range']['endLsn'])); self._close(row)
            require(self._sender(self.windows[-1]) is not None, 'SUCCESSOR_NOT_STREAMING')
            return self._live() if self.closed else None

    def _live(self):
        require(bool(self.closed), 'NO_VERIFIED_CLOSED_PREFIX')
        successor = self.windows[-1]; sender = self._sender(successor)
        require(successor not in self.closed and sender is not None, 'SUCCESSOR_NOT_LIVE')
        end = assert_window_chain([row['closure'] for row in self.closed], self.source)
        require(lsn(successor['range']['startLsn']) // self.source['segmentBytes'] * self.source['segmentBytes'] <= end, 'LIVE_PREFIX_GAP')
        def flushed():
            current = self._sender(successor)
            return current if current is not None and lsn(current['flushLsn']) >= end else None
        sender = self.p.wait_for(flushed, successor['process'], 15, 'LIVE_PREFIX_NOT_FLUSHED')
        return dict(format='sabalan-original-live-wal-coverage/v1', phase='LIVE_ORIGINAL_OWNER',
                    sourceDatabase=dict(name=self.source['databaseName'], oid=self.source['databaseOid'], systemIdentifier=self.source['systemIdentifier']),
                    timeline=self.source['timeline'], captureId=self.p.config['captureId'],
                    coveredFromLsn=self.closed[0]['range']['startLsn'], coveredThroughLsn=sender['flushLsn'],
                    observedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), originalOwner=self.owner,
                    closedWindows=[dict(startLsn=row['range']['startLsn'], endLsn=row['range']['endLsn'],
                        requestRawBase64=base64.b64encode(canonical(row['request'])).decode(),
                        certificateRawBase64=base64.b64encode(row['certificate']).decode(),
                        sealRawBase64=base64.b64encode(row['sealRaw']).decode(),
                        closureRawBase64=base64.b64encode(row['closureRaw']).decode(), acceptedAt=row['acceptedAt']) for row in self.closed],
                    successor=dict(originalPid=json.loads(successor['active'])['pid'],
                        originalDockerPid=successor['process'].process.pid, **successor['range'],
                        activeRawBase64=base64.b64encode(successor['active']).decode(), sender=sender),
                    finalIntervalCompletion=False)

    def _loop(self):
        while not self.stop.wait(2):
            try: self.tick()
            except BaseException as error:
                text = str(error)
                self.error = text if re.fullmatch(r'[A-Z][A-Z0-9_]{1,159}', text) else type(error).__name__
                try: self.h.publish(self.root / 'UNKNOWN.json', dict(phase='UNKNOWN', reason=self.error, originalOwner=self.owner))
                except BaseException: pass
                try: self._state('UNKNOWN')
                except BaseException: pass
                return  # Parent retains the same FD9, child handles and role.

    def finish_point_only_qualification(self):
        """Close original QA ownership without inventing a serving epoch."""
        require(self.p.config['project']=='sabalanerp-local', 'LOCAL_POINT_ONLY_REQUIRED')
        require(not self.terminal and not getattr(self,'point_only_closed',False), 'POINT_ONLY_ALREADY_CLOSED')
        self.stop.set(); self.thread.join()
        with self.lock:
            self._check_error(); context=self._context()
            require(context['phase']=='ONLINE_CHECKPOINTING' and context['publicationSha256'] is None,
                    'POINT_ONLY_CONTEXT_CHANGED')
            require(self.point is not None and self.p.native_closed, 'ORIGINAL_POINT_NOT_CLOSED')
            for row in self.windows:
                if row not in self.closed:
                    self._switch_to(lsn(row['range']['endLsn'])); self._close(row)
            require(all(row in self.closed for row in self.windows), 'POINT_ONLY_RECEIVERS_ACTIVE')
            self.p.cleanup_replication()
            require(self.p.children.closed(), 'POINT_ONLY_ORIGINAL_CHILDREN_UNRESOLVED')
            result=dict(format='sabalan-original-local-point-only-qualification-closed/v1',phase='ABORTED',
                captureId=self.p.config['captureId'],source=self.source,originalOwner=self.owner,
                windows=[dict(requestSha256=sha(canonical(row['request'])),windowSha256=row['sealSha256'],
                              certificateSha256=sha(row['certificate']))for row in self.closed],
                replicationAuthenticationRestored=True,allOriginalChildrenClosed=True,
                continuousWalQualified=False,finalIntervalCompletion=False,productionAdmission=False)
            self.h.publish(self.root/'point-only-qualification-closed.json',result)
            self._state('ABORTED',terminal=None)
            self.point_only_closed=True
            return result

    def finish(self, actual_terminal_phase):
        require(actual_terminal_phase in ('ONLINE_SERVING', 'ONLINE_ROLLBACK_PUBLISHING'), 'TERMINAL_PHASE_INVALID')
        self.stop.set(); self.thread.join()
        with self.lock:
            self._check_error(); context = self._context()
            terminal = self.ports.read_original_terminal_wal_context(self.scope)
            require(terminal['terminalReady'] is True and terminal['context'] == context
                    and re.fullmatch(r'[a-f0-9]{64}', terminal['terminalEpochSha256'])
                    and re.fullmatch(r'[a-zA-Z0-9_-]{8,128}', terminal['terminalReleaseId'])
                    and context['phase'] == actual_terminal_phase and context['publicationSha256'], 'TERMINAL_PUBLICATION_UNPROVEN')
            terminal_lsn = self.p.profile()['currentLsn']
            for row in self.windows:
                if row not in self.closed:
                    self._switch_to(lsn(row['range']['endLsn'])); self._close(row)
            assert_window_chain([row['closure'] for row in self.closed], self.source, terminal_lsn)
            # Canonical cleanup checks the original first receiver and the
            # shared role's complete SQL census, including every successor.
            self.p.cleanup_replication()
            require(self.p.children.closed(), 'ORIGINAL_CHILDREN_NOT_CLOSED')
            result = dict(format='sabalan-original-terminal-wal-coverage/v1', phase='COMPLETE',
                          source=self.source, captureId=self.p.config['captureId'], originalOwner=self.owner,
                          terminalPhase=actual_terminal_phase, publicationSha256=context['publicationSha256'],
                          terminalEpochSha256=terminal['terminalEpochSha256'], terminalReleaseId=terminal['terminalReleaseId'],
                          terminalLsn=terminal_lsn, coveredFromLsn=self.windows[0]['range']['startLsn'],
                          coveredThroughLsn=self.windows[-1]['range']['endLsn'],
                          windows=[dict(startLsn=row['range']['startLsn'], endLsn=row['range']['endLsn'],
                              windowSha256=row['sealSha256'], requestSha256=sha(canonical(row['request'])),
                              certificateSha256=sha(row['certificate'])) for row in self.closed],
                          ownedChildrenDomain='continuous-wal-producer', replicationAuthenticationRestored=True,
                          allOriginalChildrenClosed=True, finalIntervalCompletion=True)
            self.h.publish(self.root / 'terminal-coverage.json', result)
            self._state('COMPLETE', terminal=result)
            self.terminal = True
            return result


def startOriginalOnlineWalCoverage(producer, ports, helper_module):
    try:
        return OriginalOnlineWalCoverage(producer, ports, helper_module)
    except BaseException:
        # Preserve the original FD9, children, authentication mutations and
        # OPENING/ACTIVE record. A new launcher cannot adopt these outcomes.
        producer.held('CONTINUOUS_WAL_OWNER_START_UNKNOWN')
