"""Native UID70 execution under restrictive umask, without a second service."""
import ast
import errno
import hashlib
import os
from pathlib import Path
import re
import sys


def check(value, code):
    if not value:
        raise RuntimeError(code)


def main():
    check(os.getuid() == 0 and os.execve in os.supports_fd, 'NATIVE_ROOT_FEXECVE_REQUIRED')
    root = Path(sys.argv[1])
    source = Path(sys.argv[2]).read_bytes()
    check(root.parent == Path('/app/online-runtime-acceptance')
          and re.fullmatch(r'coherent-file-modes-[a-f0-9]{32}', root.name), 'PRIVATE_FIXTURE_REQUIRED')
    os.umask(0o077)
    root.mkdir(mode=0o700)
    tree = ast.parse(source)
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in ['sync', 'write']]
    check(len(functions) == 2, 'ACTUAL_SOURCE_REQUIRED')
    exec(compile(ast.Module(body=functions, type_ignores=[]), 'independent-coherent-component.fixture.py', 'exec'), globals())
    binary = Path('/usr/bin/true').read_bytes()
    old = root / 'old-mode'
    fd = os.open(old, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o555)
    # An accidental successful execution must return nonzero, distinguishable
    # from the expected EACCES path below.
    os.write(fd, Path('/usr/bin/false').read_bytes())
    os.close(fd)
    check(old.stat().st_mode & 0o777 == 0o500, 'ORIGINAL_PERMISSION_FAILURE_NOT_REPRODUCED')
    write(root / 'correct-mode', binary, 0o555)
    write(root / 'script.sh', b'#!/bin/sh\nexit 0\n', 0o444)
    check((root / 'correct-mode').stat().st_mode & 0o777 == 0o555
          and (root / 'script.sh').stat().st_mode & 0o777 == 0o444, 'EXPLICIT_MODE_NOT_PRESERVED')
    for file, expect_denied in [(old, True), (root / 'correct-mode', False)]:
        descriptor = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
        child = os.fork()
        if child == 0:
            os.setgid(70)
            os.setuid(70)
            try:
                # An FD-backed executable has the same permission check as the
                # confined bind mount, without exposing its private parent.
                os.execve(descriptor, [str(file)], {'PATH': '/usr/bin:/bin'})
            except OSError as error:
                os._exit(0 if expect_denied and error.errno == errno.EACCES else 41)
        check(os.waitpid(child, 0)[1] == 0, 'NATIVE_UID70_EXECUTION_FAILED')
        os.close(descriptor)
    import json
    print(json.dumps(dict(pass_=True, originalUmaskFailureReproduced=True, explicitModesPreserved=True,
                         nativeUid70ExecuteVerified=True, nativeChildrenReaped=True,
                         sourceSha256=hashlib.sha256(source).hexdigest(), workingRoot=str(root))))


if __name__ == '__main__':
    main()
