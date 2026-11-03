"""Pack/exercise only new carrier startup tools; no container, service or app launch."""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys
import tarfile


def require(value, code):
    if not value:
        raise RuntimeError(code)


def pack(archive, expected_sha, index, destination):
    require(not Path(destination).exists(), 'PACK_ALREADY_EXISTS')
    with open(archive, 'rb') as stream:
        require(hashlib.file_digest(stream, 'sha256').hexdigest() == expected_sha, 'ARCHIVE_CHANGED')
    selected = {}
    with tarfile.open(archive) as outer:
        def blob(digest):
            raw = outer.extractfile('blobs/sha256/' + digest.split(':')[1]).read()
            require('sha256:' + hashlib.sha256(raw).hexdigest() == digest, 'OCI_BLOB_CHANGED')
            return raw
        descriptor = json.loads(blob(index))
        platforms = [r for r in descriptor['manifests'] if r.get('platform') == {'architecture': 'amd64', 'os': 'linux'}]
        require(len(platforms) == 1, 'PLATFORM_AMBIGUOUS')
        manifest = json.loads(blob(platforms[0]['digest']))
        for layer in manifest['layers']:
            with tarfile.open(fileobj=io.BytesIO(blob(layer['digest'])), mode='r|*') as inner:
                for member in inner:
                    name = member.name.removeprefix('./').rstrip('/')
                    wanted = name in ['lib', 'lib64', 'usr', 'usr/lib', 'usr/lib64', 'usr/local', 'usr/local/bin', 'usr/bin', 'etc', 'app',
                                      'usr/bin/python3', 'usr/bin/python3.11', 'usr/bin/sqlite3', 'usr/local/bin/node',
                                      'etc/ld.so.cache', 'etc/ld.so.conf', 'etc/nsswitch.conf',
                                      'app/local-inquiry-original.json', 'app/local-inquiry-preservation-carrier.cjs',
                                      'app/local-inquiry-preservation.py', 'app/verify-inquiry-database.cjs', 'app/inquiry-baseline.json']
                    wanted = wanted or name.startswith(('usr/lib/', 'usr/lib64/', 'lib/', 'lib64/', 'etc/ld.so.conf.d/'))
                    if not wanted:
                        continue
                    require(name and not name.startswith('/') and '..' not in PurePosixPath(name).parts,
                            'PACK_PATH_UNSAFE')
                    require(not PurePosixPath(name).name.startswith('.wh.'), 'PACK_WHITEOUT_UNSUPPORTED')
                    require(member.isfile() or member.isdir() or member.issym(), 'PACK_ENTRY_UNSUPPORTED')
                    body = inner.extractfile(member).read() if member.isfile() else b''
                    selected[name] = (member, body)
    with tarfile.open(destination, mode='x') as stream:
        for name, (member, body) in sorted(selected.items(), key=lambda row: (len(PurePosixPath(row[0]).parts), row[0])):
            stream.addfile(member, io.BytesIO(body) if member.isfile() else None)
    inventory = {name: dict(mode=m.mode, kind='file' if m.isfile() else 'directory' if m.isdir() else 'symlink',
                           sha256=hashlib.sha256(body).hexdigest() if m.isfile() else None,
                           target=m.linkname if m.issym() else None) for name, (m, body) in selected.items()}
    with open(destination, 'rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    return dict(format='sabalan-local-carrier-startup-tool-pack/v1', archiveSha256=expected_sha,
                index=index, file=destination, sha256=digest, bytes=Path(destination).stat().st_size,
                fileCount=len(inventory), inventorySha256=hashlib.sha256(json.dumps(inventory, sort_keys=True).encode()).hexdigest(),
                applicationStarted=False, productionAdmission=False)


canonical_fixture = r'''
import hashlib,json,re,sqlite3,subprocess
from pathlib import Path
baseline=json.loads(Path('/app/inquiry-baseline.json').read_bytes());file=Path('/qa/isolated.db')
database=sqlite3.connect(file)
try:
 database.executescript(';\n'.join(r['sql']for r in baseline['objects'])+';')
 database.execute('INSERT INTO Admin VALUES(?,?,?,?,?)',('fixture','fixture@example.invalid','fixture-only','fixture','fixture'));database.commit()
finally:database.close()
def invoke():
 value=subprocess.Popen(['/usr/local/bin/node','/app/verify-inquiry-database.cjs'],env={'PATH':'/usr/bin:/usr/local/bin','DATABASE_URL':'file:'+str(file)},stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 out,err=value.communicate();return value.returncode,out,err,value.pid
before=file.read_bytes();negative=invoke();assert negative[0]==1 and b'INQUIRY_DATABASE_ADMISSION_FAILED'in negative[2];assert file.read_bytes()==before
normalize=lambda rows:sorted([{**r,'sql':re.sub(r'\s*([(),])\s*',r'\1',re.sub(r'\s+',' ',r['sql']).strip().removesuffix(';'))}for r in rows],key=lambda r:r['type']+':'+r['name'])
schema=hashlib.sha256(json.dumps(normalize(baseline['objects']),separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
database=sqlite3.connect(file)
try:
 database.executescript(baseline['ledgerSql']);database.execute('INSERT INTO "_sabalan_inquiry_migrations" VALUES(?,?,?,?)',(baseline['id'],hashlib.sha256(baseline['ledgerSql'].encode()).hexdigest(),schema,'fixture'));database.commit()
finally:database.close()
before=file.read_bytes();positive=invoke();assert positive[0]==0 and positive[1]==b'INQUIRY_DATABASE_VERIFIED\n';assert file.read_bytes()==before
print(json.dumps({'missingLedgerRejected':True,'isolatedFixtureCanonicalVerified':True,'fixtureBytesUnchangedByVerifiers':True,'children':[{'pid':negative[3],'code':negative[0],'closed':True},{'pid':positive[3],'code':positive[0],'closed':True}]}))
'''

maintenance_fixture = r'''
const fs=require('node:fs'),assert=require('node:assert/strict');
const{serve,health}=require('/app/local-inquiry-preservation-carrier.cjs');
(async()=>{const identity=require('node:crypto').createHash('sha256').update(fs.readFileSync('/app/local-inquiry-original.json')).digest('hex');
const s=serve({port:0,host:'127.0.0.1',identity});await new Promise(r=>s.once('listening',r));const port=s.address().port;
try{await health(identity,port);for(const method of['GET','POST']){const r=await fetch('http://127.0.0.1:'+port+'/api/auth/login',{method});assert.equal(r.status,503);await r.text();}}
finally{await new Promise(r=>{s.close(r);s.closeAllConnections();});}
console.log(JSON.stringify({maintenanceReady:true,applicationReady:false,runtimeAccepted:false,applicationStarted:false,originalDatabaseOpened:false,listenerClosed:true,readersClosed:true}));})().catch(()=>{console.error('ARTIFACT_MAINTENANCE_FAILED');process.exitCode=1;});
'''


def exercise(pack_file, expected_sha, directory):
    directory = Path(directory)
    require(directory.is_absolute() and directory.parent.resolve(strict=True) == directory.parent
            and not os.path.lexists(directory), 'EXERCISE_DIRECTORY_UNSAFE')
    with open(pack_file, 'rb') as stream:
        require(hashlib.file_digest(stream, 'sha256').hexdigest() == expected_sha, 'PACK_CHANGED')
    require(os.access('/usr/sbin/chroot', os.X_OK), 'CHROOT_UNAVAILABLE')
    directory.mkdir(mode=0o700)
    with tarfile.open(pack_file) as stream:
        for member in stream:
            name = member.name.rstrip('/')
            require(name and not name.startswith('/') and '..' not in PurePosixPath(name).parts, 'EXTRACT_PATH_UNSAFE')
            file = directory / name
            for parent in file.parents:
                if parent == directory:
                    break
                require(not parent.is_symlink(), 'EXTRACT_SYMLINK_PARENT')
            file.parent.mkdir(parents=True, exist_ok=True)
            require(not os.path.lexists(file), 'EXTRACT_ENTRY_ALREADY_EXISTS')
            if member.isdir():
                file.mkdir(mode=member.mode)
            elif member.issym():
                os.symlink(member.linkname, file)
            else:
                require(member.isfile(), 'EXTRACT_ENTRY_UNSUPPORTED')
                with file.open('xb') as output:
                    incoming = stream.extractfile(member)
                    while part := incoming.read(1024 * 1024):
                        output.write(part)
                os.chmod(file, member.mode)
    (directory / 'qa').mkdir(mode=0o700)
    env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8'}
    children = []
    def child(args):
        actor = subprocess.Popen(['/usr/sbin/chroot', str(directory), *args], env=env,
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        out, err = actor.communicate()
        evidence = dict(pid=actor.pid, argv=args, code=actor.returncode, closed=True,
                        stdout=out.decode(), stderr=err.decode())
        children.append(evidence)
        require(actor.returncode == 0, 'ARTIFACT_EXECUTABLE_FAILED')
        return out.decode()
    try:
        version = child(['/usr/bin/sqlite3', '--version']).strip()
        engines = child(['/usr/bin/python3', '-I', '-B', '-c',
            "import hashlib,json,sqlite3,sys;print(json.dumps({'python':sys.version,'sqlite':sqlite3.sqlite_version,'sha256':hashlib.sha256(b'probe').hexdigest()}))"])
        canonical = child(['/usr/bin/python3', '-I', '-B', '-c', canonical_fixture])
        maintenance = child(['/usr/local/bin/node', '-e', maintenance_fixture])
        return dict(format='sabalan-local-inquiry-artifact-execution/v1', pass_=True, sqliteCliVersion=version,
                    engines=json.loads(engines), canonical=json.loads(canonical), maintenance=json.loads(maintenance),
                    children=children, directory=str(directory), sameExistingContainer=True,
                    secondContainerStarted=False, applicationStarted=False, productionAdmission=False)
    except Exception:
        print(json.dumps({'format': 'sabalan-local-inquiry-artifact-execution-failure/v1',
                          'pass_': False, 'children': children, 'directory': str(directory)}))
        raise


if __name__ == '__main__':
    if sys.argv[1] == 'pack':
        result = pack(*sys.argv[2:])
    elif sys.argv[1] == 'exercise':
        result = exercise(*sys.argv[2:])
    else:
        raise RuntimeError('UNKNOWN_COMMAND')
    print(json.dumps(result))
