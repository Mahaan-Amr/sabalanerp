"""Original Inquiry Popen owner. A private keeper alone is never HTTP READY.
Signed commands own start/stop; no PostgreSQL client or key enters this image.
"""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import subprocess
import sys
import time

PUBLIC = '/run/sabalan-online/release-controller-public-key.pem'
VERIFY = "const f=require('fs'),c=require('crypto');let b=[];process.stdin.on('data',x=>b.push(x));process.stdin.on('end',()=>{const v=JSON.parse(Buffer.concat(b)),k=c.createPublicKey(f.readFileSync(process.argv[1]));process.exit(k.asymmetricKeyType==='ed25519'&&c.verify(null,Buffer.from(v.message,'base64'),k,Buffer.from(v.signature,'base64'))?0:1)});"


def require(value):
    if not value: raise RuntimeError('ONLINE_ORIGINAL_INQUIRY_UNPROVEN')


def encode(value): return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def identity(s): return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_uid, s.st_mode, s.st_nlink)


def read(file, maximum=1048576):
    file = Path(file); require(file.resolve(strict=True) == file)
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and before.st_nlink == 1
                and not before.st_mode & 0o022 and 0 < before.st_size <= maximum)
        raw = bytearray()
        while part := os.read(fd, 65536): raw.extend(part); require(len(raw) <= maximum)
        require(len(raw) == before.st_size and identity(before) == identity(os.fstat(fd)) == identity(file.lstat()))
        return bytes(raw)
    finally: os.close(fd)


def birth(pid):
    fields = Path('/proc/' + str(pid) + '/stat').read_text().rsplit(') ', 1)[1].split()
    require(fields[0] != 'Z')
    return dict(pid=pid, startTicks=fields[19], bootId=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                pidNamespace=os.readlink('/proc/' + str(pid) + '/ns/pid'))


class InquiryOwner:
    def __init__(self, scope_file, scope_sha, session):
        require(sys.platform == 'linux' and not sys.flags.optimize and stat.S_ISFIFO(os.fstat(0).st_mode))
        require(re.fullmatch(r'/run/sabalan-online/[a-f0-9]{64}\.json', scope_file)
                and re.fullmatch(r'[a-f0-9]{64}', scope_sha) and re.fullmatch(r'[a-f0-9]{64}', session))
        require(not any(key.startswith(('PG', 'BACKEND_', 'INQUIRY_NATIVE_', 'LD_', 'PYTHON')) for key in os.environ)
                and not os.environ.get('NODE_OPTIONS') and not os.environ.get('NODE_PATH'))
        self.scope_raw = read(scope_file, 16384); require(sha(self.scope_raw) == scope_sha)
        self.scope = json.loads(self.scope_raw); self.file, self.sha, self.session = scope_file, scope_sha, session
        require(self.scope['format'] == 'sabalan-online-runtime-scope/v2' and self.scope['purpose'] == 'http'
                and self.scope['role'] == 'serving' and self.scope['worker'] is None)
        self.sequence = 0; self.children = []; self.actor = None; self.started = None; self.closed = False
        self.public_raw = read(PUBLIC, 4096)

    def original(self, argv, **kwargs):
        child = subprocess.Popen(argv, **kwargs); self.children.append(child); return child

    def emit(self, event, **fields): print(json.dumps(dict(event=event, **fields), separators=(',', ':')), flush=True)

    def receive(self):
        raw = sys.stdin.buffer.readline(262145); require(raw and raw.endswith(b'\n') and len(raw) <= 262144)
        envelope = json.loads(raw); require(set(envelope) == {'decision', 'signature'})
        value = envelope['decision']; require(set(value) == {'format', 'session', 'scopeSha256', 'sequence', 'command', 'input'})
        require(value['format'] == 'sabalan-online-original-control/v1' and value['session'] == self.session
                and value['scopeSha256'] == self.sha and value['sequence'] == self.sequence + 1)
        require(read(PUBLIC, 4096) == self.public_raw and read(self.file, 16384) == self.scope_raw)
        verifier = self.original(['/usr/local/bin/node', '-e', VERIFY, PUBLIC], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        out, err = verifier.communicate(encode(dict(message=base64.b64encode(b'sabalan-online-original-control/v1\n' + encode(value)).decode(), signature=envelope['signature'])))
        require(verifier.returncode == 0 and not out and len(err) <= 65536)
        self.sequence += 1; return value

    def native(self): return Path(self.scope['nativeDirectory']) / 'deployment-runtime-native.json'
    def work(self): return Path(self.scope['boundaryDirectory']) / 'state.json'

    def start(self, request):
        require(self.actor is None and set(request) == {'host', 'port', 'runtimeBundleSha256', 'generation', 'sqlite'})
        require(request['port'] == 3001 and isinstance(request['generation'], int) and request['generation'] >= 1
                and re.fullmatch(r'[0-9.]+', request['host']) and request['runtimeBundleSha256'] == self.scope['manifestSha256'])
        require(sha(read('/app/online-runtime/entry.cjs', 16 * 1024 * 1024)) == request['runtimeBundleSha256'])
        environment = dict(os.environ, BACKEND_RUNTIME_ROLE='serving', BACKEND_ONLINE_SCOPE_FILE=self.file,
                           BACKEND_ONLINE_SCOPE_SHA256=self.sha, RECOVERY_COORDINATION_DIR=self.scope['coordinationDirectory'],
                           INQUIRY_RUNTIME_GENERATION=str(request['generation']))
        require(not self.native().exists())
        self.actor = self.original(['/usr/bin/python3', '-I', '-B', '/app/online-runtime/scripts/online-inquiry-owner.py',
            '/usr/local/bin/node', '/app/node_modules/next/dist/bin/next', 'start', '--hostname', request['host'], '--port', '3001'],
            stdin=subprocess.DEVNULL, stdout=sys.stderr, stderr=sys.stderr, env=environment, cwd='/app')
        self.actor_birth = birth(self.actor.pid)
        while not self.native().exists(): require(self.actor.poll() is None); time.sleep(.02)
        self.started = read(self.native()); native = json.loads(self.started)
        require(native['phase'] == 'ACTIVE' and native['format'] == 'sabalan-inquiry-native/v2'
                and native['guardian'] == self.actor_birth and native['onlineScope']['sha256'] == self.sha
                and native['onlineScope']['scope'] == self.scope and native['sqlite'] == request['sqlite'])
        self.emit('ACTOR_STARTED', originalPid=self.actor.pid, guardian=self.actor_birth, native=native,
                  nativeRawBase64=base64.b64encode(self.started).decode())
        while True:
            require(self.actor.poll() is None and birth(self.actor.pid) == self.actor_birth and read(self.native()) == self.started)
            try:
                state_raw = read(self.work()); state = json.loads(state_raw)
                require(state['phase'] in ('ACTIVE', 'QUIESCENT'))
                with socket.create_connection((request['host'], 3001), timeout=1) as connection:
                    connection.sendall(b'GET /admin/login HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')
                    response = connection.recv(256)
                state_raw = read(self.work()); state = json.loads(state_raw)
                if state['phase'] == 'QUIESCENT' and response.startswith(b'HTTP/1.1 200'): break
            except (FileNotFoundError, OSError): pass
            time.sleep(.02)
        self.emit('READY', runtimeId=self.scope['runtimeId'], host=request['host'], port=3001,
                  nativeRawBase64=base64.b64encode(self.started).decode(), workRawBase64=base64.b64encode(state_raw).decode())

    def stop(self):
        require(self.actor is not None and not self.closed and self.actor.poll() is None and birth(self.actor.pid) == self.actor_birth)
        gate = self.scope['gate']; fd = os.open(gate['file'], os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            before = os.fstat(fd); require(stat.S_ISREG(before.st_mode) and before.st_size == 0 and before.st_nlink == 1
                and before.st_uid == gate['ownerUid'] and str(before.st_dev) == gate['device'] and str(before.st_ino) == gate['inode']
                and not before.st_mode & 0o022 and identity(before) == identity(os.lstat(gate['file'])))
            fcntl.flock(fd, fcntl.LOCK_EX)
            require(read(self.native()) == self.started and json.loads(read(self.work()))['phase'] == 'QUIESCENT'
                    and birth(self.actor.pid) == self.actor_birth)
            self.actor.send_signal(signal.SIGTERM); status = self.actor.wait()
            native_raw, work_raw = read(self.native()), read(self.work()); native, work = json.loads(native_raw), json.loads(work_raw)
            require(status == 128 and native['phase'] == 'QUIESCENT' and native['nativeReaped'] is True
                and native['sqliteNativeClosed'] is True and native['nativeStatus'] == 143 and native['stoppedBySignal'] is True
                and native['activeClaimSha256'] == sha(self.started) and native['guardian'] == self.actor_birth
                and native['onlineScope']['scope'] == self.scope and work['phase'] == 'QUIESCENT')
            require(all(child.poll() is not None for child in self.children))
            self.closed = True
            self.emit('CLOSED', runtimeId=self.scope['runtimeId'], originalReturncode=status, native=native,
                nativeRawBase64=base64.b64encode(native_raw).decode(), activeRawBase64=base64.b64encode(self.started).decode(),
                workRawBase64=base64.b64encode(work_raw).decode(), allOriginalChildrenClosed=True, requestedStop='SIGTERM')
        except BaseException:
            # An ambiguous native stop retains this SAME original gate owner.
            self.held(); raise
        finally: os.close(fd)

    def held(self):
        try: self.emit('HELD', originalPid=self.actor.pid if self.actor else None)
        except BaseException: pass
        for number in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGPIPE]: signal.signal(number, signal.SIG_IGN)
        while True: time.sleep(30)

    def run(self):
        request = self.receive(); require(request['command'] == 'START'); self.start(request['input'])
        request = self.receive(); require(request['command'] == 'STOP' and request['input'] == {}); self.stop()
        # An original host ACK is required before the controller can exit/EOF.
        request = self.receive(); require(request['command'] == 'ACK_CLOSED' and request['input'] == {})


def main():
    require(len(sys.argv) == 4); owner = InquiryOwner(*sys.argv[1:])
    try: owner.run()
    except BaseException: owner.held()


if __name__ == '__main__': main()
