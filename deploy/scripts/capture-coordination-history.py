#!/usr/bin/env python3
"""Bounded historical coordination inventory. Never runtime admission material."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat

DURABLE = {'state.json', 'pending-restore.json', 'sanitized-environment.json',
           'restart-inquiry', 'inquiry-stopped', 'deployment-checkpoint.json',
           'deployment-report.json', 'deployment-maintenance.json'}
DIRECTORIES = {'biometric-configuration': 'CONFIGURATION_RECOVERY',
               'online': 'RUNTIME_CUSTODY_ONLY'}
CUSTODY = {'deployment-bootstrap-native.json', 'deployment-file-adoption-native.json',
           'deployment-online-worker-native.json', 'deployment-online-worker.lock',
           'deployment-runtime-control.lock', 'deployment-runtime-native.json',
           'deployment-write-admission.lock'}

def classification(relative, source_root=None):
    parts = Path(relative).parts
    if not parts or any(p in ('', '.', '..') for p in parts):
        raise RuntimeError('COORDINATION_PATH_INVALID')
    if parts[0] == 'private-qualifications':
        # Only the original local isolated qualification app is recognised.
        # Archive every declared descendant, including live business/config
        # bytes beside separately covered version stores; never restore it as
        # admission state or silently omit an unreviewed sibling.
        if not isinstance(source_root, str) or not re.fullmatch(
                r'/app/online-runtime-acceptance/application-native-[a-f0-9]{32}/restored-coordination', source_root):
            raise RuntimeError('COORDINATION_LOCAL_QUALIFICATION_SOURCE_INVALID')
        if len(parts) > 1 and not re.fullmatch(r'[a-f0-9]{64}', parts[1]):
            raise RuntimeError('COORDINATION_LOCAL_QUALIFICATION_ID_INVALID')
        if len(parts) > 2 and parts[2] != 'restored-app':
            raise RuntimeError('COORDINATION_PATH_UNCLASSIFIED')
        return 'LOCAL_QUALIFICATION_HISTORY'
    if parts[0] in DIRECTORIES:
        if parts[0] == 'online' and len(parts) > 1 and parts[1] not in ('native', 'work', 'admission'):
            raise RuntimeError('COORDINATION_PATH_UNCLASSIFIED')
        return DIRECTORIES[parts[0]]
    if len(parts) == 1 and parts[0] in DURABLE: return 'DURABLE_RECOVERY'
    if len(parts) == 1 and parts[0] in CUSTODY:
        return 'RUNTIME_CUSTODY_ONLY'
    raise RuntimeError('COORDINATION_PATH_UNCLASSIFIED')

def stable(value):
    return tuple(getattr(value, key) for key in ('st_dev','st_ino','st_mode','st_uid','st_nlink','st_size','st_mtime_ns','st_ctime_ns'))

def capture(work, capture_id, scope, assert_frozen, exclusions=()):
    assert_frozen()
    gate = os.fstat(10)
    if not stat.S_ISREG(gate.st_mode) or not any(re.fullmatch(
            r'lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:' + str(gate.st_ino) + r'\s+0\s+EOF\s*', line)
            for line in Path('/proc/self/fdinfo/10').read_text().splitlines()):
        raise RuntimeError('COORDINATION_ORIGINAL_EX_REQUIRED')
    root = Path(scope['coordinationDirectory'])
    if root.resolve(strict=True) != root or not re.fullmatch(r'[a-f0-9]{64}', capture_id):
        raise RuntimeError('COORDINATION_SOURCE_INVALID')
    root_stat = root.lstat(); excluded = {}; entries = []; identities = {}; total = 0
    for row in Path('/proc/self/mountinfo').read_text().splitlines():
        mounted = Path(re.sub(r'\\([0-7]{3})',lambda match:chr(int(match[1],8)),row.split()[4]))
        if mounted != root and mounted.is_relative_to(root):
            raise RuntimeError('COORDINATION_NESTED_MOUNT')
    for item in exclusions:
        target = Path(item['path'])
        if target == root or not target.is_relative_to(root) or target.resolve(strict=True) != target:
            raise RuntimeError('COORDINATION_EXCLUSION_INVALID')
        if str(target) in excluded: raise RuntimeError('COORDINATION_EXCLUSION_DUPLICATE')
        excluded[str(target)] = item
    def walk(directory):
        nonlocal total
        before = directory.lstat()
        if not stat.S_ISDIR(before.st_mode) or before.st_dev != root_stat.st_dev or before.st_uid != os.getuid() or before.st_mode & 0o022:
            raise RuntimeError('COORDINATION_DIRECTORY_UNSAFE')
        names = sorted(os.listdir(directory)); identities[str(directory)] = stable(before)
        for name in names:
            file = directory/name; relative = file.relative_to(root).as_posix(); st = file.lstat()
            if file.resolve(strict=True) != file or st.st_dev != root_stat.st_dev:
                raise RuntimeError('COORDINATION_ALIAS_OR_MOUNT')
            if str(file) in excluded:
                if not stat.S_ISDIR(st.st_mode): raise RuntimeError('COORDINATION_EXCLUSION_NOT_DIRECTORY')
                entries.append(dict(path=relative,kind='EXCLUDED_SUBTREE',coverage=excluded[str(file)]['coverage'],device=str(st.st_dev),inode=str(st.st_ino)))
                identities[str(file)] = stable(st)
                continue
            # Only exact ancestors of declared covered subtrees may contain
            # exclusions; siblings still undergo their own strict classifier.
            kind = ('COVERED_SUBTREE_CONTAINER' if stat.S_ISDIR(st.st_mode)
                    and any(Path(target).is_relative_to(file) for target in excluded)
                    else classification(relative, source_root=str(root)))
            if stat.S_ISDIR(st.st_mode):
                entries.append(dict(path=relative,kind='DIRECTORY',classification=kind)); walk(file)
            else:
                if not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid() or st.st_nlink != 1 or st.st_mode & 0o022 or st.st_size > 8*1024*1024:
                    raise RuntimeError('COORDINATION_FILE_UNSAFE')
                fd = os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
                try:
                    if stable(os.fstat(fd)) != stable(st): raise RuntimeError('COORDINATION_SOURCE_CHANGED')
                    chunks=[]
                    while chunk:=os.read(fd,262144):
                        total += len(chunk)
                        if total > 32*1024*1024: raise RuntimeError('COORDINATION_BUDGET_EXCEEDED')
                        chunks.append(chunk)
                    raw=b''.join(chunks)
                    if stable(os.fstat(fd)) != stable(st) or stable(file.lstat()) != stable(st): raise RuntimeError('COORDINATION_SOURCE_CHANGED')
                finally: os.close(fd)
                identities[str(file)] = stable(st)
                entries.append(dict(path=relative,kind='FILE',classification=kind,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),rawBase64=base64.b64encode(raw).decode()))
            if len(entries)>10000: raise RuntimeError('COORDINATION_ENTRY_BUDGET_EXCEEDED')
        if names != sorted(os.listdir(directory)) or stable(directory.lstat()) != stable(before): raise RuntimeError('COORDINATION_SOURCE_CHANGED')
    walk(root)
    if set(excluded) != {str(root/item['path']) for item in entries if item['kind']=='EXCLUDED_SUBTREE'}:
        raise RuntimeError('COORDINATION_EXCLUSION_UNOBSERVED')
    assert_frozen()
    if any(stable(Path(file).lstat()) != expected for file,expected in identities.items()): raise RuntimeError('COORDINATION_SOURCE_CHANGED')
    result=dict(format='sabalan-coordination-history/v1',captureId=capture_id,
        source=dict(path=str(root),device=str(root_stat.st_dev),inode=str(root_stat.st_ino)),
        gate=dict(device=str(gate.st_dev),inode=str(gate.st_ino)),entries=entries,
        archivalOnly=True,runtimeAdmission=False,restorePolicy='READ_ONLY_HISTORY_OUTSIDE_NEW_COORDINATION')
    raw=(json.dumps(result,sort_keys=True,separators=(',',':'))+'\n').encode()
    target=Path(work)/'coordination-history.json'
    fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
    try:
        with os.fdopen(fd,'wb',closefd=False) as stream: stream.write(raw);stream.flush();os.fsync(fd)
    finally:os.close(fd)
    directory=os.open(work,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(directory)
    finally:os.close(directory)
    assert_frozen()
    return dict(file=target.name,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
