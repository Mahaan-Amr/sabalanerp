"""Read-only conservation of existing authority entries. No removal/adoption.
The stage/retirement original supplies only its own fresh job name to exclude.
"""
import os, stat, hashlib, json, re

def preserved_authority_snapshot(base, exclude=None):
    result = {}
    def stamp(s):
        return [str(getattr(s,k)) for k in ('st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns')]
    def visit(p):
        before=p.lstat(); relative=p.relative_to(base).as_posix()
        assert p.resolve(strict=True)==p and before.st_uid==0 and not before.st_mode&0o022
        assert before.st_dev==base.lstat().st_dev
        if stat.S_ISDIR(before.st_mode):
            result[relative]={'kind':'directory','identity':[str(before.st_dev),str(before.st_ino)],'mode':before.st_mode,'uid':before.st_uid,'gid':before.st_gid}
            names=sorted(os.listdir(p))
            for name in names:visit(p/name)
            after=p.lstat();assert names==sorted(os.listdir(p)) and stamp(before)==stamp(after)
        else:
            assert stat.S_ISREG(before.st_mode) and before.st_nlink==1
            fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
            try:
                assert stamp(os.fstat(fd))==stamp(before)
                h=hashlib.sha256();count=0
                while raw:=os.read(fd,262144):count+=len(raw);assert count<=before.st_size;h.update(raw)
                assert count==before.st_size and stamp(before)==stamp(os.fstat(fd))==stamp(p.lstat())
                result[relative]={'kind':'file','identity':stamp(before),'sha256':h.hexdigest()}
            finally:os.close(fd)
        assert len(result)<=100000
    original=base.lstat();assert base.resolve(strict=True)==base and stat.S_ISDIR(original.st_mode) and original.st_uid==0 and not original.st_mode&0o022
    names=sorted(os.listdir(base)); excluded={exclude} if isinstance(exclude,str) else set(exclude or [])
    for name in names:
        if name not in excluded:visit(base/name)
    assert sorted(os.listdir(base))==names and stamp(original)==stamp(base.lstat())
    return {'format':'sabalan-existing-authority-conservation/v1','baseIdentity':[str(original.st_dev),str(original.st_ino)],'entries':result}

def write_preserved_authority(root,value):
    raw=(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode();assert 0<len(raw)<=8*1024**2
    file=root/'existing-authority-snapshot.json';fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
    try:
        offset=0
        while offset<len(raw):n=os.write(fd,raw[offset:]);assert n>0;offset+=n
        os.fsync(fd)
    finally:os.close(fd)
    return {'format':'sabalan-existing-authority-snapshot-reference/v1','file':str(file),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}

def read_preserved_authority(root,reference):
    assert set(reference)=={'format','file','bytes','sha256'} and reference['format']=='sabalan-existing-authority-snapshot-reference/v1'
    file=root/'existing-authority-snapshot.json';assert reference['file']==str(file) and file.resolve(strict=True)==file
    before=file.lstat();assert stat.S_ISREG(before.st_mode) and before.st_uid==0 and before.st_nlink==1 and before.st_mode&0o777==0o400 and before.st_size==reference['bytes'] and 0<before.st_size<=8*1024**2
    fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        fields=lambda s:tuple(getattr(s,k)for k in ('st_dev','st_ino','st_mode','st_uid','st_nlink','st_size','st_mtime_ns','st_ctime_ns'))
        assert fields(os.fstat(fd))==fields(before);parts=[];count=0
        while raw:=os.read(fd,262144):count+=len(raw);assert count<=before.st_size;parts.append(raw)
        raw=b''.join(parts);assert count==before.st_size and hashlib.sha256(raw).hexdigest()==reference['sha256'] and fields(before)==fields(os.fstat(fd))==fields(file.lstat())
        return json.loads(raw)
    finally:os.close(fd)

def assert_preserved_authority(base, expected, owned_name, grant=None):
    assert expected['format']=='sabalan-existing-authority-conservation/v1'
    assert owned_name.startswith('application-native-') and len(owned_name)==51
    excluded={owned_name}
    if grant is not None:
        assert set(grant)=={'name','sha256','bytes','device','inode'} and re.fullmatch(r'[a-f0-9]{64}\.json',grant['name']) and grant['name']not in expected['entries']
        file=base/grant['name'];s=file.lstat();assert file.resolve(strict=True)==file and stat.S_ISREG(s.st_mode) and s.st_mode&0o777==0o400 and s.st_uid==0 and s.st_nlink==1 and str(s.st_dev)==grant['device'] and str(s.st_ino)==grant['inode'] and s.st_size==grant['bytes'] and 0<s.st_size<=16384
        fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        try:
            raw=os.read(fd,16385);key=lambda v:[str(getattr(v,k))for k in ('st_dev','st_ino','st_mode','st_uid','st_nlink','st_size','st_mtime_ns','st_ctime_ns')]
            assert len(raw)==s.st_size and hashlib.sha256(raw).hexdigest()==grant['sha256'] and key(s)==key(os.fstat(fd))==key(file.lstat())
            scope=json.loads(raw);assert scope['format']=='sabalan-online-runtime-scope/v2' and scope['runtimeId']+'.json'==grant['name'] and scope['releaseId']=='qa-complete-inquiry-'+owned_name[19:] and scope['purpose']=='http' and scope['role']=='serving' and scope['worker']is None
            assert (json.dumps(scope,sort_keys=True,separators=(',',':'))+'\n').encode('ascii')==raw
        finally:os.close(fd)
        excluded.add(grant['name'])
    assert preserved_authority_snapshot(base,excluded)==expected
