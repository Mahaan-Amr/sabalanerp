"""Retire exactly two completed export scratch files after retained local OCI verification."""
import base64, errno, hashlib, json, os, re, signal, stat, subprocess, sys
from pathlib import Path

LOCK=Path('/opt/sabalanerp/.deploy-state/deployment.lock')
PROTECTED=[Path(p) for p in ['/opt/sabalanerp/.deploy-state','/root/sabalan-recovery-private','/srv/sabalanerp-recovery/checkpoints','/mnt/sabalanerp-independent-recovery']]
IDENTITY_FIELDS=('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_mode','st_nlink','st_uid')
def identity(value):return tuple(getattr(value,key)for key in IDENTITY_FIELDS)
def digest(raw):return hashlib.sha256(raw).hexdigest()
def validate_spec(spec):
    assert spec['format']=='sabalan-original-export-scratch-retirement-spec/v1' and spec['productionAdmission']is False
    match=re.fullmatch(r'actual-(frontend|inquiry)-image-export-([a-f0-9]{32})',spec['operation']);assert match and spec['service']==match[1]
    root='/root/'+spec['operation'];assert spec['root']==root
    assert [v['path']for v in spec['files']]==[root+'/'+spec['service']+'.docker.tar',root+'/'+spec['service']+'.docker.tar.gz']
    for value in spec['files']:
        assert re.fullmatch('[a-f0-9]{64}',value['sha256']) and type(value['bytes'])is int and 1024<value['bytes']<2*1024**3
        assert all(re.fullmatch('[1-9][0-9]{0,24}',value[key])for key in ['device','inode'])
    for key in ['exportReceiptSha256','exportSourceSha256','baselineSha256']:assert re.fullmatch('[a-f0-9]{64}',spec[key])
    assert re.fullmatch('[a-f0-9]{40}',spec['deployedHead'])
    assert sorted(spec['services'])==['backend','clamav','frontend','inquiry','nginx','postgres']
    for key in ['machineUuidSha256','kernelBootIdSha256']:assert re.fullmatch('[a-f0-9]{64}',spec['sourceHost'][key])
    graph=spec['localPreservation']['graph'];assert graph['index']==spec['services'][spec['service']]['image']
    assert graph['archiveSha256']==spec['files'][0]['sha256']and graph['archiveBytes']==spec['files'][0]['bytes']
    gzip=spec['localPreservation']['gzip'];assert gzip['sha256']==spec['files'][1]['sha256']and gzip['bytes']==spec['files'][1]['bytes']
    assert gzip['uncompressedSha256']==graph['archiveSha256']and gzip['uncompressedBytes']==graph['archiveBytes']
    return Path(root)

def main(spec):
    root=validate_spec(spec);assert sys.platform=='linux'and os.getuid()==0 and not sys.flags.optimize
    import fcntl
    os.umask(0o077);os.chdir('/opt/sabalanerp')
    for key in ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']:os.environ.pop(key,None)
    children=[];commands=[];held=[];lock_fd=None;root_fd=None;interrupted=False;deleted=[];intent=None;intent_hash=None
    report=dict(format='sabalan-original-export-scratch-retirement/v1',operation=spec['operation'],passResult=False,productionAdmission=False,deleted=deleted)
    def cancellation(*_):
        nonlocal interrupted
        interrupted=True
    for number in [signal.SIGINT,signal.SIGTERM,signal.SIGHUP]:signal.signal(number,cancellation)
    def host():
        assert Path('/proc/1/ns/mnt').stat().st_ino==Path('/proc/self/ns/mnt').stat().st_ino,'REAL_HOST_MOUNT_NAMESPACE_REQUIRED'
        actual=[digest(Path(p).read_text().strip().lower().encode())for p in ['/sys/class/dmi/id/product_uuid','/proc/sys/kernel/random/boot_id']]
        assert actual==[spec['sourceHost']['machineUuidSha256'],spec['sourceHost']['kernelBootIdSha256']],'SOURCE_HOST_CHANGED'
    def lock_guard():
        assert not interrupted,'OWNER_INTERRUPTED';host();assert identity(os.fstat(9))==identity(LOCK.lstat())==lock_identity,'FD9_CHANGED'
        info=Path('/proc/self/fdinfo/9').read_text();assert re.search(r'^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+'+str(os.getpid())+r'\s+[0-9a-f]+:[0-9a-f]+:'+str(os.fstat(9).st_ino)+r'\s+0\s+EOF\s*$',info,re.M),'FD9_FLOCK_UNPROVEN'
    def run(argv):
        lock_guard();child=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE);children.append(child);out,err=child.communicate()
        commands.append(dict(argv=argv,originalPid=child.pid,returncode=child.returncode,stdoutSha256=digest(out),stderrSha256=digest(err)))
        assert child.returncode==0 and len(out)<=16*1024**2 and len(err)<=65536,'ORIGINAL_READONLY_CHILD_FAILED';lock_guard();return out
    def ps():
        raw=run(['/usr/bin/docker','--host','unix:///var/run/docker.sock','compose','-f','/opt/sabalanerp/docker-compose.prod.yml','ps','--format','json'])
        rows=json.loads(raw)if raw.lstrip().startswith(b'[')else[json.loads(v)for v in raw.splitlines()if v]
        assert sorted(v['Service']for v in rows)==sorted(spec['services'])and all(v['Project']=='sabalanerp'and v['State']=='running'and v['Health']=='healthy'for v in rows),'SIX_SERVICES_NOT_HEALTHY'
        return rows
    def docker(argv):ps();return run(['/usr/bin/docker','--host','unix:///var/run/docker.sock',*argv])
    def containers():
        ids=docker(['ps','--all','--no-trunc','--quiet']).decode().split();assert len(ids)<=256
        rows=json.loads(docker(['inspect',*ids]))if ids else[]
        canonical=[v for v in rows if v['Config'].get('Labels',{}).get('com.docker.compose.project')=='sabalanerp'and v['State']['Running']]
        assert len(canonical)==6
        for row in canonical:
            name=row['Config']['Labels']['com.docker.compose.service'];expected=spec['services'][name]
            assert(row['Id'],row['Image'],row['State']['StartedAt'])==(expected['id'],expected['image'],expected['startedAt']),'BASELINE_SERVICE_CHANGED'
        for row in rows:
            for mount in row['Mounts']:
                if mount['Type']=='tmpfs':continue
                source=Path(mount['Source']);assert source.is_absolute()
                assert source!=root and root not in source.parents and source not in root.parents,'CONTAINER_SCRATCH_REFERENCE'
        return{v['Id']:dict(image=v['Image'],startedAt=v['State']['StartedAt'],running=v['State']['Running'])for v in rows}
    def protected_references():
        count=0;total=0;observations=[];binary={'.gz','.tgz','.tar','.sabrec','.zip','.sqlite','.db','.pem','.key','.pub','.crt'}
        for base in PROTECTED:
            if not base.exists():observations.append(dict(root=str(base),absent=True));continue
            assert base.resolve(strict=True)==base and base.is_dir(),'PROTECTED_ROOT_ALIAS'
            for folder,dirs,files in os.walk(base,followlinks=False):
                directory=Path(folder);assert not directory.is_symlink()
                for name in dirs:assert not(directory/name).is_symlink(),'UNKNOWN_PROTECTED_DIRECTORY_ALIAS'
                for name in files:
                    file=directory/name;before=file.lstat();assert stat.S_ISREG(before.st_mode)and not stat.S_ISLNK(before.st_mode),'UNKNOWN_PROTECTED_FILE_TYPE'
                    count+=1;assert count<=20000,'PROTECTED_REFERENCE_FILE_CAPACITY'
                    if file.suffix.lower()in binary:continue
                    assert before.st_size<=16*1024**2,'UNREVIEWED_LARGE_PROTECTED_METADATA';total+=before.st_size;assert total<=512*1024**2,'PROTECTED_REFERENCE_BYTE_CAPACITY'
                    fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
                    try:
                        assert identity(os.fstat(fd))==identity(before);chunks=[]
                        while True:
                            block=os.read(fd,262144)
                            if not block:break
                            chunks.append(block)
                        raw=b''.join(chunks);assert len(raw)==before.st_size and identity(os.fstat(fd))==identity(file.lstat())==identity(before),'PROTECTED_METADATA_CHANGED'
                    finally:os.close(fd)
                    if intent is not None and file==intent:assert digest(raw)==intent_hash;continue
                    assert str(root).encode()not in raw and spec['operation'].encode()not in raw,'PROTECTED_METADATA_REFERENCES_SCRATCH: '+str(file)
        return dict(files=count,bytes=total,roots=observations)
    def no_process_users():
        nodes={(v.st_dev,v.st_ino)for _,_,v in held};nodes.add((root_identity[0],root_identity[1]));own_fds={str(fd)for _,fd,_ in held}|{str(root_fd)};checked=0
        for process in Path('/proc').iterdir():
            if not process.name.isdecimal():continue
            try:refs=[process/'cwd',process/'root',*list((process/'fd').iterdir())]
            except OSError as error:
                if error.errno in [errno.ENOENT,errno.ESRCH]:continue
                raise
            for ref in refs:
                try:
                    own=process.name==str(os.getpid())and ref.parent.name=='fd'and ref.name in own_fds
                    if own:continue
                    value=ref.stat();assert(value.st_dev,value.st_ino)not in nodes,'OPEN_EXPORT_REFERENCE'
                    linked=os.readlink(ref);assert linked!=str(root)and not linked.startswith(str(root)+'/'),'OPEN_SCRATCH_ROOT_REFERENCE'
                except OSError as error:
                    if error.errno in [errno.ENOENT,errno.ESRCH]:continue
                    raise
            try:maps=(process/'maps').read_text()
            except OSError as error:
                if error.errno in [errno.ENOENT,errno.ESRCH]:continue
                raise
            for line in maps.splitlines():
                fields=line.split(None,5)
                if len(fields)<5:continue
                major,minor=fields[3].split(':');assert(os.makedev(int(major,16),int(minor,16)),int(fields[4]))not in nodes,'MAPPED_EXPORT_REFERENCE'
                if len(fields)==6:assert fields[5]!=str(root)and not fields[5].startswith(str(root)+'/'),'MAPPED_SCRATCH_ROOT_REFERENCE'
            checked+=1
        return checked
    def audit(file,value):
        raw=json.dumps(value,sort_keys=True,separators=(',',':')).encode();fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
        try:
            with os.fdopen(os.dup(fd),'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
        finally:os.close(fd)
        directory=os.open(file.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:os.fsync(directory)
        finally:os.close(directory)
        return digest(raw)
    try:
        host();assert LOCK.resolve(strict=True)==LOCK;named=LOCK.lstat();assert stat.S_ISREG(named.st_mode)and named.st_uid==0 and named.st_nlink==1 and not named.st_mode&0o022
        lock_fd=os.open(LOCK,os.O_RDWR|os.O_NOFOLLOW);assert identity(os.fstat(lock_fd))==identity(named);os.dup2(lock_fd,9,inheritable=False);fcntl.flock(9,fcntl.LOCK_EX|fcntl.LOCK_NB);lock_identity=identity(os.fstat(9));lock_guard()
        assert run(['/usr/bin/git','-C','/opt/sabalanerp','rev-parse','HEAD']).decode().strip()==spec['deployedHead'],'BASELINE_HEAD_CHANGED'
        before_containers=containers();assert root.resolve(strict=True)==root;parent=root.lstat();assert stat.S_ISDIR(parent.st_mode)and parent.st_uid==0 and stat.S_IMODE(parent.st_mode)==0o700
        root_fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);assert identity(os.fstat(root_fd))==identity(parent);root_identity=identity(parent)
        assert sorted(os.listdir(root_fd))==sorted(Path(v['path']).name for v in spec['files']),'UNREVIEWED_SCRATCH_CHILD'
        for expected in spec['files']:
            file=Path(expected['path']);fd=os.open(file.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=root_fd);held.append((file,fd,os.fstat(fd)));actual=held[-1][2]
            assert stat.S_ISREG(actual.st_mode)and actual.st_uid==0 and actual.st_nlink==1 and stat.S_IMODE(actual.st_mode)==0o400
            assert(actual.st_dev,actual.st_ino,actual.st_size)==(int(expected['device']),int(expected['inode']),expected['bytes']),'EXPORTED_FILE_IDENTITY_CHANGED'
            h=hashlib.sha256()
            while True:
                block=os.read(fd,262144)
                if not block:break
                h.update(block)
            assert h.hexdigest()==expected['sha256']and identity(os.fstat(fd))==identity(file.lstat())==identity(actual),'EXPORTED_FILE_BYTES_CHANGED'
        references=protected_references();processes=no_process_users();lock_guard();assert containers()==before_containers
        audit_root=LOCK.parent/'export-scratch-retirement';
        if not audit_root.exists():audit_root.mkdir(mode=0o700)
        a=audit_root.lstat();assert audit_root.resolve(strict=True)==audit_root and stat.S_ISDIR(a.st_mode)and a.st_uid==0 and stat.S_IMODE(a.st_mode)==0o700
        intent=audit_root/(spec['operation']+'-intent.json');intent_hash=audit(intent,dict(format='sabalan-export-scratch-retirement-intent/v1',spec=spec,retirementReason='VERIFIED_LOCAL_RAW_OCI_AND_GZIP_CUSTODY_REMOTE_EXPORT_SCRATCH_ONLY',lock=dict(device=str(os.fstat(9).st_dev),inode=str(os.fstat(9).st_ino)),protectedReferenceAudit=references,processes=processes,productionAdmission=False))
        for file,fd,before in held:
            lock_guard();assert identity(os.fstat(root_fd))==identity(root.lstat()),'SCRATCH_ROOT_CHANGED';protected_references();no_process_users()
            assert identity(os.fstat(fd))==identity(file.lstat())==identity(before),'TARGET_CHANGED_BEFORE_UNLINK'
            os.unlink(file.name,dir_fd=root_fd);os.fsync(root_fd);deleted.append(dict(path=str(file),bytes=before.st_size,sha256=next(v['sha256']for v in spec['files']if v['path']==str(file)),device=str(before.st_dev),inode=str(before.st_ino),retentionReason='VERIFIED_LOCAL_RAW_OCI_AND_GZIP_CUSTODY'))
            assert os.fstat(fd).st_nlink==0 and not file.exists(),'EXACT_UNLINK_UNPROVEN'
        assert os.listdir(root_fd)==[];lock_guard();after_containers=containers();assert before_containers==after_containers,'CONTAINER_CENSUS_CHANGED'
        assert run(['/usr/bin/git','-C','/opt/sabalanerp','rev-parse','HEAD']).decode().strip()==spec['deployedHead'],'BASELINE_HEAD_CHANGED'
        report.update(passResult=True,allContainerIdentitiesUnchanged=True,localCopiesPreserved=True,intentPath=str(intent),intentSha256=intent_hash,emptyScratchDirectoryPreserved=True)
    except BaseException as error:report['error']=type(error).__name__+': '+str(error)
    finally:
        for child in children:child.wait()
        for _,fd,_ in held:os.close(fd)
        if root_fd is not None:os.close(root_fd)
        report.update(originalCommands=commands,allOriginalChildrenClosed=all(c.poll()is not None for c in children),interrupted=interrupted)
        if interrupted:report['passResult']=False
        if intent is not None:
            try:report['resultAuditSha256']=audit(intent.with_name(spec['operation']+'-result.json'),report)
            except BaseException as error:report.update(passResult=False,auditFailure=type(error).__name__+': '+str(error))
        if lock_fd is not None:
            if lock_fd!=9:os.close(lock_fd)
            os.close(9)
    print(json.dumps(report));return 0 if report['passResult']else 1

if __name__=='__main__':sys.exit(main(json.loads(base64.b64decode('__SPEC_BASE64__'))))
