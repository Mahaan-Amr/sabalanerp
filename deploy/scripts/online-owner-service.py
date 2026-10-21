#!/usr/bin/env python3
"""Permanent original launcher ownership; replaceable root-only update clients.

This module never adopts a runtime or reconstructs an ownership capability.
The service creates its launcher once and retains its original pipes for life.
"""
import base64
import fcntl
import hashlib
import json
import os
import pathlib
import queue
import re
import secrets
import selectors
import signal
import socket
import stat
import struct
import subprocess
import sys
import threading

P = pathlib.Path
UNIT = 'sabalan-online-owner.service'
INSTALLED = P('/usr/local/lib/sabalan-online-owner/online-owner-service.py')
INSTANCE = P('/etc/sabalan/online/original-owner.json')
RUN = P('/run/sabalan-online-owner')
MAX = 96 * 1024 * 1024
CONTROL = frozenset(['ACQUIRE_NEXT','DRAIN_CURRENT_JOBS','READ_CYCLE_PLAN','RETIRE_EXPIRED_BUILDS',
 'CREATE_CHECKPOINT','QUALIFY_NEXT','PREPARE_EXPANSION','RUN_EXPANSION','REGISTER','REGISTER_RETAINED',
 'PROVISION_CARRIERS','START_EDGE','APPEND_EDGE_ENDPOINTS','STOP_EDGE','START_RUNTIME','WAIT_READY',
 'PREPARE_DRAIN','WAIT_PREPARED','SHUTDOWN','WAIT_CLOSED','TRANSITION','PUBLISH','RUN_PRODUCTION_GATES',
 'FINISH_CYCLE','PREPARE_INQUIRY','START_INQUIRY','STOP_INQUIRY','QUIESCENT_SERVICE_EXIT'])
CANCELLED = []
NATIVE_AUDIT_ROOT = None
INSTALL_LOCK = None


def require(value):
    if not value:
        raise RuntimeError('ORIGINAL_SERVER_OWNER_UNPROVEN')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode() + b'\n'


def identity(s):
    return tuple(getattr(s, k) for k in ('st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'))


def read_pinned(file, digest=None, maximum=8*1024*1024, private=False):
    file = P(file)
    require(file.is_absolute() and file.resolve(strict=True) == file)
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_nlink == 1
                and not before.st_mode & (0o077 if private else 0o022) and 0 < before.st_size <= maximum)
        raw = bytearray()
        while len(raw) < before.st_size:
            b = os.read(fd, min(262144, before.st_size-len(raw)))
            require(b)
            raw.extend(b)
        require(not os.read(fd, 1) and identity(before) == identity(os.fstat(fd)) == identity(file.lstat()))
        require(digest is None or sha(raw) == digest)
        return bytes(raw)
    finally:
        os.close(fd)


def directory(file):
    require(not CANCELLED)
    if INSTALL_LOCK is not None:INSTALL_LOCK.check()
    file = P(file)
    if not file.exists():
        file.mkdir(mode=0o700)
    st = file.lstat()
    require(file.resolve(strict=True) == file and stat.S_ISDIR(st.st_mode) and st.st_uid == 0 and not st.st_mode & 0o077)


def durable(file, raw, mode=0o600, audit_after_observation=False):
    require(not CANCELLED or audit_after_observation)
    if INSTALL_LOCK is not None:INSTALL_LOCK.check()
    require(file.parent.resolve(strict=True) == file.parent)
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        os.fchmod(fd, mode)
        view = memoryview(raw)
        while view:
            n = os.write(fd, view)
            require(n > 0)
            view = view[n:]
        os.fsync(fd)
    finally:
        os.close(fd)
    fd = os.open(file.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def birth(pid):
    raw = P('/proc/%s/stat' % pid).read_text()
    return raw[raw.rfind(')')+2:].split()[19]


def frame(stream):
    raw = stream.readline(MAX+1)
    require(raw and raw.endswith(b'\n') and len(raw) <= MAX)
    return json.loads(raw)


def peer(connection):
    pid, uid, gid = struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
    require(pid > 1 and uid == 0)
    return pid


def pinned_selection(arguments):
    require(len(arguments) == 4)
    launcher, launcher_hash, config, config_hash = arguments
    require(re.fullmatch(r'/opt/sabalanerp/\.deploy-state/online-host-pack-[a-f0-9]{32}/deploy/scripts/online-release-launcher\.py', launcher))
    require(re.fullmatch(r'/opt/sabalanerp/\.deploy-state/online-control-[a-f0-9]{32}/launcher-config\.json', config))
    for digest in (launcher_hash, config_hash):
        require(re.fullmatch('[a-f0-9]{64}', digest))
    read_pinned(launcher, launcher_hash)
    cfg = json.loads(read_pinned(config, config_hash, private=True))
    root = P(launcher).parents[2]
    pack = json.loads(read_pinned(root/'host-pack-receipt.json', cfg['hostPackReceiptSha256']))
    source = root/'deploy/scripts/online-owner-service.py'
    source_raw = read_pinned(source, pack['outputs']['deploy/scripts/online-owner-service.py']['sha256'])
    require(read_pinned(P(__file__).resolve()) == source_raw)
    unit = root/'deploy/systemd/sabalan-online-owner.service'
    unit_raw = read_pinned(unit, pack['outputs']['deploy/systemd/sabalan-online-owner.service']['sha256'])
    selected = dict(launcherPath=launcher, launcherSha256=launcher_hash,
                    configurationPath=config, configurationSha256=config_hash,
                    serviceSha256=sha(source_raw), unitSha256=sha(unit_raw))
    selected['instanceId'] = sha(encode(selected))
    return selected, source_raw, unit_raw


def original_command(argv, allowed=(0,)):
    require(not CANCELLED)
    if INSTALL_LOCK is not None:INSTALL_LOCK.check()
    child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env=dict(PATH='/usr/sbin:/usr/bin:/sbin:/bin',HOME='/root',LC_ALL='C',TZ='UTC'),
        **(dict(pass_fds=(9,)) if INSTALL_LOCK is not None else {}))
    fault = None
    try:
        out, err = child.communicate()
    except BaseException as error:
        fault = type(error).__name__
        while True:
            try:
                out, err = child.communicate()
                break
            except BaseException:
                threading.Event().wait(1)
    record = dict(format='sabalan-original-owner-native-child-closure/v1',pid=child.pid,code=child.returncode,
        signal=-child.returncode if child.returncode is not None and child.returncode < 0 else None,
        pipesClosed=True,observationFault=fault,argv=argv,stdoutSha256=sha(out),stderrSha256=sha(err))
    require(NATIVE_AUDIT_ROOT is not None)
    durable(NATIVE_AUDIT_ROOT/('owner-native-child-'+str(child.pid)+'-'+secrets.token_hex(8)+'.json'),encode(record),0o400,audit_after_observation=True)
    require(fault is None and child.returncode in allowed and not CANCELLED and len(out) <= 1024*1024 and len(err) <= 65536)
    if INSTALL_LOCK is not None:INSTALL_LOCK.check()
    return out


class InstallLease:
    """The existing deployment mutex, never a new/adopted lock or DB lease."""
    def __enter__(self):
        global INSTALL_LOCK
        require(INSTALL_LOCK is None)
        try:os.fstat(9)
        except OSError:pass
        else:require(False)
        self.file = P('/opt/sabalanerp/.deploy-state/deployment.lock')
        fd = os.open(self.file,os.O_RDWR|os.O_NOFOLLOW|os.O_NONBLOCK)
        if fd != 9:
            os.dup2(fd,9,inheritable=True)
            os.close(fd)
        self.pin = identity(os.fstat(9))
        st = os.fstat(9)
        require(stat.S_ISREG(st.st_mode) and st.st_uid == 0 and st.st_nlink == 1 and not st.st_mode & 0o077)
        fcntl.flock(9,fcntl.LOCK_EX|fcntl.LOCK_NB)
        INSTALL_LOCK = self
        self.check()
        return self

    def check(self):
        require(identity(os.fstat(9)) == identity(self.file.lstat()) == self.pin)
        value = P('/proc/self/fdinfo/9').read_text()
        require(re.search(r'FLOCK\s+ADVISORY\s+WRITE\s+'+str(os.getpid())+r'\s+',value))

    def __exit__(self,*args):
        global INSTALL_LOCK
        self.check()
        os.close(9)
        INSTALL_LOCK = None


def install_observation(selected):
    require(INSTALL_LOCK is not None)
    root = P(selected['launcherPath']).parents[2]
    cfg = json.loads(read_pinned(selected['configurationPath'],selected['configurationSha256'],private=True))
    receipt = json.loads(read_pinned(root/'host-pack-receipt.json',cfg['hostPackReceiptSha256']))
    helper = root/'deploy/scripts/online-owner-install-guard.mjs'
    read_pinned(helper,receipt['outputs']['deploy/scripts/online-owner-install-guard.mjs']['sha256'])
    value = json.loads(original_command(['/usr/bin/node',str(helper),selected['configurationPath'],selected['configurationSha256']]))
    require(value['format'] == 'sabalan-original-owner-install-readonly-guard/v1' and value['readOnly'] is True
        and value['productionAdmission'] is False and re.fullmatch('[a-f0-9]{64}',value['baselineSha256']))
    require(all(row['code'] == 0 and row['signal'] is None for row in value['originalChildren']))
    return value['baselineSha256']


def unit_owner(pid, starting=False):
    require(os.getppid() == 1 and re.fullmatch('[a-f0-9]{32}',os.environ.get('INVOCATION_ID','')))
    raw = original_command(['/usr/bin/systemctl','show',UNIT,'--property=MainPID,FragmentPath,ActiveState,SubState']).decode()
    value = dict(line.split('=',1) for line in raw.splitlines() if '=' in line)
    require(value.get('MainPID') == str(pid) and value.get('FragmentPath') == '/etc/systemd/system/'+UNIT)
    require(value.get('ActiveState') in (('activating','active') if starting else ('active',)))


def installed_instance_guard(selected):
    files = [(INSTANCE,sha(encode(selected)),True),(INSTALLED,selected['serviceSha256'],False),
             (P('/etc/systemd/system')/UNIT,selected['unitSha256'],False)]
    pins = {str(file):identity(file.lstat()) for file,_,_ in files}
    def check():
        for file,digest,private in files:
            require(identity(file.lstat()) == pins[str(file)])
            read_pinned(file,digest,private=private)
        unit_owner(os.getpid())
    return check


def install(selected, source, unit):
    # Never overwrite, restart or attach to an unknown existing owner.
    require(not INSTANCE.exists() and not INSTALLED.exists() and not (P('/etc/systemd/system')/UNIT).exists())
    observed = original_command(['/usr/bin/systemctl','show',UNIT,'--property=LoadState,MainPID'],allowed=(0,1)).decode()
    state = dict(line.split('=',1) for line in observed.splitlines() if '=' in line)
    require(state.get('LoadState') == 'not-found' and state.get('MainPID','0') == '0')
    directory(INSTALLED.parent)
    directory(INSTANCE.parent)
    durable(INSTALLED, source, 0o755)
    durable(P('/etc/systemd/system')/UNIT, unit, 0o644)
    durable(INSTANCE, encode(selected))
    original_command(['/usr/bin/systemd-analyze','verify',str(P('/etc/systemd/system')/UNIT)])
    original_command(['/usr/bin/systemctl','daemon-reload'])
    original_command(['/usr/bin/systemctl','start',UNIT])
    observed = original_command(['/usr/bin/systemctl','show',UNIT,
      '--property=Type,RefuseManualStop,Restart,KillMode,SendSIGKILL,TimeoutStopUSec,MainPID']).decode()
    pairs = dict(line.split('=',1) for line in observed.splitlines() if '=' in line)
    require(all(pairs.get(k) == v for k,v in dict(Type='notify',RefuseManualStop='yes',Restart='no',KillMode='mixed',SendSIGKILL='no',TimeoutStopUSec='infinity').items()))
    require(int(pairs['MainPID']) > 1)
    before = probe_instance(selected)
    require(before['servicePid'] == int(pairs['MainPID']))
    # These are real negative unit tests only after effective safe properties
    # and actual inert original pipes are proved, still under canonical FD9.
    for command in ('stop','restart','try-restart'):
        original_command(['/usr/bin/systemctl',command,UNIT],allowed=tuple(range(1,256)))
        require(probe_instance(selected) == before)
    durable(NATIVE_AUDIT_ROOT/'owner-unit-inert-verified.json',encode(dict(
        format='sabalan-original-owner-inert-unit-verification/v1',unit=UNIT,properties=pairs,
        inertOriginal=before,manualStopRestartRefused=True)),0o400)


class Owner:
    def __init__(self, selected, instance_guard):
        self.selected = selected
        self.child = None
        self.held = None
        self.outputs = queue.Queue(maxsize=128)
        self.control_sequence = 0
        self.control_pending = False
        self.client = None
        self.begun = False
        self.signals = []
        self.writer_lock = threading.Lock()
        self.quiescent_requested = False
        self.quiescent_closed = False
        self.inert_aborting = False
        self.inert_closed = False
        self.operation_detached = False
        self.inert_abort_observed = threading.Event()
        require(callable(instance_guard))
        self.instance_guard = instance_guard
        self.operation_ready = threading.Event()

    def interrupted(self, number, _frame):
        self.signals.append(number)
        self.held = 'ORIGINAL_SERVICE_STOP_REFUSED_WITH_LIVE_OWNERS'

    def guard(self):
        require(not self.held and not self.signals and self.child is not None and self.child.poll() is None)
        self.instance_guard()
        if hasattr(self,'socket_pin'):
            require(identity((RUN/'client.sock').lstat()) == self.socket_pin and identity(RUN.lstat()) == self.run_pin)
            require(identity(os.fstat(self.server.fileno())) == self.socket_fd_pin)

    def start(self):
        for number in (signal.SIGINT,signal.SIGTERM,signal.SIGHUP):
            signal.signal(number,self.interrupted)
        directory(RUN)
        self.lock = os.open(RUN/'owner.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
        st = os.fstat(self.lock)
        require(stat.S_ISREG(st.st_mode) and st.st_uid == 0 and st.st_nlink == 1 and not st.st_mode & 0o077)
        fcntl.flock(self.lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        self.server = socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
        self.server.bind(str(RUN/'client.sock'))
        os.chmod(RUN/'client.sock',0o600)
        self.server.listen(1)
        self.socket_pin = identity((RUN/'client.sock').lstat())
        self.run_pin = identity(RUN.lstat())
        self.socket_fd_pin = identity(os.fstat(self.server.fileno()))
        read_pinned(self.selected['launcherPath'],self.selected['launcherSha256'])
        self.config = json.loads(read_pinned(self.selected['configurationPath'],self.selected['configurationSha256'],private=True))
        lifecycle_read, lifecycle_write = os.pipe()
        # The original launcher reserves FD9 itself. Never inherit this pipe
        # into that canonical lock slot, irrespective of the parent's FD layout.
        duplicated = fcntl.fcntl(lifecycle_write,fcntl.F_DUPFD_CLOEXEC,32)
        os.close(lifecycle_write)
        lifecycle_write = duplicated
        self.lifecycle = os.fdopen(lifecycle_read,'rb')
        self.child = subprocess.Popen(['/usr/bin/python3','-I','-B',self.selected['launcherPath'],self.selected['configurationPath'],'--owner-service'],
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=P(self.selected['launcherPath']).parents[2],
            pass_fds=(lifecycle_write,),env=dict(PATH='/usr/sbin:/usr/bin:/sbin:/bin',HOME='/root',LC_ALL='C',TZ='UTC',
                DOCKER_HOST='unix:///var/run/docker.sock',GIT_OPTIONAL_LOCKS='0',GIT_TERMINAL_PROMPT='0',
                SABALAN_ORIGINAL_OWNER_READY_FD=str(lifecycle_write)))
        os.close(lifecycle_write)
        ready = frame(self.child.stdout)
        require(ready == dict(format='sabalan-original-predeploy-ready/v1',launcherPid=self.child.pid,
            launcherBirth=birth(self.child.pid),configurationSha256=self.selected['configurationSha256']))
        self.binding = dict(instanceId=self.selected['instanceId'],servicePid=os.getpid(),serviceBirth=birth(os.getpid()),
            serviceBootIdSha256=sha(P('/proc/sys/kernel/random/boot_id').read_text().strip().lower().encode()),
            configurationSha256=self.selected['configurationSha256'],launcherPid=self.child.pid,launcherBirth=birth(self.child.pid))
        self.stdout_thread = threading.Thread(target=self.pump_stdout,daemon=False)
        self.stderr_thread = threading.Thread(target=self.pump_stderr,daemon=False)
        self.lifecycle_thread = threading.Thread(target=self.pump_lifecycle,daemon=False)
        self.stdout_thread.start()
        self.stderr_thread.start()
        self.lifecycle_thread.start()
        notify = os.environ.get('NOTIFY_SOCKET')
        require(notify)
        channel = socket.socket(socket.AF_UNIX,socket.SOCK_DGRAM)
        try:
            channel.connect('\0'+notify[1:] if notify.startswith('@') else notify)
            channel.sendall(b'READY=1\nSTATUS=WAITING_FOR_BOUND_CLIENT')
        finally:
            channel.close()

    def pump_stdout(self):
        try:
            while True:
                raw = self.child.stdout.read1(65536)
                if not raw and (self.quiescent_requested or self.inert_aborting):
                    require(self.child.wait() == 0)
                    return
                require(raw and len(raw) <= 65536)
                self.outputs.put(raw)
        except BaseException:
            self.held = 'ORIGINAL_LAUNCHER_OUTPUT_CUSTODY_LOST'

    def pump_lifecycle(self):
        expected = dict(launcherPid=self.child.pid,launcherBirth=birth(self.child.pid),
            configurationSha256=self.selected['configurationSha256'])
        try:
            ready = frame(self.lifecycle)
            if ready == dict(format='sabalan-original-predeploy-aborted/v1',**expected):
                require(self.inert_aborting and not self.begun and not self.client)
                require(not self.lifecycle.read(1))
                self.inert_abort_observed.set()
                return
            require(ready == dict(format='sabalan-original-operation-ready/v1',deployOriginalCode=0,**expected))
            self.operation_ready.set()
            terminal = frame(self.lifecycle)
            require(terminal == dict(format='sabalan-original-input-close-request/v1',**expected) and self.quiescent_requested)
            with self.writer_lock:
                self.child.stdin.close()
            require(not self.lifecycle.read(1))
        except BaseException:
            self.held = 'ORIGINAL_LAUNCHER_LIFECYCLE_UNPROVEN'
        finally:
            self.operation_ready.set()
            self.lifecycle.close()

    def pump_stderr(self):
        try:
            file = P(self.config['operationDirectory']).parent/'owner-launcher.stderr'
            fd = os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            total = 0
            try:
                while True:
                    b = self.child.stderr.read(65536)
                    if not b:
                        break
                    total += len(b)
                    if total <= 64*1024*1024:
                        view = memoryview(b)
                        while view:
                            written = os.write(fd,view)
                            require(written > 0)
                            view = view[written:]
                    else:
                        self.held = 'ORIGINAL_LAUNCHER_STDERR_BOUND'
                os.fsync(fd)
            finally:
                os.close(fd)
        except BaseException:
            self.held = 'ORIGINAL_LAUNCHER_STDERR_UNKNOWN'

    def send_launcher(self, value):
        self.guard()
        with self.writer_lock:
            self.child.stdin.write(encode(value))
            self.child.stdin.flush()

    def control(self, command, fields, client_sequence=None):
        self.guard()
        self.control_sequence += 1
        work = P(self.config['operationDirectory'])
        request = dict(sequence=self.control_sequence,command=command,**fields)
        if client_sequence is not None:
            require(type(client_sequence) is int and client_sequence > 0)
            request['clientSequence'] = client_sequence
        for name, flags in [('control-request.fifo',os.O_WRONLY),('control-response.fifo',os.O_RDONLY)]:
            file = work/name
            fd = os.open(file,flags|os.O_NOFOLLOW)
            try:
                st = os.fstat(fd)
                require(stat.S_ISFIFO(st.st_mode) and st.st_uid == 0 and stat.S_IMODE(st.st_mode) == 0o600)
                require(identity(st) == identity(file.lstat()))
                if flags == os.O_WRONLY:
                    with os.fdopen(os.dup(fd),'wb') as stream:
                        stream.write(encode(request))
                        stream.flush()
                else:
                    with os.fdopen(os.dup(fd),'rb') as stream:
                        result = frame(stream)
            finally:
                os.close(fd)
        require(result['sequence'] == self.control_sequence and result['command'] == command and result['status'] == 'COMPLETED')
        if command == 'QUIESCENT_SERVICE_EXIT':
            require(self.child.wait() == 0 and not self.held)
        else:
            self.guard()
        return result

    def connection(self, connection):
        peer(connection)
        self.guard()
        require(self.client is None)
        stream = connection.makefile('rb')
        opening = frame(stream)
        if opening.get('type') == 'ABORT_PREDEPLOY':
            require(opening == dict(type='ABORT_PREDEPLOY',instanceId=self.selected['instanceId']) and not self.begun)
            self.inert_aborting = True
            self.send_launcher(dict(format='sabalan-original-abort-predeploy/v1',instanceId=self.selected['instanceId'],
                configurationSha256=self.selected['configurationSha256']))
            require(self.child.wait() == 0)
            self.stdout_thread.join();self.stderr_thread.join();self.lifecycle_thread.join()
            require(self.inert_abort_observed.is_set() and not self.held and self.outputs.empty())
            self.child.stdin.close();self.child.stdout.close();self.child.stderr.close()
            receipt = dict(format='sabalan-original-inert-service-aborted/v1',instanceId=self.selected['instanceId'],
                servicePid=os.getpid(),serviceBirth=birth(os.getpid()),launcherPid=self.child.pid,launcherCode=0,
                originalPipesClosed=True,originalLogsClosed=True,deployEverStarted=False)
            durable(P(self.selected['configurationPath']).parent/'owner-inert-aborted.json',encode(receipt),0o400)
            self.inert_closed = True
            connection.sendall(encode(dict(type='INERT_ABORTED',body=receipt)))
            stream.close();connection.close()
            return
        if opening.get('type') == 'PROBE_INSTANCE':
            require(opening == dict(type='PROBE_INSTANCE',instanceId=self.selected['instanceId']) and not self.begun)
            probe = dict(format='sabalan-original-owner-inert-probe/v1',deploymentInert=True,**self.binding)
            probe['originalPipeHashes'] = {name:sha(encode(identity(os.fstat(getattr(self.child,name).fileno()))))
                for name in ('stdin','stdout','stderr')}
            connection.sendall(encode(dict(type='PROBED',body=probe)))
            stream.close()
            connection.close()
            return
        require(opening.get('mode') in ('INITIAL','FOLLOWING'))
        require(opening == dict(type='OPEN_CLIENT',instanceId=self.selected['instanceId'],mode=opening['mode']))
        require((opening['mode'] == 'INITIAL' and not self.begun) or
            (opening['mode'] == 'FOLLOWING' and self.begun and self.operation_detached))
        client = dict(self.binding,clientNonce=secrets.token_hex(32))
        self.client = client
        stop = threading.Event()
        connection.sendall(encode(dict(type='BOUND',body=dict(format='sabalan-original-client-bound/v1',**client))))
        writer = None
        control_thread = None
        detached = False
        try:
            request = frame(stream)
            require(request == dict(type='BIND_CLIENT',instanceId=client['instanceId'],clientNonce=client['clientNonce']))
            if not self.begun:
                self.begun = True  # Irreversible attempt, before any child-input write.
                self.send_launcher(dict(format='sabalan-original-begin-deploy/v1',configurationSha256=client['configurationSha256'],instanceId=client['instanceId'],clientNonce=client['clientNonce']))
            def write_outputs():
                try:
                    while not stop.is_set():
                        try:
                            raw = self.outputs.get(timeout=0.2)
                        except queue.Empty:
                            continue
                        if isinstance(raw,dict):
                            connection.sendall(encode(raw))
                            if raw['type'] == 'SERVICE_CLOSED':
                                stop.set()
                                connection.shutdown(socket.SHUT_WR)
                        else:
                            connection.sendall(encode(dict(type='OUTPUT',rawBase64=base64.b64encode(raw).decode())))
                except BaseException:
                    self.held = 'ORIGINAL_CLIENT_OUTPUT_CHANNEL_UNKNOWN'
            writer = threading.Thread(target=write_outputs,daemon=False)
            writer.start()
            sequence = 0
            for _ in iter(int,1):
                request = frame(stream)
                self.guard()
                require(request.get('clientNonce') == client['clientNonce'])
                if request.get('type') == 'PROTOCOL_FRAME':
                    require(set(request) == {'type','clientNonce','body'} and isinstance(request['body'],dict))
                    self.send_launcher(request['body'])
                elif request.get('type') == 'CONTROL_REQUEST':
                    require(set(request) == {'type','clientNonce','sequence','command','input'} and request['sequence'] == sequence+1)
                    require(request['command'] in CONTROL and isinstance(request['input'],dict) and not self.control_pending)
                    sequence += 1
                    self.control_pending = True
                    def run_control(row=dict(request)):
                        try:
                            if row['command'] == 'QUIESCENT_SERVICE_EXIT':
                                self.quiescent_requested = True
                            result = self.control(row['command'],row['input'],row['sequence'])
                            if row['command'] == 'QUIESCENT_SERVICE_EXIT':
                                self.stdout_thread.join()
                                self.stderr_thread.join()
                                self.lifecycle_thread.join()
                                require(not self.held and self.child.returncode == 0)
                                record = dict(format='sabalan-original-service-quiescent-closure/v1',
                                    instanceId=self.selected['instanceId'],originalLauncherPid=self.child.pid,
                                    originalLauncherCode=0,originalPipesClosed=True,originalLogsClosed=True)
                                durable(P(self.config['operationDirectory'])/'service-quiescent-closed.json',encode(record),0o400)
                                self.quiescent_closed = True
                                self.outputs.put(dict(type='SERVICE_CLOSED',body=record))
                        except BaseException:
                            self.held = 'ORIGINAL_CONTROL_REQUEST_UNPROVEN'
                        finally:
                            self.control_pending = False
                    control_thread = threading.Thread(target=run_control,daemon=False)
                    control_thread.start()
                elif request.get('type') == 'PREPARE_CLIENT_DETACH':
                    require(set(request) == {'type','clientNonce','mode'} and request['mode'] in ('BOOTSTRAP','FOLLOWING'))
                    require(not self.control_pending and self.outputs.empty())
                    if control_thread:
                        control_thread.join()
                    self.operation_ready.wait()
                    self.guard()
                    terminal = self.control('READ_CLIENT_DETACH_BARRIER',dict(input=dict(mode=request['mode'])))
                    barrier = terminal['clientDetachBarrier']
                    custody = terminal['launcherCustody']
                    require(barrier['format'] == 'sabalan-original-client-terminal-barrier/v1' and barrier['mode'] == request['mode'])
                    require(custody == dict(deployOriginalCode=0,pendingMasterReplies=0,checkpointProducerAbsent=True,
                        continuousOwnerAbsent=True,checkpointContextAbsent=True,launcherPid=self.child.pid,
                        launcherBirth=birth(self.child.pid),configurationSha256=self.selected['configurationSha256']))
                    stop.set()
                    writer.join()
                    require(self.outputs.empty() and not self.held)
                    receipt = dict(format='sabalan-original-client-detached/v1',mode=request['mode'],barrier=barrier,launcherCustody=custody,**client)
                    durable(P(self.config['operationDirectory'])/('client-detached-'+client['clientNonce']+'.json'),encode(receipt),0o400)
                    self.guard()
                    connection.sendall(encode(dict(type='DETACHED',body=receipt)))
                    detached = True
                    self.operation_detached = True
                    break
                else:
                    require(False)
        finally:
            if not detached and not self.quiescent_closed:
                self.held = 'ORIGINAL_CLIENT_LOST_BEFORE_VERIFIED_DETACH'
            stop.set()
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            if writer:
                writer.join()
            stream.close()
            connection.close()
            if detached:
                self.client = None

    def serve(self):
        try:
            self.start()
            while True:
                connection, _ = self.server.accept()
                try:
                    self.connection(connection)
                except BaseException:
                    if not self.quiescent_closed:
                        self.held = 'ORIGINAL_CLIENT_OR_SERVICE_HELD'
                    connection.close()
                if self.quiescent_closed or self.inert_closed:
                    require(self.child.returncode == 0 and not self.held)
                    self.server.close()
                    os.close(self.lock)
                    return
                # No exit, replacement child, deadline or signal follows an uncertain client.
        except BaseException:
            if self.child is None:
                raise
            self.held = 'ORIGINAL_SERVICE_OBSERVATION_UNKNOWN'
            # Even thread-start/notify/accept exceptions cannot abandon originals.
            while True:
                threading.Event().wait(1)


def verified_socket(selected):
    require(json.loads(read_pinned(INSTANCE,private=True)) == selected)
    parent = RUN.lstat();named = (RUN/'client.sock').lstat()
    require(RUN.resolve(strict=True) == RUN and stat.S_ISDIR(parent.st_mode) and parent.st_uid == 0 and not parent.st_mode & 0o077)
    require(stat.S_ISSOCK(named.st_mode) and named.st_uid == 0 and stat.S_IMODE(named.st_mode) == 0o600)
    connection = socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
    connection.connect(str(RUN/'client.sock'))
    actual_peer = peer(connection)
    require(identity(RUN.lstat()) == identity(parent) and identity((RUN/'client.sock').lstat()) == identity(named))
    unit = original_command(['/usr/bin/systemctl','show',UNIT,'--property=MainPID','--value']).strip()
    require(unit == str(actual_peer).encode())
    read_pinned(INSTALLED,selected['serviceSha256'])
    read_pinned(P('/etc/systemd/system')/UNIT,selected['unitSha256'])
    return connection,actual_peer


def probe_instance(selected):
    connection,actual_peer = verified_socket(selected)
    stream = connection.makefile('rb')
    try:
        connection.sendall(encode(dict(type='PROBE_INSTANCE',instanceId=selected['instanceId'])))
        row = frame(stream)
        require(row['type'] == 'PROBED')
        value = row['body']
        require(value['format'] == 'sabalan-original-owner-inert-probe/v1' and value['deploymentInert'] is True
            and value['instanceId'] == selected['instanceId'] and value['configurationSha256'] == selected['configurationSha256']
            and value['servicePid'] == actual_peer and value['serviceBirth'] == birth(actual_peer)
            and value['launcherBirth'] == birth(value['launcherPid']))
        return value
    finally:
        stream.close()
        connection.close()


def abort_inert_instance(selected):
    # Only a positively identified, never-begun original may take this path.
    observed = probe_instance(selected)
    pid = observed['servicePid']
    require(birth(pid) == observed['serviceBirth'])
    pidfd = os.pidfd_open(pid)
    connection = None
    stream = None
    try:
        connection,actual_peer = verified_socket(selected)
        require(actual_peer == pid and birth(pid) == observed['serviceBirth'])
        stream = connection.makefile('rb')
        connection.sendall(encode(dict(type='ABORT_PREDEPLOY',instanceId=selected['instanceId'])))
        row = frame(stream)
        require(row['type'] == 'INERT_ABORTED')
        receipt = row['body']
        require(receipt['format'] == 'sabalan-original-inert-service-aborted/v1' and receipt['instanceId'] == selected['instanceId']
            and receipt['servicePid'] == pid and receipt['serviceBirth'] == observed['serviceBirth']
            and receipt['launcherPid'] == observed['launcherPid'] and receipt['launcherCode'] == 0
            and receipt['originalPipesClosed'] is True and receipt['originalLogsClosed'] is True and receipt['deployEverStarted'] is False)
        require(not stream.read(1))
        selector = selectors.DefaultSelector()
        try:
            selector.register(pidfd,selectors.EVENT_READ)
            require(selector.select())  # Actual original process exit, no timer/kill.
        finally:selector.close()
        return receipt
    finally:
        if stream is not None:stream.close()
        if connection is not None:connection.close()
        os.close(pidfd)


def client(selected, reference=None):
    connection,actual_peer = verified_socket(selected)
    stream = connection.makefile('rb')
    connection.sendall(encode(dict(type='OPEN_CLIENT',instanceId=selected['instanceId'],mode='INITIAL' if reference is None else 'FOLLOWING')))
    bound = frame(stream)
    require(bound['type'] == 'BOUND')
    body = bound['body']
    require(body['format'] == 'sabalan-original-client-bound/v1' and body['servicePid'] == actual_peer
            and body['instanceId'] == selected['instanceId'] and body['configurationSha256'] == selected['configurationSha256']
            and birth(actual_peer) == body['serviceBirth'])
    if reference is not None:
        require(set(reference) == {'instanceId','servicePid','serviceBirth','configurationSha256'})
        require(all(body[k] == v for k,v in reference.items()))
    sys.stdout.buffer.write(b'SABALAN_ORIGINAL_CLIENT_BOUND '+encode(body))
    sys.stdout.buffer.flush()
    connection.sendall(encode(dict(type='BIND_CLIENT',instanceId=body['instanceId'],clientNonce=body['clientNonce'])))
    stop = threading.Event()
    errors = []
    def read_input():
        selector = selectors.DefaultSelector()
        selector.register(0,selectors.EVENT_READ)
        pending = bytearray()
        try:
            while not stop.is_set():
                if not selector.select(0.1):
                    continue
                raw = os.read(0,65536)
                require(raw)
                pending.extend(raw)
                require(len(pending) <= MAX)
                while b'\n' in pending:
                    line, _, pending = pending.partition(b'\n')
                    value = json.loads(line)
                    kind = value.get('format')
                    if kind == 'sabalan-original-client-detach/v1':
                        require(set(value) == {'format','mode'})
                        request = dict(type='PREPARE_CLIENT_DETACH',mode=value['mode'])
                    elif kind == 'sabalan-original-client-control/v1':
                        require(set(value) == {'format','sequence','command','input'})
                        request = dict(type='CONTROL_REQUEST',sequence=value['sequence'],command=value['command'],input=value['input'])
                    else:
                        request = dict(type='PROTOCOL_FRAME',body=value)
                    connection.sendall(encode(dict(clientNonce=body['clientNonce'],**request)))
        except BaseException:
            errors.append('ORIGINAL_CLIENT_INPUT_UNKNOWN')
            connection.shutdown(socket.SHUT_WR)
        finally:
            selector.close()
    reader = threading.Thread(target=read_input,daemon=False)
    reader.start()
    detached = False
    service_closed = False
    try:
        while True:
            row = frame(stream)
            if row['type'] == 'OUTPUT':
                raw = base64.b64decode(row['rawBase64'],validate=True)
                require(0 < len(raw) <= 65536)
                sys.stdout.buffer.write(raw)
                sys.stdout.buffer.flush()
            elif row['type'] == 'DETACHED':
                result = row['body']
                require(all(result[k] == v for k,v in body.items() if k != 'format'))
                require(result['format'] == 'sabalan-original-client-detached/v1' and not errors)
                sys.stdout.buffer.write(b'SABALAN_ORIGINAL_CLIENT_DETACHED '+encode(result))
                sys.stdout.buffer.flush()
                detached = True
                break
            elif row['type'] == 'SERVICE_CLOSED':
                result = row['body']
                require(result['format'] == 'sabalan-original-service-quiescent-closure/v1'
                    and result['instanceId'] == body['instanceId'] and result['originalLauncherPid'] == body['launcherPid']
                    and result['originalLauncherCode'] == 0 and result['originalPipesClosed'] is True
                    and result['originalLogsClosed'] is True and not errors)
                sys.stdout.buffer.write(b'SABALAN_ORIGINAL_SERVICE_CLOSED '+encode(result))
                sys.stdout.buffer.flush()
                service_closed = True
                break
            else:
                require(False)
    finally:
        stop.set()
        reader.join()
        stream.close()
        connection.close()
    require((detached or service_closed) and not errors)


def main():
    global NATIVE_AUDIT_ROOT
    require(sys.platform == 'linux' and os.getuid() == 0 and not sys.flags.optimize)
    for number in (signal.SIGINT,signal.SIGTERM,signal.SIGHUP):
        signal.signal(number,lambda n,_frame:CANCELLED.append(n))
    args = sys.argv[1:]
    if args == ['--serve',str(INSTANCE)]:
        selected = json.loads(read_pinned(INSTANCE,private=True))
        actual, _, _ = pinned_selection([selected['launcherPath'],selected['launcherSha256'],selected['configurationPath'],selected['configurationSha256']])
        require(actual == selected)
        require(sha(read_pinned(INSTALLED)) == selected['serviceSha256'])
        NATIVE_AUDIT_ROOT = P(selected['configurationPath']).parent
        unit_owner(os.getpid(),starting=True)
        Owner(selected,installed_instance_guard(selected)).serve()
    elif args == ['--await-original-quiescence',str(INSTANCE)]:
        # Observation only. Never stop a serving original because systemd asked.
        selected = json.loads(read_pinned(INSTANCE,private=True))
        config = json.loads(read_pinned(selected['configurationPath'],selected['configurationSha256'],private=True))
        closed = P(config['operationDirectory'])/'service-quiescent-closed.json'
        inert_closed = P(selected['configurationPath']).parent/'owner-inert-aborted.json'
        while True:
            if inert_closed.exists():
                value = json.loads(read_pinned(inert_closed,private=True))
                require(value['format'] == 'sabalan-original-inert-service-aborted/v1' and value['instanceId'] == selected['instanceId']
                    and value['launcherCode'] == 0 and value['originalPipesClosed'] is True
                    and value['originalLogsClosed'] is True and value['deployEverStarted'] is False)
                return
            if closed.exists():
                value = json.loads(read_pinned(closed,private=True))
                require(value['format'] == 'sabalan-original-service-quiescent-closure/v1'
                    and value['instanceId'] == selected['instanceId'] and value['originalLauncherCode'] == 0
                    and value['originalPipesClosed'] is True and value['originalLogsClosed'] is True)
                # This observation never authorizes owner reconstruction/start.
                return
            threading.Event().wait(1)
    else:
        require(args and args[0] in ('--install-client','--client'))
        require(len(args) == (5 if args[0] == '--install-client' else 6))
        selected, source, unit = pinned_selection(args[1:5])
        NATIVE_AUDIT_ROOT = P(selected['configurationPath']).parent
        if args[0] == '--install-client':
            with InstallLease():
                try:
                    baseline = install_observation(selected)
                    install(selected,source,unit)
                    require(install_observation(selected) == baseline)
                except BaseException as error:
                    blocked = dict(format='sabalan-original-owner-install-blocked/v1',instanceId=selected['instanceId'],
                        failureType=type(error).__name__,runtimeAdmission=False,inertAbortProven=False)
                    try:
                        blocked['inertAbort'] = abort_inert_instance(selected)
                        blocked['inertAbortProven'] = True
                    except BaseException:
                        blocked['sameOriginalMayRemainHeld'] = True
                    durable(NATIVE_AUDIT_ROOT/('owner-install-blocked-'+secrets.token_hex(16)+'.json'),encode(blocked),
                        0o400,audit_after_observation=True)
                    raise
            # BEGIN_DEPLOY occurs only after natural release of this FD9.
            reference = None
        else:
            reference = json.loads(args[5])
            require(isinstance(reference,dict) and set(reference) == {'instanceId','servicePid','serviceBirth','configurationSha256'})
        client(selected,reference)
        require(not CANCELLED)


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        # Never print configuration, database URLs, assertion values or remote frames.
        sys.stderr.write('ORIGINAL_SERVER_OWNER_FAILED_OR_HELD\n')
        sys.exit(1)
