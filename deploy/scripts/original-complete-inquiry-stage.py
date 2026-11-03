"""Exclusive operation-local Inquiry material. No actor, DB write or authority
publication occurs here. Image/store/RO binding are independently guarded by the
original Windows adapter. Everything written is a private artifact dependency.
"""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys

HELPERS = ['original-complete-inquiry-owner.py', 'restored-inquiry-probe.py', 'original-restored-resource-observer.py',
           'online-inquiry-owner.py', 'backend-runtime-owner.py', 'online-runtime-scope.py', 'online-capture-admission.py',
           'inquiry-compiled-browser.cjs', 'inquiry-requested-stop.py']


def require(value):
    if not value: raise RuntimeError('ORIGINAL_COMPLETE_INQUIRY_STAGE_REFUSED')


def save(file, raw, mode=0o400):
    fd = os.open(file, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, mode)
    try:
        offset = 0
        while offset < len(raw):
            n = os.write(fd, raw[offset:]); require(n > 0); offset += n
        os.fsync(fd)
    finally: os.close(fd)
    require(file.read_bytes() == raw)


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'))+'\n').encode('ascii')


def private(directory):
    require(directory.resolve(strict=True) == directory)
    s = directory.lstat(); require(stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and not s.st_mode&0o077)
    return dict(device=str(s.st_dev), inode=str(s.st_ino), uid=s.st_uid, mode=s.st_mode)


def prepare(request):
    require(set(request) == {'operation', 'files', 'restored', 'selection', 'database', 'originalSqlite', 'imageFiles'})
    operation = request['operation']; require(re.fullmatch(r'[a-f0-9]{32}', operation))
    require(set(request['files']) == set(HELPERS))
    for name, row in request['files'].items():
        require(set(row) == {'rawBase64','sha256'} and re.fullmatch(r'[a-f0-9]{64}', row['sha256']))
        raw = base64.b64decode(row['rawBase64'], validate=True); require(0 < len(raw) <= 131072 and hashlib.sha256(raw).hexdigest() == row['sha256'])
    require(set(request['imageFiles']) == {'/app/verify-inquiry-database.cjs', '/app/inquiry-baseline.json', '/app/online-runtime/entry.cjs'})
    for name, digest in request['imageFiles'].items():
        require(re.fullmatch(r'[a-f0-9]{64}', digest) and hashlib.sha256(Path(name).read_bytes()).hexdigest() == digest)
    source = request['restored']; require(set(source) == {'rawBase64','size','sha256'})
    raw = base64.b64decode(source['rawBase64'], validate=True)
    require(type(source['size']) is int and 0 < source['size'] == len(raw) <= 64*1024**2 and hashlib.sha256(raw).hexdigest() == source['sha256'])
    parent = Path('/app/recovery-coordination'); s = parent.lstat()
    require(parent.resolve(strict=True) == parent and stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and not s.st_mode&0o022)
    space = os.statvfs(parent); require(space.f_bavail*space.f_frsize >= 3*len(raw)+512*1024**2)
    root = parent/('complete-inquiry-'+operation); root.mkdir(mode=0o700); original_root = private(root)
    helpers = root/'helpers'; helpers.mkdir(mode=0o700)
    for name, row in request['files'].items(): save(helpers/name, base64.b64decode(row['rawBase64'], validate=True))
    spec = importlib.util.spec_from_file_location('staged_original_probe', helpers/'restored-inquiry-probe.py'); probe = importlib.util.module_from_spec(spec); spec.loader.exec_module(probe)
    original = probe.sqlite_snapshot('/data/inquiry.db')
    wanted = request['originalSqlite']
    for here, there in [('device','dev'),('inode','ino'),('size','size'),('mode','mode'),('uid','uid'),('gid','gid'),('mtimeNs','mtimeNs'),('ctimeNs','ctimeNs')]: require(str(original[here]) == str(wanted[there]))
    require(original['sha256'] == wanted['sha256'] and original['sidecars'] == [])
    save(root/'restored-input.db', raw, 0o600); probe.verify_restored(root/'restored-input.db', source['sha256'])
    coordination = root/'coordination'; coordination.mkdir(mode=0o700)
    def directory(relative):
        target = coordination
        for name in relative.split('/'):
            target = target/name
            if not target.exists(): target.mkdir(mode=0o700)
            private(target)
        return target
    for name in ['online/native', 'online/work', 'online/admission/staging']: directory(name)
    def lock(name):
        file = coordination/name; save(file, b'', 0o600); s = file.lstat()
        return dict(file=str(file),device=str(s.st_dev),inode=str(s.st_ino),ownerUid=0)
    gate, interlock, worker = [lock(name) for name in ['deployment-write-admission.lock','deployment-runtime-control.lock','deployment-online-worker.lock']]
    db = request['database']; require(set(db) == {'name','oid','systemIdentifier'} and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,62}', db['name']) and re.fullmatch(r'[1-9][0-9]*',db['systemIdentifier']))
    definition = encode(dict(format='sabalan-online-admission-scope/v1',gate=gate,interlock=interlock,worker=worker,database=dict(name=db['name'],systemIdentifier=db['systemIdentifier'])))
    save(coordination/'online/admission/scope.json', definition)
    save(coordination/'online/admission/00000000.json', encode(dict(format='sabalan-online-capture-admission/v1',generation=0,phase='OPEN',previousSha256=None,capture=None,closureSha256=None)))
    runtime = os.urandom(32).hex(); native = directory('online/native/'+runtime); boundary = directory('online/work/'+runtime)
    save(native/'deployment-runtime-control.lock',b'',0o600)
    selection = request['selection']; image = selection['build']['image']; require(re.fullmatch(r'sha256:[a-f0-9]{64}', image) and re.fullmatch(r'[a-f0-9]{40}',selection['sourceCommit']))
    scope = dict(format='sabalan-online-runtime-scope/v2',runtimeId=runtime,releaseId='qa-complete-inquiry-'+operation,
                 manifestSha256=request['imageFiles']['/app/online-runtime/entry.cjs'],sourceCommit=selection['sourceCommit'],image=image,nonce=os.urandom(32).hex(),purpose='http',role='serving',coordinationDirectory=str(coordination),nativeDirectory=str(native),boundaryDirectory=str(boundary),gate=gate,interlock=interlock,worker=None,database=dict(name=db['name'],systemIdentifier=db['systemIdentifier']),admission=dict(directory=str(coordination/'online/admission'),scopeSha256=hashlib.sha256(definition).hexdigest()))
    scope_raw = encode(scope); digest = hashlib.sha256(scope_raw).hexdigest()
    namespace = dict(format='sabalan-runtime-namespace/v1',scope=dict(runtimeId=runtime,image=image,registrySha256=scope['manifestSha256'],generation=1,gate={k:gate[k] for k in ['device','inode','ownerUid']},postgresApplicationName='sabalan-rt-'+hashlib.sha256(runtime.encode()).hexdigest()[:48]))
    save(boundary/'scope.json', encode(namespace))
    environment = dict(BACKEND_RUNTIME_ROLE='serving', BACKEND_ONLINE_SCOPE_FILE='/run/sabalan-online/'+runtime+'.json',BACKEND_ONLINE_SCOPE_SHA256=digest,RECOVERY_COORDINATION_DIR=str(coordination))
    config = dict(operation=operation,restoredSha256=source['sha256'],originalDatabase=original,scopeEnvironment=environment,selection=selection,helperPins={name:r['sha256'] for name,r in request['files'].items()})
    config_raw = encode(config); save(root/'owner-config.json',config_raw)
    grant = dict(operation=operation,name=runtime+'.json',rawBase64=base64.b64encode(scope_raw).decode(),sha256=digest)
    save(root/'grant.json', encode(grant)); require(probe.sqlite_snapshot('/data/inquiry.db') == original and private(root) == original_root)
    fd = os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)
    return dict(root=str(root),configSha256=hashlib.sha256(config_raw).hexdigest(),grant=grant,originalDatabase=original,productionAdmission=False)


if __name__ == '__main__':
    require(sys.platform == 'linux' and os.getuid() == 0 and not sys.flags.optimize)
    os.umask(0o077)
    raw = sys.stdin.buffer.read(100*1024**2+1); require(0 < len(raw) <= 100*1024**2)
    print(json.dumps(prepare(json.loads(raw)),separators=(',',':')))
