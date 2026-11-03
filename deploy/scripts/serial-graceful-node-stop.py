"""Signal only the exact shell-owned application through a fresh kernel pidfd.

The existing ticket08 owner suppresses restart first, retains Docker wait/stop,
and observes the container's actual ordinary exit before restoring policy.
"""
import hashlib
import json
import os
from pathlib import Path
import signal
import sys

assert os.getuid() == 0
assert sys.argv[1:] in (['--inspect-only'], ['--signal-owned-node'])
assert hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal')
root = Path('/proc')
assert (root / '1/comm').read_text().strip() in ('sh', 'dash', 'ash')
matches = []
for entry in root.iterdir():
    if not entry.name.isdigit():
        continue
    try:
        raw = (entry / 'cmdline').read_bytes()
        args = raw.rstrip(b'\0').split(b'\0')
        if args not in ([b'node', b'dist/index.js'], [b'/usr/local/bin/node', b'dist/index.js']):
            continue
        status = (entry / 'status').read_text().splitlines()
        fields = dict(line.split(':', 1) for line in status if ':' in line)
        if fields['PPid'].strip() != '1':
            continue
        assert int(fields['SigCgt'].strip(), 16) & (1 << (signal.SIGTERM - 1))
        # Open a kernel identity, then verify the same proc incarnation again.
        before = (entry / 'stat').read_text()
        pidfd = os.pidfd_open(int(entry.name), 0)
        try:
            assert (entry / 'stat').read_text().split(') ', 1)[1].split()[19] == before.split(') ', 1)[1].split()[19]
            assert (entry / 'cmdline').read_bytes() == raw
            matches.append((pidfd, entry.name, hashlib.sha256(raw).hexdigest()))
        except BaseException:
            os.close(pidfd)
            raise
    except FileNotFoundError:
        continue
assert len(matches) == 1, 'ONE_ORIGINAL_SHELL_OWNED_APPLICATION_REQUIRED'
pidfd, pid, argv_sha = matches[0]
try:
    requested = sys.argv[1:] == ['--signal-owned-node']
    if requested:
        signal.pidfd_send_signal(pidfd, signal.SIGTERM)
    print(json.dumps(dict(applicationPid=int(pid), argvSha256=argv_sha, signal='SIGTERM' if requested else None, kernelPidfd=True)), flush=True)
finally:
    os.close(pidfd)
