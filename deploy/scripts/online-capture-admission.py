"""Durable capture scheduling, not fleet closure or release admission.

Only the actual scoped capture guardian may close/reopen its pause. Interrupted
publication never deletes a hold. OPEN is not inferred from missing files, time,
free locks or a dead process. There is deliberately no recovery/reset CLI.
"""
import hashlib
import ctypes
import json
import os
from pathlib import Path
import re
import stat


def require(value):
    if not value:
        raise RuntimeError('ONLINE_CAPTURE_ADMISSION_UNPROVEN')


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode('ascii')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def exact(value, keys):
    return isinstance(value, dict) and set(value) == set(keys)


def identity(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns,
            value.st_ctime_ns, value.st_uid, value.st_mode, value.st_nlink)


def read(file, mode=0o400):
    require(file.resolve(strict=True) == file)
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid()
                and before.st_nlink == 1 and before.st_mode & 0o777 == mode
                and 0 < before.st_size <= 16384)
        raw = os.read(fd, 16385)
        require(len(raw) == before.st_size and identity(before) == identity(os.fstat(fd))
                and identity(before) == identity(file.lstat()))
        value = json.loads(raw)
        require(encode(value) == raw)
        return value, raw
    finally:
        os.close(fd)


def birth():
    return dict(pid=os.getpid(), bootId=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                pidNamespace=os.readlink('/proc/self/ns/pid'),
                startTicks=Path('/proc/self/stat').read_text().rsplit(') ', 1)[1].split()[19])


def valid_capture(value):
    return (exact(value, ['runtimeId', 'scopeSha256', 'guardian'])
            and all(isinstance(value[key], str) and re.fullmatch(r'[a-f0-9]{64}', value[key])
                    for key in ['runtimeId', 'scopeSha256'])
            and exact(value['guardian'], ['pid', 'bootId', 'pidNamespace', 'startTicks'])
            and type(value['guardian']['pid']) is int and value['guardian']['pid'] > 0
            and isinstance(value['guardian']['bootId'], str)
            and re.fullmatch(r'[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}', value['guardian']['bootId'])
            and isinstance(value['guardian']['pidNamespace'], str)
            and re.fullmatch(r'pid:\[[0-9]+\]', value['guardian']['pidNamespace'])
            and isinstance(value['guardian']['startTicks'], str)
            and re.fullmatch(r'[1-9][0-9]{0,24}', value['guardian']['startTicks']))


class CaptureAdmission:
    def __init__(self, loaded):
        self.loaded = loaded
        self.scope = loaded['scope']
        require(self.scope['format'] == 'sabalan-online-runtime-scope/v2')
        self.directory = Path(self.scope['admission']['directory'])
        self.root = None
        self.observed = None
        self.failed = False

    def root_identity(self):
        value = self.directory.lstat()
        require(self.directory.resolve(strict=True) == self.directory and stat.S_ISDIR(value.st_mode)
                and value.st_uid == os.getuid() and not value.st_mode & 0o077)
        current = (value.st_dev, value.st_ino)
        require(self.root is None or self.root == current)
        self.root = current
        definition, raw = read(self.directory / 'scope.json')
        # All roles bind the same global worker lock, including HTTP whose own
        # grant deliberately carries no worker ownership.
        require(exact(definition, ['format', 'gate', 'interlock', 'worker', 'database'])
                and definition['format'] == 'sabalan-online-admission-scope/v1'
                and digest(raw) == self.scope['admission']['scopeSha256']
                and all(definition[key] == self.scope[key] for key in ['gate', 'interlock', 'database'])
                and exact(definition['worker'], ['file', 'device', 'inode', 'ownerUid'])
                and definition['worker']['file'] == self.scope['coordinationDirectory'] + '/deployment-online-worker.lock'
                and (self.scope['worker'] is None or definition['worker'] == self.scope['worker']))
        return definition

    def state(self):
        try:
            require(not self.failed)
            self.root_identity()
            names = sorted(os.listdir(self.directory))
            events = [name for name in names if re.fullmatch(r'[0-9]{8}\.json', name)]
            require(len(events) >= 1 and len(events) <= 8192 and set(names) == {'scope.json', 'staging', *events})
            staging = self.directory / 'staging'
            staged = staging.lstat()
            require(staging.resolve(strict=True) == staging and stat.S_ISDIR(staged.st_mode)
                    and staged.st_uid == os.getuid() and not staged.st_mode & 0o077)
            previous, previous_raw = None, None
            seen_observed = self.observed is None
            for index, name in enumerate(events):
                require(name == str(index).zfill(8) + '.json')
                value, raw = read(self.directory / name)
                require(exact(value, ['format', 'generation', 'phase', 'previousSha256', 'capture', 'closureSha256'])
                        and value['format'] == 'sabalan-online-capture-admission/v1'
                        and type(value['generation']) is int and value['generation'] == index
                        and value['previousSha256'] == (digest(previous_raw) if previous_raw else None))
                if index == 0:
                    require(value['phase'] == 'OPEN' and value['capture'] is None and value['closureSha256'] is None)
                elif previous['phase'] == 'OPEN':
                    require(value['phase'] == 'CLOSING' and valid_capture(value['capture']) and value['closureSha256'] is None)
                else:
                    require(previous['phase'] == 'CLOSING' and value['phase'] == 'OPEN'
                            and value['capture'] == previous['capture']
                            and isinstance(value['closureSha256'], str) and re.fullmatch(r'[a-f0-9]{64}', value['closureSha256']))
                    native, native_raw = read(Path(self.scope['coordinationDirectory']) / 'online/native'
                                              / value['capture']['runtimeId'] / 'deployment-runtime-native.json', 0o600)
                    require(digest(native_raw) == value['closureSha256'] and native['phase'] == 'QUIESCENT'
                            and native.get('nativeReaped') is True and native.get('databaseQuiet') is True
                            and native.get('nativeStatus') == 0 and native.get('stoppedBySignal') is False
                            and native.get('guardian') == value['capture']['guardian']
                            and native.get('onlineScope', {}).get('sha256') == value['capture']['scopeSha256']
                            and native.get('onlineScope', {}).get('scope', {}).get('runtimeId') == value['capture']['runtimeId'])
                    captured = native['onlineScope']['scope']
                    require(captured.get('purpose') == 'capture' and captured.get('format') == 'sabalan-online-runtime-scope/v2'
                            and all(captured.get(key) == self.scope[key]
                                    for key in ['coordinationDirectory', 'admission', 'gate', 'interlock', 'database'])
                            and captured.get('worker') == self.root_identity()['worker'])
                if self.observed == (index, digest(raw)):
                    seen_observed = True
                previous, previous_raw = value, raw
            require(seen_observed)
            self.root_identity()
            self.observed = (previous['generation'], digest(previous_raw))
            return previous, previous_raw
        except Exception:
            self.failed = True
            raise RuntimeError('ONLINE_CAPTURE_ADMISSION_UNPROVEN') from None

    def assert_lock(self, descriptor, expected, access):
        require(os.path.realpath(expected['file']) == expected['file'])
        current, named = os.fstat(descriptor), os.lstat(expected['file'])
        require(identity(current) == identity(named) and stat.S_ISREG(current.st_mode)
                and current.st_uid == expected['ownerUid'] == os.getuid() and current.st_nlink == 1
                and current.st_size == 0 and not current.st_mode & 0o022
                and str(current.st_dev) == expected['device'] and str(current.st_ino) == expected['inode'])
        info = Path('/proc/self/fdinfo/' + str(descriptor)).read_text()
        match = re.search(r'^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+' + access
                          + r'\s+\S+\s+([0-9a-f]+):([0-9a-f]+):([0-9]+)\s+0\s+EOF\s*$', info, re.M)
        require(match and (int(match[1], 16), int(match[2], 16), int(match[3]))
                == (os.major(current.st_dev), os.minor(current.st_dev), current.st_ino))

    def assert_owner(self, descriptors, with_gate=False):
        require(self.scope['purpose'] == 'capture' and self.scope['worker'] is not None)
        for key, access in [('interlock', 'READ'), ('worker', 'WRITE')]:
            self.assert_lock(descriptors[key], self.scope[key], access)
        private = Path(self.scope['nativeDirectory']) / 'deployment-runtime-control.lock'
        value = private.lstat()
        self.assert_lock(descriptors['private'], dict(file=str(private), device=str(value.st_dev),
                         inode=str(value.st_ino), ownerUid=value.st_uid), 'WRITE')
        if with_gate:
            self.assert_lock(descriptors['gate'], self.scope['gate'], 'WRITE')

    def append(self, value, previous_raw, descriptors, with_gate=False):
        self.assert_owner(descriptors, with_gate)
        current, raw = self.state()
        require(raw == previous_raw and value['generation'] == current['generation'] + 1
                and value['generation'] < 8192)
        file = self.directory / (str(value['generation']).zfill(8) + '.json')
        staging = self.directory / 'staging'
        require(not os.listdir(staging))  # Unknown interrupted writer is retained.
        temporary = staging / (str(value['generation']).zfill(8) + '.json')
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
        try:
            os.fchmod(fd, 0o400)
            data = encode(value)
            offset = 0
            while offset < len(data):
                count = os.write(fd, data[offset:])
                require(count > 0)
                offset += count
            os.fsync(fd)
        finally:
            os.close(fd)
        self.assert_owner(descriptors, with_gate)
        # Atomic, no-replace publication: readers never observe partial JSON or
        # a transient second hard link. Staging bytes are never reset on error.
        libc = ctypes.CDLL(None, use_errno=True)
        require(libc.renameat2(-100, os.fsencode(temporary), -100, os.fsencode(file), 1) == 0)
        staged_fd = os.open(staging, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(staged_fd)
        finally:
            os.close(staged_fd)
        directory_fd = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        self.assert_owner(descriptors, with_gate)
        return self.state()

    def begin(self, descriptors):
        self.assert_owner(descriptors)
        previous, raw = self.state()
        # Reserve BOTH publications before closing. Capacity exhaustion must
        # leave the current OPEN state intact, never strand a successful capture.
        require(previous['phase'] == 'OPEN' and previous['generation'] + 2 < 8192)
        return self.append(dict(format=previous['format'], generation=previous['generation'] + 1,
                                phase='CLOSING', previousSha256=digest(raw), closureSha256=None,
                                capture=dict(runtimeId=self.scope['runtimeId'], scopeSha256=self.loaded['sha256'],
                                             guardian=birth())), raw, descriptors)

    def assert_capture(self, descriptors):
        self.assert_owner(descriptors, True)
        state, raw = self.state()
        require(state['phase'] == 'CLOSING' and state['capture'] == dict(runtimeId=self.scope['runtimeId'],
                scopeSha256=self.loaded['sha256'], guardian=birth()))
        return state, raw

    def finish(self, descriptors, native_raw):
        # Called ONLY by the native guardian after actual reaping and fresh SQL
        # zero, while retaining all four locks. Never exposed as a CLI/flag.
        state, raw = self.assert_capture(descriptors)
        native = json.loads(native_raw)
        require(native['phase'] == 'QUIESCENT' and native['nativeReaped'] is True
                and native['databaseQuiet'] is True and native['nativeStatus'] == 0
                and native['stoppedBySignal'] is False and native['guardian'] == birth()
                and native['onlineScope'] == self.loaded)
        return self.append(dict(format=state['format'], generation=state['generation'] + 1, phase='OPEN',
                                previousSha256=digest(raw), capture=state['capture'], closureSha256=digest(native_raw)),
                           raw, descriptors, True)
