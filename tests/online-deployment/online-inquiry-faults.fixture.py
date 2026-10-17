"""Deterministic lock-order/logging faults; retained ACTIVE is never repaired."""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time

root = Path(sys.argv[1])
config = json.loads((root / 'prepared.json').read_text())


def wait(predicate):
    deadline = time.monotonic() + 15
    while not predicate():
        assert time.monotonic() < deadline, 'FAULT_FIXTURE_TIMEOUT'
        time.sleep(0.01)


def available(file):
    with open(file, 'r') as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except BlockingIOError:
            return False


if len(sys.argv) == 4 and sys.argv[2] == 'child':
    name = sys.argv[3]
    spec = importlib.util.spec_from_file_location('inquiry_fault_owner', root / 'online-inquiry-owner.py')
    owner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(owner)
    scope = config[name]
    native = root / 'coordination/online/native' / scope['runtimeId']
    if name == 'stderr-failure':
        # Closed reader causes real EPIPE while retaining stderr's descriptor.
        read, write = os.pipe()
        os.close(read)
        os.dup2(write, 2)
        os.close(write)
        real_sync = os.fsync

        def fail_directory_sync(descriptor):
            value = os.fstat(descriptor)
            if stat.S_ISDIR(value.st_mode) and (value.st_dev, value.st_ino) == (native.stat().st_dev, native.stat().st_ino):
                raise OSError('INJECTED_NATIVE_DIRECTORY_FSYNC_FAILURE')
            return real_sync(descriptor)

        os.fsync = fail_directory_sync
    else:
        real_lock = fcntl.flock
        injected = False

        def intervening_owner(descriptor, mode):
            global injected
            if not injected and mode == fcntl.LOCK_SH | fcntl.LOCK_NB:
                injected = True
                # This is a synthetic durable ACTIVE refusal marker under a
                # real intervening exclusive interlock, not a SQL-closure proof.
                file = root / 'coordination/deployment-runtime-control.lock'
                with open(file, 'r+') as legacy:
                    real_lock(legacy, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    target = root / 'coordination/deployment-runtime-native.json'
                    with open(target, 'x') as marker:
                        os.fchmod(marker.fileno(), 0o600)
                        marker.write('{"format":"synthetic-intervening-owner-refusal","phase":"ACTIVE"}\n')
                        marker.flush()
                        os.fsync(marker.fileno())
            return real_lock(descriptor, mode)

        fcntl.flock = intervening_owner
    sys.argv = [str(root / 'online-inquiry-owner.py'), '/usr/local/bin/node', str(root / 'inquiry-worker.cjs'), str(root), name]
    try:
        sys.exit(owner.run())
    except Exception:
        sys.exit(75)

results = {}
for name in ['stderr-failure', 'legacy-race']:
    scope = config[name]
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith(('PG', 'BACKEND_', 'INQUIRY_NATIVE_')) and key != 'DATABASE_URL'}
    environment.update(BACKEND_RUNTIME_ROLE='serving', BACKEND_ONLINE_SCOPE_FILE=scope['file'],
                       BACKEND_ONLINE_SCOPE_SHA256=scope['sha256'], RECOVERY_COORDINATION_DIR=str(root / 'coordination'),
                       DATABASE_URL='file:' + str(root / 'inquiry.db') + '?connection_limit=2&pool_timeout=5')
    actor = subprocess.Popen(['/usr/bin/python3', '-I', '-B', str(Path(__file__)), str(root), 'child', name],
                             env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    native = root / 'coordination/online/native' / scope['runtimeId']
    if name == 'stderr-failure':
        wait(lambda: (native / 'deployment-runtime-native.json').exists() or actor.poll() is not None)
        time.sleep(0.15)
        held = actor.poll() is None and not available(native / 'deployment-runtime-control.lock')
        no_child = not (root / (name + '.node.json')).exists()
        if actor.poll() is None:
            # Deliberate owner-death diagnostic only, never successful closure.
            actor.kill()
        actor.wait(timeout=10)
        active = json.loads((native / 'deployment-runtime-native.json').read_text())
        assert active['phase'] == 'ACTIVE'
        results[name] = dict(heldDespiteUnavailableStderr=held, noChild=no_child, activeFenceRetained=True)
    else:
        wait(lambda: actor.poll() is not None or (root / (name + '.body-returned')).exists())
        if actor.poll() is None:
            (root / (name + '.finish')).write_text('complete-known-unexpected-query')
        actor.wait(timeout=15)
        refused = actor.returncode == 75 and not (root / (name + '.node.json')).exists()
        marker = json.loads((root / 'coordination/deployment-runtime-native.json').read_text())
        assert marker['phase'] == 'ACTIVE'
        results[name] = dict(refusedUnderAcquiredInterlock=refused, legacyFenceRetained=True)
print(json.dumps(results))
