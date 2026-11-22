"""Backup-only original Popen owner; fixed baseline/private HTTP actors.

No daemon discovery/adoption, arbitrary command, signal closure, public admission
or health publication. The host retains this original exec's pipes throughout.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit, urlunsplit


def check(value, code):
    if not value:
        raise RuntimeError(code)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def birth(pid):
    proc = Path('/proc') / str(pid)
    fields = (proc / 'stat').read_text().rsplit(') ', 1)[1].split()
    return dict(pid=pid, startTicks=fields[19],
                bootId=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                pidNamespace=os.readlink(proc / 'ns/pid'))


def emit(event, **value):
    print(json.dumps(dict(format='sabalan-original-independent-private-runtime/v1', event=event,
                          productionAdmission=False, **value), separators=(',', ':')), flush=True)


def private(file, expected=None):
    check(file.resolve(strict=True) == file, 'PRIVATE_INPUT_ALIAS')
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        check(__import__('stat').S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_nlink == 1
              and before.st_mode & 0o777 == 0o400 and 0 < before.st_size <= 8 * 1024**2, 'PRIVATE_INPUT_UNPROVEN')
        raw = bytearray()
        while len(raw) < before.st_size:
            chunk = os.read(fd, min(262144, before.st_size - len(raw))); check(chunk, 'PRIVATE_INPUT_TRUNCATED'); raw.extend(chunk)
        check(not os.read(fd, 1), 'PRIVATE_INPUT_GREW')
        pin = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_uid, s.st_mode, s.st_nlink)
        check(pin(before) == pin(os.fstat(fd)) == pin(file.lstat()), 'PRIVATE_INPUT_CHANGED')
        check(expected is None or digest(raw) == expected, 'PRIVATE_INPUT_SHA_MISMATCH')
        return bytes(raw)
    finally:
        os.close(fd)


def main():
    check(sys.platform == 'linux' and os.getuid() == 0 and not sys.flags.optimize, 'BACKUP_ORIGINAL_LINUX_ROOT_REQUIRED')
    os.umask(0o077)
    check(len(sys.argv) == 4 and sys.argv[2] in ['baseline', 'http'], 'FIXED_PRIVATE_ACTOR_REQUIRED')
    root = Path(sys.argv[1]); mode = sys.argv[2]
    check(re.fullmatch(r'/app/online-runtime-acceptance/application-native-[a-f0-9]{32}', str(root))
          and root.resolve(strict=True) == root and re.fullmatch(r'[a-f0-9]{64}', sys.argv[3]), 'ORIGINAL_ROOT_UNPROVEN')
    config = json.loads(private(root / 'independent-controller.json', sys.argv[3]))
    check(config['format'] == 'sabalan-original-independent-private-controller/v1', 'ORIGINAL_CONFIG_FORMAT')
    index = json.loads(private(root / 'index.json', config['indexSha256']))
    pair = index['privateQualification']; grant = index['restoredBaselineGrant'] if mode == 'baseline' else pair['httpGrant']
    private(Path(grant['file']), grant['sha256'])
    for name in ['online-runtime-owner.py', 'independent-restored-baseline.worker.cjs', 'online-private-qualification-worker.cjs']:
        private(root / name, config['sourcePins'][name])
    app = Path(pair['qualificationRoot']); check(app.resolve(strict=True) == app, 'PRIVATE_APP_ALIAS')
    source = urlsplit(os.environ['DATABASE_URL'])
    check(source.scheme in ['postgresql', 'postgres'] and source.hostname == config['postgres']['host']
          and source.port == config['postgres']['port'] and source.path == '/' + config['postgres']['controlDatabase'], 'PRIVATE_SQL_TARGET_CHANGED')
    env = dict(os.environ, NODE_ENV='test', BACKEND_RUNTIME_ROLE=grant['scope']['role'],
               BACKEND_ONLINE_SCOPE_FILE=grant['file'], BACKEND_ONLINE_SCOPE_SHA256=grant['sha256'],
               RECOVERY_COORDINATION_DIR=grant['scope']['coordinationDirectory'], RECOVERY_STORAGE_DIR=str(app / 'storage/recovery'),
               SMS_IR_API_KEY='', SMS_IR_ENVIRONMENT='production', SMS_IR_API_URL='http://127.0.0.1:1',
               WEB_PUSH_VAPID_PUBLIC_KEY='', WEB_PUSH_VAPID_PRIVATE_KEY='', WEB_PUSH_VAPID_SUBJECT='',
               TAXPAYER_DELIVERY_BROKER_ENDPOINT='', HR_HIRING_E2E='false', HR_HIRING_SMS_ADAPTER='disabled',
               HTTP_PROXY='', HTTPS_PROXY='', ALL_PROXY='', http_proxy='', https_proxy='', all_proxy='',
               NO_PROXY='127.0.0.1,localhost', no_proxy='127.0.0.1,localhost')
    env.pop('NODE_OPTIONS', None); env.pop('NODE_PATH', None)
    env['DATABASE_URL'] = urlunsplit(source._replace(path='/' + index['restoredDatabase'], query='connection_limit=2&pool_timeout=10'))
    if mode == 'baseline':
        input_file = root / 'independent-baseline-input.json'; private(input_file, config['baselineInputSha256'])
        args = [str(root / 'independent-restored-baseline.worker.cjs'), str(input_file), config['baselineInputSha256']]
    else:
        args = [str(root / 'online-private-qualification-worker.cjs'), config['publicKey'], config['session'], config['actorId']]
    native_file = Path(grant['scope']['nativeDirectory']) / 'deployment-runtime-native.json'
    check(not native_file.exists(), 'ORIGINAL_NATIVE_ALREADY_CLAIMED')
    child = subprocess.Popen(['/usr/bin/python3', '-I', '-B', str(root / 'online-runtime-owner.py'), '/usr/local/bin/node', *args],
                             cwd=app, env=env, stdin=subprocess.PIPE if mode == 'http' else subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    owner_birth = birth(child.pid); events = queue.Queue(); pumps = []; pump_errors = []

    def pump(stream, suffix):
        total = 0
        try:
            with (root / (mode + '-original.' + suffix)).open('xb') as output:
                while raw := stream.readline(8 * 1024**2 + 1):
                    total += len(raw); check(total <= 8 * 1024**2, 'ORIGINAL_OUTPUT_BOUND')
                    output.write(raw); output.flush(); os.fsync(output.fileno())
                    if suffix == 'stdout': events.put(raw)
        except BaseException as error:
            pump_errors.append(error)
        finally:
            stream.close()

    for stream, suffix in [(child.stdout, 'stdout'), (child.stderr, 'stderr')]:
        thread = threading.Thread(target=pump, args=(stream, suffix)); thread.start(); pumps.append(thread)

    def next_event(expected):
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            check(not pump_errors, 'ORIGINAL_OUTPUT_PUMP_FAILED')
            try:
                raw = events.get(timeout=0.1)
            except queue.Empty:
                check(child.poll() is None, 'ORIGINAL_EXIT_BEFORE_EVENT'); continue
            if mode == 'http':
                if not raw.startswith(b'SABALAN_PRIVATE_QUALIFICATION '): continue
                value = json.loads(raw[len(b'SABALAN_PRIVATE_QUALIFICATION '):])
                check(value['event'] == expected and value['actorId'] == config['actorId']
                      and value['scopeSha256'] == grant['sha256'], 'PRIVATE_ORIGINAL_EVENT_CHANGED')
            else:
                try: value = json.loads(raw)
                except ValueError: continue
                if value.get('event') != expected: continue
            return value
        raise RuntimeError('ORIGINAL_EVENT_DEADLINE_UNKNOWN')

    try:
        deadline = time.monotonic() + 120
        while not native_file.exists():
            check(child.poll() is None and time.monotonic() < deadline, 'NATIVE_STARTUP_UNKNOWN'); time.sleep(0.02)
        active_raw = native_file.read_bytes(); active = json.loads(active_raw)
        check(active['phase'] == 'ACTIVE' and active['guardian'] == owner_birth
              and active['onlineScope']['sha256'] == grant['sha256'], 'ORIGINAL_NATIVE_BIRTH_CHANGED')
        emit('STARTED', mode=mode, originalPopenPid=child.pid, birth=owner_birth,
             activeNativeRawBase64=base64.b64encode(active_raw).decode(), scopeSha256=grant['sha256'])
        if mode == 'http':
            emit('READY', result=next_event('READY'))
            for expected in ['PREPARED', 'CLOSED']:
                raw = sys.stdin.buffer.readline(65537); check(0 < len(raw) <= 65536 and raw.endswith(b'\n'), 'ORIGINAL_CONTROL_CHANNEL_LOST')
                child.stdin.write(raw); child.stdin.flush()
                result = next_event(expected)
                if expected == 'PREPARED': emit('PREPARED', result=result)
        else:
            result = next_event('restored-file-baseline-complete')
        # No timeout kill: if the owned guardian fails to close, locks/custody remain.
        child.wait()
        for thread in pumps: thread.join()
        check(child.returncode == 0 and not pump_errors, 'ORIGINAL_NATIVE_FAILED')
        native_raw = native_file.read_bytes(); native = json.loads(native_raw)
        work_raw = (Path(grant['scope']['boundaryDirectory']) / 'state.json').read_bytes(); work = json.loads(work_raw)
        check(native['guardian'] == owner_birth and native['phase'] == work['phase'] == 'QUIESCENT'
              and native['nativeReaped'] is True and native['databaseQuiet'] is True and native['nativeStatus'] == 0
              and native['stoppedBySignal'] is False and native['activeClaimSha256'] == digest(active_raw), 'ORIGINAL_NATIVE_CLOSURE_UNPROVEN')
        emit('CLOSED', mode=mode, result=result, originalPopenPid=child.pid, originalReturncode=child.returncode,
             nativeRawBase64=base64.b64encode(native_raw).decode(), workRawBase64=base64.b64encode(work_raw).decode(),
             workClaimRawBase64=base64.b64encode((Path(grant['scope']['boundaryDirectory'])/'claim.json').read_bytes()).decode(),
             workScopeRawBase64=base64.b64encode((Path(grant['scope']['boundaryDirectory'])/'scope.json').read_bytes()).decode(),
             scopeSha256=grant['sha256'])
    except BaseException:
        emit('HELD', mode=mode, originalPopenPid=child.pid, originalClosed=child.poll() is not None)
        # Preserve original handles and native custody; no reaper/adoption protocol.
        while True: time.sleep(30)


if __name__ == '__main__':
    main()
