"""One exclusive Inquiry grant via its existing candidate HTTP writer.
No key change, overwrite, cleanup or actor start. Old entries are preserved.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys


def require(value):
    if not value: raise RuntimeError('ORIGINAL_INQUIRY_PUBLICATION_REFUSED')


def snapshot(directory):
    require(directory.resolve(strict=True) == directory)
    value = directory.lstat(); require(stat.S_ISDIR(value.st_mode) and value.st_uid == 0 and not value.st_mode&0o022)
    rows = {}
    for file in sorted(directory.iterdir()):
        s = file.lstat(); require(s.st_uid == 0 and not s.st_mode&0o022 and not stat.S_ISLNK(s.st_mode))
        fields = ['st_dev','st_ino','st_mode','st_uid','st_nlink','st_size','st_mtime_ns','st_ctime_ns']
        identity = [str(getattr(s,k)) for k in fields]
        if stat.S_ISDIR(s.st_mode): rows[file.name] = dict(kind='directory',identity=identity)
        else:
            require(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and 0 < s.st_size <= 65536)
            fd = os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
            try:
                held = os.fstat(fd); raw = os.read(fd,65537)
                require(len(raw) == s.st_size and all(getattr(s,k) == getattr(held,k) == getattr(os.fstat(fd),k) == getattr(file.lstat(),k) for k in fields))
                rows[file.name] = dict(kind='file',identity=identity,sha256=hashlib.sha256(raw).hexdigest())
            finally: os.close(fd)
    require(len(rows) <= 4096)
    return rows


def publish(directory, request):
    require(set(request) == {'operation','grant','trustSha256','image'} and re.fullmatch(r'[a-f0-9]{32}',request['operation']))
    before = snapshot(directory)
    trust = directory/'qualification-controller-public-key.pem'
    require(trust.lstat().st_mode&0o777 == 0o444 and before[trust.name]['sha256'] == request['trustSha256'])
    grant = request['grant']; require(set(grant) == {'operation','name','rawBase64','sha256'} and grant['operation'] == request['operation'])
    require(re.fullmatch(r'[a-f0-9]{64}\.json',grant['name']) and grant['name'] not in before)
    raw = base64.b64decode(grant['rawBase64'],validate=True); require(0 < len(raw) <= 16384 and hashlib.sha256(raw).hexdigest() == grant['sha256'])
    scope = json.loads(raw); runtime = grant['name'][:-5]
    require(scope['format'] == 'sabalan-online-runtime-scope/v2' and scope['runtimeId'] == runtime and scope['image'] == request['image'])
    require(scope['releaseId'] == 'qa-complete-inquiry-'+request['operation'] and scope['purpose'] == 'http' and scope['role'] == 'serving' and scope['worker'] is None)
    root = '/app/recovery-coordination/complete-inquiry-'+request['operation']+'/coordination'
    require(scope['coordinationDirectory'] == root and scope['nativeDirectory'] == root+'/online/native/'+runtime and scope['boundaryDirectory'] == root+'/online/work/'+runtime)
    require((json.dumps(scope,sort_keys=True,separators=(',',':'))+'\n').encode('ascii') == raw)
    file = directory/grant['name']; fd = os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
    try:
        offset = 0
        while offset < len(raw):
            n = os.write(fd,raw[offset:]); require(n > 0); offset += n
        os.fsync(fd)
    finally: os.close(fd)
    fd = os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)
    after = snapshot(directory)
    require(set(after) == set(before)|{grant['name']} and all(after[k] == v for k,v in before.items()) and after[grant['name']]['sha256'] == grant['sha256'])
    return dict(published=True,sha256=grant['sha256'],originalTrustPreserved=True,originalEntriesPreserved=True,productionAdmission=False)


if __name__ == '__main__':
    require(sys.platform == 'linux' and os.getuid() == 0 and not sys.flags.optimize);os.umask(0o077)
    raw = sys.stdin.buffer.read(65537); require(0 < len(raw) <= 65536)
    print(json.dumps(publish(Path('/app/runtime-authority'),json.loads(raw)),separators=(',',':')))
