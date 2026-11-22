#!/usr/bin/env python3
"""Read-only durable refusal boundary. Never adopt or retire a WAL owner."""
import json
import os
from pathlib import Path
import re
import stat


def require(value):
    if not value:raise RuntimeError('ORIGINAL_CONTINUOUS_WAL_RECOVERY_REQUIRED')


def validate_complete(value):
    require(isinstance(value,dict) and value.get('format')=='sabalan-original-continuous-wal-state/v1'
      and value.get('phase')=='COMPLETE' and value.get('finalIntervalCompletion') is True)
    require(re.fullmatch(r'[a-f0-9]{64}',value.get('captureId','')))
    terminal=value.get('terminal')
    require(isinstance(terminal,dict) and terminal.get('format')=='sabalan-original-terminal-wal-coverage/v1'
      and terminal.get('phase')=='COMPLETE' and terminal.get('finalIntervalCompletion') is True
      and terminal.get('ownedChildrenDomain')=='continuous-wal-producer' and terminal.get('allOriginalChildrenClosed') is True
      and terminal.get('captureId')==value['captureId'] and terminal.get('originalOwner')==value.get('originalOwner'))
    require(isinstance(terminal.get('windows'),list) and 0<len(terminal['windows'])<=4096
      and value.get('windowsCreated')==value.get('closedWindows')==len(terminal['windows']))
    for row in terminal['windows']:
        require(all(re.fullmatch(r'[a-f0-9]{64}',row.get(key,'')) for key in ['windowSha256','requestSha256','certificateSha256']))
    require(re.fullmatch(r'[a-f0-9]{64}',terminal.get('publicationSha256',''))
      and re.fullmatch(r'[a-f0-9]{64}',terminal.get('terminalEpochSha256','')))
    return value


def assert_prior_closed(coordination):
    root=Path(coordination);require(root.is_absolute() and root.resolve()==root)
    work=root/'online'/'work'
    if not os.path.lexists(work):return
    for directory in [root/'online',work]:
        s=directory.lstat();require(directory.resolve()==directory and stat.S_ISDIR(s.st_mode) and s.st_uid==os.getuid() and not s.st_mode&0o022)
    entries=list(work.iterdir());require(len(entries)<=4096)
    for directory in entries:
        require(re.fullmatch(r'[a-f0-9]{64}',directory.name))
        s=directory.lstat();require(stat.S_ISDIR(s.st_mode) and directory.resolve()==directory and s.st_uid==os.getuid() and not s.st_mode&0o022)
        file=directory/'continuous-wal-state.json'
        if not os.path.lexists(file):continue
        fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        try:
            before=os.fstat(fd);require(stat.S_ISREG(before.st_mode) and before.st_uid==os.getuid() and before.st_nlink==1 and before.st_mode&0o777==0o400 and 0<before.st_size<=4194304)
            raw=bytearray()
            while data:=os.read(fd,65536):raw.extend(data);require(len(raw)<=4194304)
            pin=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_uid,s.st_mode,s.st_nlink)
            require(len(raw)==before.st_size and pin(before)==pin(os.fstat(fd))==pin(file.lstat()))
            validate_complete(json.loads(raw))
        finally:os.close(fd)

if __name__=='__main__':
    assert_prior_closed(os.environ.get('RECOVERY_COORDINATION_DIR','/app/recovery-coordination'))
