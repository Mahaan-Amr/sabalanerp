"""Coordinator-only restored Inquiry child inside the existing carrier.

No CLI, Docker, schema creation, seeding, migrations or public admission. Failed
attempts retain their exact child for inspection; there is no automatic cleanup.
"""
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import stat
import subprocess
import sys
import socket


def require(value):
    if not value:
        raise RuntimeError('RESTORED_INQUIRY_UNPROVEN')


def identity(value):
    return dict(device=str(value.st_dev), inode=str(value.st_ino), size=value.st_size,
                mode=value.st_mode, uid=value.st_uid, gid=value.st_gid,
                mtimeNs=str(value.st_mtime_ns),
                # Windows stat uses creation time while CRT fstat's deprecated
                # ctime can mean modification time. Linux retains exact ctime.
                ctimeNs=str(value.st_birthtime_ns if sys.platform == 'win32' else value.st_ctime_ns))


def stable_file(file):
    file = Path(file)
    require(file.is_absolute() and file.resolve(strict=True) == file)
    before = file.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1)
    descriptor = os.open(file, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
    try:
        require(identity(before) == identity(os.fstat(descriptor)))
        digest = hashlib.sha256()
        while part := os.read(descriptor, 1024 * 1024):
            digest.update(part)
        require(identity(before) == identity(os.fstat(descriptor)) == identity(file.lstat()))
        return dict(path=str(file), sha256=digest.hexdigest(), **identity(before))
    finally:
        os.close(descriptor)


def sqlite_snapshot(file):
    """Original bytes and relevant metadata, including any journal sidecars."""
    result = stable_file(file)
    result['sidecars'] = [stable_file(Path(str(file) + suffix)) for suffix in ['-wal', '-shm', '-journal']
                          if os.path.lexists(str(file) + suffix)]
    return result


def verify_restored(file, expected):
    require(isinstance(expected, str) and re.fullmatch(r'[a-f0-9]{64}', expected))
    before = sqlite_snapshot(file)
    require(before['sha256'] == expected and before['sidecars'] == [])
    # An independently restored closed database must not depend on omitted WAL.
    database = sqlite3.connect(Path(file).as_uri() + '?mode=ro&immutable=1', uri=True)
    try:
        require(database.execute('PRAGMA integrity_check').fetchall() == [('ok',)])
    finally:
        database.close()
    require(sqlite_snapshot(file) == before)
    return before


def module(file, name):
    spec = importlib.util.spec_from_file_location(name, file)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def sync_directory(directory):
    if sys.platform == 'linux':
        descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def qualify_loopback_listener(tcp_text, owned_inodes, port):
    """Pure policy, not native authority: require one owned IPv4 loopback socket."""
    listeners = []
    for line in tcp_text.splitlines():
        fields = line.split()
        if len(fields) > 9 and fields[0].endswith(':') and fields[0][:-1].isdigit():
            address, separator, raw_port = fields[1].partition(':')
            require(separator and re.fullmatch(r'[A-Fa-f0-9]{4}', raw_port))
            if int(raw_port, 16) == port and fields[3] == '0A':
                listeners.append((address.upper(), fields[9]))
    require(len(listeners) == 1 and listeners[0][0] == '0100007F' and listeners[0][1] in owned_inodes)
    return listeners[0][1]


def process_birth(pid):
    fields = Path('/proc/' + str(pid) + '/stat').read_text().rsplit(') ', 1)[1].split()
    require(fields[0] != 'Z')
    return dict(pid=pid, startTicks=fields[19], bootId=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                pidNamespace=os.readlink('/proc/' + str(pid) + '/ns/pid'))


def owned_listener(guardian, port):
    require(process_birth(guardian['pid']) == guardian)
    births, sockets, pending = {}, set(), [guardian['pid']]
    while pending:
        pid = pending.pop()
        require(pid not in births)
        births[pid] = process_birth(pid)
        pending.extend(int(value) for value in Path('/proc/' + str(pid) + '/task/' + str(pid) + '/children').read_text().split())
        for descriptor in Path('/proc/' + str(pid) + '/fd').iterdir():
            try:
                target = os.readlink(descriptor)
            except FileNotFoundError:
                continue  # Concurrent descriptor close grants no ownership.
            matched = re.fullmatch(r'socket:\[([0-9]+)\]', target)
            if matched:
                sockets.add(matched[1])
    tcp = Path('/proc/net/tcp').read_text() + '\n' + Path('/proc/net/tcp6').read_text()
    inode = qualify_loopback_listener(tcp, sockets, port)
    require(all(process_birth(pid) == birth for pid, birth in births.items()))
    return inode


class RestoredInquiryProbe:
    @classmethod
    def prepare(cls, parent, nonce, restored, expected_sha256, original):
        parent, restored, original = map(Path, [parent, restored, original])
        require(parent.is_absolute() and parent.resolve(strict=True) == parent
                and re.fullmatch(r'[a-f0-9]{32}', nonce))
        if sys.platform == 'linux':
            require(parent.stat().st_uid == os.getuid() and not parent.stat().st_mode & 0o022)
        original_before = sqlite_snapshot(original)
        source = verify_restored(restored, expected_sha256)
        require((source['device'], source['inode']) != (original_before['device'], original_before['inode']))
        self = cls()
        self.root = parent / ('inquiry-restored-' + nonce)
        self.retired_file = parent / (self.root.name + '.retired.json')
        require(not os.path.lexists(self.retired_file))
        self.root.mkdir(mode=0o700)  # Exclusive operation child; never reuse.
        self.root_identity = identity(self.root.stat())
        self.original, self.original_before = original, original_before
        self.database = self.root / 'restored.db'
        with restored.open('rb') as incoming, self.database.open('xb') as outgoing:
            while part := incoming.read(1024 * 1024):
                outgoing.write(part)
            outgoing.flush()
            os.fsync(outgoing.fileno())
        os.chmod(self.database, 0o600)
        require(sqlite_snapshot(restored) == source)
        self.input_receipt = verify_restored(self.database, expected_sha256)
        require(sqlite_snapshot(original) == original_before)
        self.state, self.readers, self.actor, self.log = 'PREPARED', 0, None, None
        return self

    @contextmanager
    def reader(self):
        """Caller retains this borrow through actual private HTTP reader closure."""
        require(self.state in ['PREPARED', 'RUNNING'])
        self.readers += 1
        try:
            yield self.database
        finally:
            self.readers -= 1

    def start(self, scope_environment, port, stop_policy_file, selection):
        require(sys.platform == 'linux' and not sys.flags.optimize and self.state == 'PREPARED'
                and type(port) is int and 1024 <= port <= 65535)
        self.state = 'STARTING'  # Failed scope/start remains held, never reusable.
        scope_module = module(Path(__file__).with_name('online-runtime-scope.py'), 'restored_scope')
        keys = {'BACKEND_RUNTIME_ROLE', 'BACKEND_ONLINE_SCOPE_FILE', 'BACKEND_ONLINE_SCOPE_SHA256', 'RECOVERY_COORDINATION_DIR'}
        require(set(scope_environment) == keys)
        self.scope_environment = dict(scope_environment)
        loaded = scope_module.load_scope(scope_environment)
        require(loaded is not None and loaded['scope']['purpose'] == 'http'
                and loaded['scope']['role'] == 'serving' and loaded['scope']['worker'] is None)
        require(loaded['scope']['image'] == selection['build']['image'])
        require(stable_file(Path('/app/online-runtime/entry.cjs'))['sha256'] == loaded['scope']['manifestSha256'])
        compiled = subprocess.run(['/usr/local/bin/node', str(Path(__file__).with_name('inquiry-compiled-browser.cjs')), '/app'],
                                  stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        observed = json.loads(compiled.stdout)
        require(all(observed[key] == selection['compiled'][key] for key in
                    ['id', 'frameworkBuildId', 'deploymentId', 'manifestSha256', 'assets', 'actionIds']))
        self.loaded = loaded
        self.native_file = Path(loaded['scope']['nativeDirectory']) / 'deployment-runtime-native.json'
        self.work_file = Path(loaded['scope']['boundaryDirectory']) / 'state.json'
        require(not self.native_file.exists() and not self.work_file.exists())
        self.stop_policy = module(stop_policy_file, 'restored_inquiry_stop')
        self.stop_policy_receipt = stable_file(Path(stop_policy_file))
        verify_restored(self.database, self.input_receipt['sha256'])
        # Keep only operational basics and the existing Inquiry session/build
        # identity. No inherited injection, PostgreSQL, mail or seed authority.
        allowed = ['PATH', 'LANG', 'TZ', 'SESSION_SECRET', 'SABALAN_INQUIRY_BUILD_ID',
                   'NEXT_PUBLIC_INQUIRY_BUILD_ID', 'NEXT_DEPLOYMENT_ID']
        env = {key: os.environ[key] for key in allowed if key in os.environ}
        for key in ['SABALAN_INQUIRY_BUILD_ID', 'NEXT_PUBLIC_INQUIRY_BUILD_ID', 'NEXT_DEPLOYMENT_ID']:
            if key in selection['runtimeEnvironment']:
                require(key not in env or env[key] == selection['runtimeEnvironment'][key])
                env[key] = selection['runtimeEnvironment'][key]
        env.update(scope_environment, NODE_ENV='production', NEXT_TELEMETRY_DISABLED='1',
                   INQUIRY_RUNTIME_GENERATION='1',
                   DATABASE_URL='file:' + str(self.database) + '?connection_limit=2&pool_timeout=5')
        self.log = (self.root / 'native.log').open('xb')
        self.log_identity = identity(os.fstat(self.log.fileno()))
        owner = Path(__file__).with_name('online-inquiry-owner.py')
        self.actor = subprocess.Popen(['/usr/bin/python3', '-I', '-B', str(owner), '/usr/local/bin/node',
                                       '/app/node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', str(port)],
                                      cwd='/app', env=env, stdin=subprocess.DEVNULL, stdout=self.log, stderr=self.log)
        self.actor_birth = process_birth(self.actor.pid)
        self.state = 'RUNNING'
        self.port = port
        return dict(endpoint='http://127.0.0.1:' + str(port), originalPopenPid=self.actor.pid,
                    sqlite=self.input_receipt, scopeSha256=loaded['sha256'], ready=False)

    def observe_ready(self):
        """One observation; scheduling/retry and browser work belong to caller."""
        require(self.state == 'RUNNING' and self.actor.poll() is None)
        active_raw = self.native_file.read_bytes()
        native = json.loads(active_raw)
        require(native['format'] == 'sabalan-inquiry-native/v2' and native['phase'] == 'ACTIVE'
                and native['guardian'] == self.actor_birth and native['onlineScope'] == self.loaded
                and native['sqlite']['file'] == str(self.database)
                and native['sqlite']['device'] == self.input_receipt['device']
                and native['sqlite']['inode'] == self.input_receipt['inode'])
        listener = owned_listener(self.actor_birth, self.port)
        with self.reader(), socket.create_connection(('127.0.0.1', self.port), timeout=1) as connection:
            connection.sendall(b'GET /admin/login HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')
            require(connection.recv(256).startswith(b'HTTP/1.1 200'))
        require(self.actor.poll() is None and self.native_file.read_bytes() == active_raw
                and json.loads(self.work_file.read_bytes())['phase'] == 'QUIESCENT')
        require(owned_listener(self.actor_birth, self.port) == listener)
        self.active_raw = active_raw
        return dict(endpoint='http://127.0.0.1:' + str(self.port), ready=True,
                    originalPopenPid=self.actor.pid, activeClaimSha256=hashlib.sha256(active_raw).hexdigest(),
                    sqlite=self.input_receipt, scopeSha256=self.loaded['sha256'], productionAdmission=False)

    def stop(self):
        require(self.state == 'RUNNING' and self.readers == 0 and self.actor.poll() is None
                and hasattr(self, 'active_raw') and process_birth(self.actor.pid) == self.actor_birth)
        # Re-observe the genuine mount and scope before signalling our Popen.
        scope_module = module(Path(__file__).with_name('online-runtime-scope.py'), 'restored_scope_stop')
        require(scope_module.load_scope(self.scope_environment) == self.loaded)
        import fcntl
        gate = self.loaded['scope']['gate']
        descriptor = os.open(gate['file'], os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
        # Retain this exact descriptor on any ambiguous outcome. The persistent
        # coordinator must keep this owner alive until closure is resolved.
        self.held_gate = descriptor
        current = os.fstat(descriptor)
        require(str(current.st_dev) == gate['device'] and str(current.st_ino) == gate['inode']
                and current.st_uid == gate['ownerUid'] and stat.S_ISREG(current.st_mode)
                and current.st_nlink == 1 and current.st_size == 0
                and not current.st_mode & 0o022 and identity(current) == identity(os.lstat(gate['file'])))
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        active_raw = self.native_file.read_bytes()
        require(active_raw == self.active_raw)
        initial = json.loads(active_raw)
        require(initial['phase'] == 'ACTIVE' and initial['guardian']['pid'] == self.actor.pid)
        require(json.loads(self.work_file.read_bytes())['phase'] == 'QUIESCENT')
        request = dict(format='sabalan-private-inquiry-requested-stop/v1', guardian=initial['guardian'],
                       activeClaimSha256=hashlib.sha256(active_raw).hexdigest(), signal='SIGTERM',
                       expectedNativeStatus=143, naturalExitZeroExpected=False)
        with (self.root / 'requested-stop.json').open('x') as receipt:
            json.dump(request, receipt, sort_keys=True)
            receipt.flush()
            os.fsync(receipt.fileno())
        self.request_receipt = stable_file(self.root / 'requested-stop.json')
        self.actor.send_signal(signal.SIGTERM)
        self.actor.wait()  # No timeout/kill path that could invent closure.
        final = json.loads(self.native_file.read_bytes())
        result = self.stop_policy.qualify_requested_stop(request, initial, final, self.actor.returncode)
        require(json.loads(self.work_file.read_bytes())['phase'] == 'QUIESCENT')
        self.log.close()
        self.log_receipt = stable_file(self.root / 'native.log')
        self.state = 'CLOSED'
        self.closure = dict(result, originalPopenPid=self.actor.pid, wrapperStatus=self.actor.returncode,
                            nativeSha256=hashlib.sha256(self.native_file.read_bytes()).hexdigest(), workClosed=True)
        os.close(self.held_gate)
        self.held_gate = None
        return self.closure

    def retire(self):
        require(self.state in ['PREPARED', 'CLOSED'] and self.readers == 0)
        require(self.actor is None or self.actor.poll() is not None and self.log.closed)
        require(self.root.resolve(strict=True) == self.root)
        current = identity(self.root.stat())
        require(all(current[key] == self.root_identity[key] for key in ['device', 'inode', 'mode', 'uid', 'gid']))
        require(sqlite_snapshot(self.original) == self.original_before)
        require(verify_restored(self.database, self.input_receipt['sha256']) == self.input_receipt)
        names = {'restored.db'} if self.state == 'PREPARED' else {'restored.db', 'native.log', 'requested-stop.json'}
        require(set(os.listdir(self.root)) == names)
        # Validate every entry before deleting any. Never recurse or remove a
        # caller's scope, app/dependency tree, input archive or historical parent.
        for name in names:
            stable_file(self.root / name)
        if self.state == 'CLOSED':
            require(stable_file(self.root / 'native.log') == self.log_receipt
                    and stable_file(self.root / 'requested-stop.json') == self.request_receipt)
        closure = getattr(self, 'closure', None)
        result = dict(format='sabalan-restored-inquiry-retired/v1', retired=True,
                      originalDatabase=self.original_before, inputSqlite=self.input_receipt,
                      closure=closure, nativeQualified=False, productionAdmission=False)
        # Durable consumed-operation tombstone remains outside the exact child.
        # It is evidence, never a portable native capability or future admission.
        with self.retired_file.open('x') as receipt:
            json.dump(dict(format=result['format'], retired=False, phase='RETIRING', workingRoot=str(self.root)), receipt, sort_keys=True)
            receipt.flush()
            os.fsync(receipt.fileno())
        sync_directory(self.root.parent)
        for name in names:
            (self.root / name).unlink()
        self.root.rmdir()
        # Only a completed removal earns a completed durable receipt. A crash
        # before atomic replacement leaves the fail-closed RETIRING tombstone.
        temporary = Path(str(self.retired_file) + '.tmp')
        with temporary.open('x') as receipt:
            json.dump(result, receipt, sort_keys=True)
            receipt.flush()
            os.fsync(receipt.fileno())
        os.replace(temporary, self.retired_file)
        sync_directory(self.root.parent)
        self.state = 'RETIRED'
        return result
