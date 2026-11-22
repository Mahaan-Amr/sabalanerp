"""Actual FD collision and controller-death regression; no Docker/SQL mutations."""
import ast
import ctypes
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import sys
import time


def check(value, code):
    if not value:
        raise RuntimeError(code)


def main():
    root, source = map(Path, sys.argv[1:])
    check(root.parent == Path('/app/online-runtime-acceptance')
          and re.fullmatch(r'host-lock-inheritance-[a-f0-9]{32}', root.name), 'PRIVATE_TEST_ROOT_REQUIRED')
    root.mkdir(mode=0o700)
    text = source.read_text()
    tree = ast.parse(text)
    helper = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'inherit_ownership')
    exec(compile(ast.Module(body=[helper], type_ignores=[]), str(source), 'exec'), globals())
    check(ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0, 'SUBREAPER_REQUIRED')
    controller = os.fork()
    if controller == 0:
        for fd in range(3, 64):
            try:
                os.close(fd)
            except OSError:
                pass
        check([os.open('/dev/null', os.O_RDONLY) for _ in range(3)] == [3, 4, 5], 'COLLISION_LAYOUT_REQUIRED')
        locks = [os.open(root / name, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600) for name in ['drill.lock', 'storage.lock']]
        check(locks == [6, 7], 'COLLISION_LAYOUT_REQUIRED')
        for fd in locks:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        # Reproduce the original defect on real open descriptions first.
        broken = [os.dup(fd) for fd in locks]
        check(broken == [8, 9], 'ORIGINAL_COLLISION_NOT_REPRODUCED')
        os.dup2(broken[0], 9)
        os.dup2(broken[1], 10)
        check(os.fstat(9).st_ino == os.fstat(10).st_ino == os.fstat(6).st_ino
              and os.fstat(10).st_ino != os.fstat(7).st_ino, 'ORIGINAL_COLLISION_NOT_REPRODUCED')
        for fd in (8, 9, 10):
            os.close(fd)
        inherit_ownership(locks)
        worker = os.fork()
        if worker == 0:
            for fd in range(3, 9):
                try:
                    os.close(fd)
                except OSError:
                    pass
            # Only the final inherited FDs survive. The controller's original
            # descriptors cannot mask an accidentally duplicated first lock.
            (root / 'ready.pending').write_text(json.dumps(dict(controller=controller or os.getppid(), worker=os.getpid())))
            os.rename(root / 'ready.pending', root / 'ready.json')
            deadline = time.monotonic() + 15
            while not (root / 'release').exists():
                check(time.monotonic() < deadline, 'CONTROLLER_DID_NOT_RELEASE_TEST')
                time.sleep(0.01)
            os._exit(0)
        while True:
            signal.pause()
    deadline = time.monotonic() + 10
    while not (root / 'ready.json').exists():
        check(time.monotonic() < deadline, 'NATIVE_WORKER_NOT_READY')
        time.sleep(0.01)
    ready = json.loads((root / 'ready.json').read_text())
    check(ready['controller'] == controller, 'CONTROLLER_IDENTITY_CHANGED')
    controller_fd = os.pidfd_open(controller)
    signal.pidfd_send_signal(controller_fd, signal.SIGKILL)
    check(os.waitpid(controller, 0)[1] == signal.SIGKILL, 'CONTROLLER_DEATH_UNPROVEN')
    os.close(controller_fd)
    probes = [os.open(root / name, os.O_RDWR) for name in ['drill.lock', 'storage.lock']]
    for fd in probes:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            pass
        else:
            raise AssertionError('Host ownership escaped after controller death')
    (root / 'release').touch(mode=0o400)
    check(os.waitpid(ready['worker'], 0)[1] == 0, 'NATIVE_WORKER_NOT_REAPED')
    for fd in probes:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        os.close(fd)
    print(json.dumps(dict(pass_=True, originalCollisionReproduced=True, distinctLocksRetainedAfterControllerDeath=True,
                         controllerReaped=True, nativeWorkerReaped=True,
                         sourceSha256=hashlib.sha256(text.encode()).hexdigest(), workingRoot=str(root))))


if __name__ == '__main__':
    main()
