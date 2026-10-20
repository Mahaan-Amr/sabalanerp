"""Private one-use diagnostic host channel. JSON/files alone grant no receipt.

The public key and session are fixed argv of each ORIGINAL Docker-exec launch;
the ephemeral signing key stays only in the original host coordinator's memory.
This is not a production admission or generic command execution interface.
"""
import base64
import fcntl
import json
import os
import re
import subprocess
import sys

if sys.flags.optimize != 0:
    raise RuntimeError('ORIGINAL_HOST_CHANNEL_OPTIMIZATION_FORBIDDEN')

PREFIX = 'SABALAN_ORIGINAL_CONTROL '
FORMAT = 'sabalan-original-host-controller/v1'
MAXIMUM = 8 * 1024 * 1024
MAXIMUM_FRAME = 12 * 1024 * 1024
COMMANDS = frozenset(['ENROLL', 'RUN_MIGRATION', 'START_CHROME', 'RUN_RESTORED_BASELINE',
    'RUN_PRISTINE_PERFORMANCE','PRISTINE_PERFORMANCE_DONE',
    'START_ONLINE_POINT_INQUIRY','ONLINE_POINT_INQUIRY_READY','FINISH_ONLINE_POINT_INQUIRY','ONLINE_POINT_INQUIRY_DONE',
    'SEAL_LOCAL_CHECKPOINT_COMPONENTS','LOCAL_CHECKPOINT_COMPONENTS_SEALED','SEAL_LOCAL_WAL_WINDOW','LOCAL_WAL_WINDOW_SEALED',
    'RUN_ORIGINAL_ONLINE_CHECKPOINT','ORIGINAL_ONLINE_CHECKPOINT_DONE',
    'ROTATE_PRIVATE_LEGACY_UI','PRIVATE_LEGACY_UI_ROTATED','RESTORE_PRIVATE_RETAINED_UI','PRIVATE_LEGACY_UI_RESTORED',
    'START_PRIVATE_LEGACY_CHROME','PRIVATE_LEGACY_CHROME_READY','WAIT_PRIVATE_LEGACY_CHROME_CLOSED','PRIVATE_LEGACY_CHROME_CLOSED','VERIFY_PRIVATE_LEGACY_BROWSER_TICKETS','PRIVATE_LEGACY_BROWSER_TICKETS_VERIFIED',
    'RUN_RESTORED_INQUIRY', 'START_RESTORED_HTTP', 'FINISH_RESTORED_HTTP', 'WAIT_CHROME_CLOSED', 'CLOSE',
    'MIGRATION_DONE', 'CHROME_READY', 'RESTORED_BASELINE_DONE', 'RESTORED_INQUIRY_DONE',
    'RESTORED_HTTP_READY', 'RESTORED_HTTP_DONE', 'CHROME_CLOSED', 'COORDINATOR_CLOSED', 'PHASE_FAILED', 'PHASE_REFUSED', 'CLOSE_CLOSED',
    'VERIFY_PRIVATE_BROWSER_TICKETS','PRIVATE_BROWSER_TICKETS_VERIFIED','START_PRIVATE_CHROME','PRIVATE_CHROME_READY','WAIT_PRIVATE_CHROME_CLOSED','PRIVATE_CHROME_CLOSED','RUN_PRIVATE_DOMAIN_BASELINE','PRIVATE_DOMAIN_BASELINE_DONE','VERIFY_PRIVATE_DOMAIN_RESTORE','PRIVATE_DOMAIN_RESTORE_VERIFIED','RUN_PRIVATE_DOMAIN_CASES','PRIVATE_DOMAIN_DONE', 'RUN_FULL_CATALOG', 'FULL_CATALOG_DONE', 'ISSUE_PRIVATE_QUALIFICATION', 'PRIVATE_QUALIFICATION_ISSUED',
    'PRIVATE_OLD_JOBS_STARTED','PRIVATE_OLD_JOBS_READY','PRIVATE_OLD_JOBS_PREPARED','PRIVATE_OLD_JOBS_CLOSED',
    'PREPARE_PRIVATE_OLD_JOBS','FINISH_PRIVATE_OLD_JOBS','PRIVATE_OLD_JOBS_PREPARE_AUTHORIZED','PRIVATE_OLD_JOBS_FINISH_AUTHORIZED',
    'START_PRIVATE_HTTP2','PRIVATE_HTTP2_READY','PREPARE_PRIVATE_HTTP2','PRIVATE_HTTP2_PREPARED','FINISH_PRIVATE_HTTP2','PRIVATE_HTTP2_DONE',
    'START_PRIVATE_JOBS', 'PRIVATE_JOBS_READY', 'PREPARE_PRIVATE_JOBS', 'PRIVATE_JOBS_PREPARED', 'FINISH_PRIVATE_JOBS', 'PRIVATE_JOBS_DONE',
    'PREPARE_PRIVATE_HTTP', 'PRIVATE_HTTP_PREPARE_AUTHORIZED', 'FINISH_PRIVATE_HTTP', 'PRIVATE_HTTP_FINISH_AUTHORIZED', 'PRIVATE_QUALIFICATION_CLOSED'])
EVENTS = frozenset(['HELLO', 'REQUEST', 'ACTOR_STARTED', 'MIGRATION_DONE', 'CHROME_READY', 'RESTORED_BASELINE_DONE',
    'PRISTINE_PERFORMANCE_DONE',
    'ONLINE_POINT_INQUIRY_READY','ONLINE_POINT_INQUIRY_DONE',
    'PRIVATE_LEGACY_CHROME_READY','PRIVATE_LEGACY_CHROME_CLOSED','PRIVATE_LEGACY_BROWSER_TICKETS_VERIFIED',
    'RESTORED_INQUIRY_DONE', 'RESTORED_HTTP_READY', 'RESTORED_HTTP_DONE', 'CHROME_CLOSED', 'CLOSED', 'HELD', 'PHASE_FAILED', 'PHASE_REFUSED', 'MAIN_FAILED_CLOSED',
    'PRIVATE_BROWSER_TICKETS_VERIFIED','PRIVATE_CHROME_READY','PRIVATE_CHROME_CLOSED','PRIVATE_DOMAIN_BASELINE_DONE','PRIVATE_DOMAIN_RESTORE_VERIFIED','PRIVATE_DOMAIN_DONE', 'FULL_CATALOG_DONE', 'PRIVATE_HTTP2_READY','PRIVATE_HTTP2_PREPARED','PRIVATE_HTTP2_DONE','PRIVATE_JOBS_READY', 'PRIVATE_JOBS_PREPARED', 'PRIVATE_JOBS_DONE',
    'PRIVATE_HTTP_STARTED', 'PRIVATE_HTTP_READY', 'PRIVATE_HTTP_PREPARED', 'PRIVATE_HTTP_CLOSED',
    'PRIVATE_OLD_JOBS_STARTED','PRIVATE_OLD_JOBS_READY','PRIVATE_OLD_JOBS_PREPARED','PRIVATE_OLD_JOBS_CLOSED'])

def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('ascii')

class HostReceipt:
    def __init__(self, authority, body, command, envelope, public_key):
        if authority is not _RECEIPT_AUTHORITY:
            raise RuntimeError('ORIGINAL_HOST_RECEIPT_UNPROVEN')
        self.body, self.command = body, command
        self.envelope, self.public_key = envelope, public_key

_RECEIPT_AUTHORITY = object()
_READ_FAILURE_AUTHORITY = object()

class OriginalHostChannelReadFailure(Exception):
    def __init__(self, authority):
        assert authority is _READ_FAILURE_AUTHORITY
        self.authority = authority
        super().__init__('ORIGINAL_HOST_CHANNEL_EMPTY_READ')

def is_original_channel_empty_read(error):
    return type(error) is OriginalHostChannelReadFailure and error.authority is _READ_FAILURE_AUTHORITY

class OriginalHostChannel:
    def __init__(self, public_key, session, role):
        assert role in ['main', 'candidate'] and re.fullmatch(r'[a-f0-9]{64}', session)
        key = base64.b64decode(public_key, validate=True)
        assert len(key) == 44 and key[:12] == bytes.fromhex('302a300506032b6570032100')
        self.public_key, self.public_key_bytes, self.session, self.role = public_key, key, session, role
        self.received, self.emitted = 0, 0
        self.input_identity = (os.fstat(0).st_dev, os.fstat(0).st_ino)
        self.output_identity = (os.fstat(1).st_dev, os.fstat(1).st_ino)
        self.observers = []

    def assert_observers_closed(self):
        assert all(owner['closed'] and owner['child'].returncode is not None for owner in self.observers), 'ORIGINAL_HOST_VERIFY_OWNER_HELD'

    def emit(self, event, body):
        assert event in EVENTS
        raw = encoded(body)
        assert len(raw) <= MAXIMUM and (os.fstat(1).st_dev, os.fstat(1).st_ino) == self.output_identity
        self.emitted += 1
        frame = dict(format=FORMAT, session=self.session, role=self.role, sequence=self.emitted,
            event=event, payload=base64.b64encode(raw).decode('ascii'))
        wire = PREFIX.encode() + encoded(frame) + b'\n'
        assert len(wire) <= MAXIMUM_FRAME
        sys.stdout.buffer.write(wire)
        sys.stdout.buffer.flush()

    def _verify(self, preimage, signature):
        descriptors = []
        try:
            for name, raw in [('public', self.public_key_bytes), ('message', preimage), ('signature', signature)]:
                fd = os.memfd_create('original-host-' + name, os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING)
                descriptors.append(fd)
                offset = 0
                while offset < len(raw):
                    count = os.write(fd, raw[offset:])
                    assert count > 0
                    offset += count
                os.lseek(fd, 0, os.SEEK_SET)
                fcntl.fcntl(fd, fcntl.F_ADD_SEALS, fcntl.F_SEAL_SEAL | fcntl.F_SEAL_WRITE | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_GROW)
            key, message, signed = descriptors
            # Existing immutable image supplies OpenSSL. No shell, secret file,
            # process-loading environment, timeout kill or caller executable.
            child = subprocess.Popen(['/usr/bin/openssl', 'pkeyutl', '-verify', '-pubin', '-keyform', 'DER',
                '-inkey', '/proc/self/fd/' + str(key), '-rawin', '-in', '/proc/self/fd/' + str(message),
                '-sigfile', '/proc/self/fd/' + str(signed)], pass_fds=tuple(descriptors),
                env={'PATH': '/usr/bin:/bin', 'LANG': 'C'}, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            owner = dict(child=child, closed=False)
            self.observers.append(owner)
            interruption = None
            while True:
                try:
                    child.wait()
                    owner['closed'] = True
                    break
                except BaseException as error:
                    # The exact original verification child remains owned. No
                    # interrupt releases its descriptors or adopts a PID.
                    if interruption is None:
                        interruption = error
            if interruption is not None:
                raise interruption
            assert child.returncode == 0, 'ORIGINAL_HOST_SIGNATURE_UNPROVEN'
        finally:
            for fd in descriptors:
                os.close(fd)

    def receive(self, expected):
        expected = {expected} if isinstance(expected, str) else set(expected)
        assert expected <= COMMANDS
        assert (os.fstat(0).st_dev, os.fstat(0).st_ino) == self.input_identity
        raw = sys.stdin.buffer.readline(MAXIMUM_FRAME + 1)
        if raw is None or raw == b'':
            # An empty transport read is distinct from a corrupt frame or an
            # unverified signature. It authorizes only negative own-closure
            # reporting; the original host must still prove candidate closure.
            raise OriginalHostChannelReadFailure(_READ_FAILURE_AUTHORITY)
        assert raw and len(raw) <= MAXIMUM_FRAME and raw.endswith(b'\n') and raw.startswith(PREFIX.encode()), 'ORIGINAL_HOST_CHANNEL_UNPROVEN'
        value = json.loads(raw[len(PREFIX):])
        assert set(value) == {'format', 'session', 'role', 'sequence', 'command', 'payload', 'signature'}
        assert value['format'] == FORMAT and value['session'] == self.session and value['role'] == self.role
        assert type(value['sequence']) is int and value['sequence'] == self.received + 1
        assert value['command'] in expected and isinstance(value['payload'], str)
        payload = base64.b64decode(value['payload'], validate=True)
        signature = base64.b64decode(value['signature'], validate=True)
        assert len(payload) <= MAXIMUM and len(signature) == 64
        preimage = ('\0'.join([FORMAT, self.session, self.role, str(value['sequence']), value['command'], value['payload']])).encode('ascii')
        self._verify(preimage, signature)
        self.received += 1
        return HostReceipt(_RECEIPT_AUTHORITY, json.loads(payload), value['command'], value, self.public_key)
