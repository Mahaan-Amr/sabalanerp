"""Original candidate installed bytes only; never imports application or SQL."""
import hashlib,json,os,stat,sys
from pathlib import Path
request=json.load(sys.stdin)
assert set(request)=={'root'}
root=Path(request['root']);assert root.resolve(strict=True)==root
config=json.loads((root/'config.json').read_bytes())
sha=lambda value:hashlib.sha256(value).hexdigest()
def inventory(directory):
    assert directory.resolve(strict=True) == directory
    entries = []
    for current, folders, files in os.walk(directory, followlinks=False):
        for folder in folders:
            assert not (Path(current) / folder).is_symlink()
        for name in files:
            file = Path(current) / name
            descriptor = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                before = os.fstat(descriptor)
                assert stat.S_ISREG(before.st_mode) and before.st_nlink == 1
                digest = hashlib.sha256()
                with os.fdopen(os.dup(descriptor), 'rb') as stream:
                    while chunk := stream.read(262144):
                        digest.update(chunk)
                for observed in [os.fstat(descriptor), file.lstat()]:
                    assert all(getattr(observed, key) == getattr(before, key) for key in
                               ['st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'])
                entries.append(dict(bytes=before.st_size, path=file.relative_to(directory).as_posix(), sha256=digest.hexdigest()))
                assert len(entries) <= 32768
            finally:
                os.close(descriptor)
    entries.sort(key=lambda item: item['path'])
    assert entries
    return sha(json.dumps(entries, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf8'))

runtime=config['privateQualificationRuntimes']['candidate']
assert runtime['entryPath']=='/app/dist/onlinePrivateQualification.js'
assert sha(Path(runtime['entryPath']).read_bytes())==runtime['entrySha256']
assert inventory(Path('/app/dist'))==runtime['distTreeSha256']
assert inventory(Path('/app/node_modules/@prisma/client'))==runtime['clientInventorySha256']
assert sha(Path('/app/prisma/schema.prisma').read_bytes())==runtime['schemaSha256']
print(json.dumps(runtime))
