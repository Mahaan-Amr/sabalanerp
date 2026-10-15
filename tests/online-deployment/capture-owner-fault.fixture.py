"""Fault injection only: no Docker daemon or database is contacted."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import patch

root, binary, fault = sys.argv[1:]
root = Path(root)
source = Path(__file__).resolve().parents[2] / 'deploy/scripts/capture-postgres-base.py'
spec = importlib.util.spec_from_file_location('capture', source)
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)
original_open, original_read, original_popen = Path.open, Path.read_text, subprocess.Popen
spawned = False
image = 'sha256:' + 'a' * 64
container = {'Id': 'b' * 64, 'Image': image, 'Config': {'Labels': {
    'com.docker.compose.project': 'sabalanerp-backup-drill', 'com.docker.compose.service': 'postgres'}},
    'State': {'Running': True, 'Health': {'Status': 'healthy'}}}


def spawn(command, **kwargs):
    global spawned
    token = command[6]
    child = original_popen([binary, '1', token, 'sh', '-c', 'sleep .2'], **kwargs)
    (root / 'native-pid').write_text(str(child.pid))
    spawned = True
    return child


class BrokenLog:
    def __init__(self, stream): self.stream = stream
    def __enter__(self): return self
    def __exit__(self, *args): self.stream.close()
    def __getattr__(self, name): return getattr(self.stream, name)
    def write(self, _value): raise OSError(5, 'injected native log write')


def open_file(path, *args, **kwargs):
    if spawned and fault == 'log-open' and path.name in ['native-1.log', 'capture.jsonl']:
        raise OSError(5, 'injected local filesystem failure')
    value = original_open(path, *args, **kwargs)
    return BrokenLog(value) if spawned and fault == 'log-write' and path.name == 'native-1.log' else value


def read_file(path, *args, **kwargs):
    if spawned and fault == 'ownership-read' and str(path) == '/proc/self/fdinfo/9':
        raise OSError(5, 'injected ownership filesystem failure')
    return original_read(path, *args, **kwargs)


with patch.object(subprocess, 'check_output', return_value=json.dumps([container]).encode()), \
     patch.object(subprocess, 'run'), patch.object(subprocess, 'Popen', side_effect=spawn), \
     patch.object(Path, 'open', open_file), patch.object(Path, 'read_text', read_file):
    capture.capture(SimpleNamespace(project='sabalanerp-backup-drill', operation_id='fault-test-operation',
        image=image, system_identifier='123', container='owned-fixture', root=str(root),
        lock_file=str(root / 'owner.lock'), supervisor=binary,
        supervisor_sha256=capture.digest(Path(binary))))
