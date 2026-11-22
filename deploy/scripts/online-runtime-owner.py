#!/usr/bin/env python3
"""Acquire real online incarnation locks; never promote or grant public work.

The native guardian retains these descriptors through descendant AND SQL
completion. A host-issued scope is input, not release acceptance. This private
entry point does not enable the main application's serving/control roles.
"""
import fcntl
import importlib.util
import os
from pathlib import Path
import stat
import sys
import time

sys.dont_write_bytecode = True


def require(value):
    if not value:
        raise RuntimeError('ONLINE_NATIVE_OWNERSHIP_UNPROVEN')


def run():
    require(sys.platform == 'linux' and len(sys.argv) > 1)
    directory = Path(__file__).resolve(strict=True).parent
    spec = importlib.util.spec_from_file_location('sabalan_online_scope', directory / 'online-runtime-scope.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    loaded = module.load_scope(os.environ)
    require(loaded is not None)
    scope = loaded['scope']
    # No caller descriptor/claim may replace ownership acquired here.
    require(not any(key.startswith(('BACKEND_CONTROL_', 'BACKEND_CAPTURE_', 'BACKEND_NATIVE_',
                                   'BACKEND_ONLINE_INTERLOCK_', 'BACKEND_ONLINE_WORKER_'))
                    for key in os.environ))
    acquired = []

    def lock(file, access, expected=None):
        require(os.path.realpath(file) == file)
        fd = os.open(file, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            current, named = os.fstat(fd), os.lstat(file)
            require(stat.S_ISREG(current.st_mode) and current.st_nlink == 1 and current.st_size == 0
                    and current.st_uid == os.getuid() and not current.st_mode & 0o022
                    and (current.st_dev, current.st_ino) == (named.st_dev, named.st_ino))
            if expected:
                require(str(current.st_dev) == expected['device'] and str(current.st_ino) == expected['inode'])
            fcntl.flock(fd, access | fcntl.LOCK_NB)
            # Keep all temporary descriptors above the entire target range.
            retained = fcntl.fcntl(fd, fcntl.F_DUPFD_CLOEXEC, 20)
            acquired.append(retained)
            return retained
        finally:
            os.close(fd)

    try:
        interlock = lock(scope['interlock']['file'], fcntl.LOCK_SH, scope['interlock'])
        worker = lock(scope['worker']['file'], fcntl.LOCK_EX, scope['worker']) if scope['worker'] else None
        private_file = scope['nativeDirectory'] + '/deployment-runtime-control.lock'
        private = lock(private_file, fcntl.LOCK_EX)
        admission = None
        descriptors = dict(interlock=interlock, worker=worker, private=private)
        if scope['format'] == 'sabalan-online-runtime-scope/v2':
            admission_spec = importlib.util.spec_from_file_location('sabalan_capture_admission', directory / 'online-capture-admission.py')
            admission_module = importlib.util.module_from_spec(admission_spec)
            admission_spec.loader.exec_module(admission_module)
            admission = admission_module.CaptureAdmission(loaded)
            state, _raw = admission.state()
            if scope['purpose'] in ['jobs', 'capture']:
                require(state['phase'] == 'OPEN')
            if scope['purpose'] == 'capture':
                # Refuse consumed/unknown native ownership before publishing a
                # pause. The guardian performs fresh SQL proof before any child.
                owner_spec = importlib.util.spec_from_file_location('sabalan_capture_prior_owner', directory / 'backend-runtime-owner.py')
                owner_module = importlib.util.module_from_spec(owner_spec)
                owner_spec.loader.exec_module(owner_module)
                owner_module.assert_closed(Path(scope['coordinationDirectory']), 'deployment-online-worker-native.json')
                require(set(os.listdir(scope['nativeDirectory'])) == {'deployment-runtime-control.lock'})
                admission.begin(descriptors)
        capture = None
        if scope['purpose'] == 'capture':
            deadline = time.monotonic() + 120
            while True:
                try:
                    capture = lock(scope['gate']['file'], fcntl.LOCK_EX, scope['gate'])
                    break
                except BlockingIOError:
                    # Only a v2 durable CLOSING owner may queue for this gate.
                    require(admission is not None and time.monotonic() < deadline)
                    admission.assert_owner(descriptors)
                    state, _raw = admission.state()
                    require(state['phase'] == 'CLOSING' and state['capture']['guardian'] == admission_module.birth())
                    time.sleep(0.01)
        require(module.load_scope(os.environ) == loaded)
        for source, target in [(private, 9), (interlock, 11)] + ([(worker, 12)] if worker else []) + ([(capture, 10)] if capture else []):
            os.dup2(source, target, inheritable=True)
        for fd in acquired:
            os.close(fd)
        acquired.clear()
        environment = dict(os.environ, BACKEND_CONTROL_LOCK_FD='9', BACKEND_CONTROL_LOCK_FILE=private_file,
                           BACKEND_ONLINE_INTERLOCK_FD='11')
        if worker:
            environment['BACKEND_ONLINE_WORKER_FD'] = '12'
        if capture:
            environment.update(BACKEND_CAPTURE_GATE_FD='10', BACKEND_CAPTURE_GATE_FILE=scope['gate']['file'],
                               BACKEND_CAPTURE_GATE_DEVICE=scope['gate']['device'],
                               BACKEND_CAPTURE_GATE_INODE=scope['gate']['inode'])
        os.execve('/usr/bin/python3', ['/usr/bin/python3', '-I', '-B', str(directory / 'backend-runtime-owner.py'), *sys.argv[1:]], environment)
    finally:
        for fd in acquired:
            os.close(fd)


if __name__ == '__main__':
    try:
        run()
    except Exception:
        print('ONLINE_NATIVE_OWNERSHIP_UNPROVEN', file=sys.stderr)
        sys.exit(75)
