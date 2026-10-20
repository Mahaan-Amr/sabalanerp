#!/usr/bin/env python3
"""Protected pre-checkpoint storage preparation; never admits a runtime.

The original deploy owns the host mutex/DB lease and has drained its old actors.
This child also takes BOTH actual coordination EX locks, rechecks the stopped
old immutable container, and reads its archive through the root Docker socket.
It never mounts an empty volume over unexamined legacy bytes or removes old data.
"""
import hashlib,http.client,json,os,re,signal,socket,stat,subprocess,sys,tarfile,threading
from pathlib import Path
from urllib.parse import quote


def require(value):
    if not value:raise RuntimeError('PROTECTED_DISPATCH_ROOT_UNPROVEN')


original_children=[]
original_connections=[]
mutation_started=False
interrupted=False


def observed(args):
    child=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    state=dict(child=child,closed=False,code=None,overflow=False,pumpFailed=False,bytes=0,stdout=[],stderr=[])
    original_children.append(state)
    lock=threading.Lock()
    def drain(stream,target):
        try:
            while True:
                chunk=stream.read(65536)
                if not chunk:break
                with lock:
                    state['bytes']+=len(chunk)
                    if state['bytes']<=8*1024**2:state[target].append(chunk)
                    else:state['overflow']=True
        except BaseException:
            state['pumpFailed']=True
    threads=[threading.Thread(target=drain,args=(stream,key),daemon=False) for stream,key in [(child.stdout,'stdout'),(child.stderr,'stderr')]];state['threads']=threads
    for thread in threads:thread.start()
    state['code']=child.wait();state['closed']=True
    for thread in threads:thread.join()
    require(state['code']==0 and not state['overflow'] and not state['pumpFailed'] and not interrupted)
    return b''.join(state['stdout'])


def interrupt(_number,_frame):
    global interrupted
    interrupted=True


def run():
    global mutation_started
    require(sys.platform=='linux' and os.getuid()==0 and len(sys.argv)==5)
    import fcntl
    base,environment,old_id,old_image=sys.argv[1:]
    require(re.fullmatch('[a-f0-9]{64}',old_id) and re.fullmatch('sha256:[a-f0-9]{64}',old_image))
    base=Path(base);environment=Path(environment);root=base.parent
    require(base.name=='docker-compose.prod.yml' and base.resolve(strict=True)==base and environment.resolve(strict=True)==environment)
    deployment=os.environ['DEPLOYMENT_ID'];release=os.environ['DEPLOYMENT_RELEASE_ID']
    require(re.fullmatch('[A-Za-z0-9_-]{8,128}',deployment) and re.fullmatch('[A-Za-z0-9_-]{8,128}',release))
    host_lock=root/'.deploy-state/deployment.lock';held=os.fstat(9);named=host_lock.lstat()
    require((held.st_dev,held.st_ino)==(named.st_dev,named.st_ino) and stat.S_ISREG(held.st_mode) and held.st_uid==0 and held.st_nlink==1)
    require(re.search(r'^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:'+str(held.st_ino)+r'\s+0\s+EOF\s*$',''.join(Path('/proc/self/fdinfo/9').read_text()),re.M))
    compose=['docker','compose','--env-file',str(environment),'-f',str(base)]
    def ps():observed(compose+['ps','--all','--format','json'])
    def docker(args):ps();return observed(['docker']+args)
    def inspect():
        value=json.loads(docker(['inspect',old_id]));require(len(value)==1);value=value[0]
        require(value['Id']==old_id and value['Image']==old_image and not value['State']['Running'] and value['State']['Pid']==0 and not value['State']['OOMKilled'])
        require(value['Config']['Labels']['com.docker.compose.service']=='backend')
        return value
    old=inspect();project=old['Config']['Labels']['com.docker.compose.project']
    require(re.fullmatch('[a-z0-9_-]+',project));compose[2:2]=['-p',project]
    matches=[mount for mount in old['Mounts'] if mount['Destination']=='/app/recovery-coordination']
    require(len(matches)==1 and matches[0]['Type']=='volume' and matches[0]['RW'])
    require(not any('/app/storage/dispatch-documents'==mount['Destination'] or '/app/storage/dispatch-documents'.startswith(mount['Destination'].rstrip('/')+'/') for mount in old['Mounts']))
    coordination=json.loads(docker(['volume','inspect',matches[0]['Name']]))[0]
    require(coordination['Driver']=='local' and not coordination.get('Options') and coordination['Labels']['com.docker.compose.project']==project)
    directory=Path(coordination['Mountpoint']);require(directory.resolve(strict=True)==directory and directory.is_dir())
    gates=[]
    for name in ['deployment-runtime-control.lock','deployment-write-admission.lock']:
        fd=os.open(directory/name,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600);value=os.fstat(fd)
        require(stat.S_ISREG(value.st_mode) and value.st_uid==0 and value.st_nlink==1 and value.st_size==0 and not value.st_mode&0o022)
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);gates.append(fd)
    class DockerConnection(http.client.HTTPConnection):
        def connect(self):
            self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.connect('/var/run/docker.sock')
    def request(method,path):
        ps();connection=DockerConnection('localhost');original_connections.append(connection);connection.request(method,path);response=connection.getresponse();return connection,response
    archive_path='/containers/'+old_id+'/archive?path='+quote('/app/storage/dispatch-documents',safe='')
    connection,response=request('HEAD',archive_path);status=response.status;response.read(4097);connection.close();require(status in [200,404]);require(inspect()['State']['StartedAt']==old['State']['StartedAt'])
    work=root/'.deploy-state'/('dispatch-root-'+deployment);work.mkdir(mode=0o700)
    archive=work/'original.tar';files=[];directories=[];archive_sha=None
    if status==200:
        connection,response=request('GET',archive_path);require(response.status==200)
        digest=hashlib.sha256();total=0
        with archive.open('xb') as output:
            os.chmod(archive,0o600)
            while True:
                chunk=response.read(262144)
                if not chunk:break
                total+=len(chunk);require(total<=33*1024**3);output.write(chunk);digest.update(chunk)
            output.flush();os.fsync(output.fileno())
        connection.close();os.chmod(archive,0o400);archive_sha=digest.hexdigest()
    def entries():
        with tarfile.open(archive,'r:') as source:
            seen=set();total=0
            for member in source:
                name=member.name.rstrip('/');parts=name.split('/')
                require(parts[0]=='dispatch-documents' and '\\' not in name and '\0' not in name and all(part not in ('','.','..') for part in parts) and not member.issparse() and (member.isdir() or member.isfile()))
                relative='/'.join(parts[1:]);require(relative not in seen);seen.add(relative);require(len(seen)<=20000 and len(relative)<=1024)
                if not relative:require(member.isdir());continue
                if member.isdir():yield relative,None,None;continue
                require(member.size<=2*1024**3);total+=member.size;require(total<=32*1024**3)
                yield relative,member,source.extractfile(member)
    if status==200:
        for relative,member,stream in entries():
            if member is None:directories.append(relative);continue
            digest=hashlib.sha256();size=0
            while True:
                chunk=stream.read(262144)
                if not chunk:break
                size+=len(chunk);digest.update(chunk)
            require(size==member.size);files.append(dict(key=relative,bytes=size,sha256=digest.hexdigest()))
    require(inspect()['State']['StartedAt']==old['State']['StartedAt'])
    # Leave room for fixed identities in the bounded immutable checkpoint proof
    # BEFORE first persistent-volume mutation, not after allocating/copying it.
    require(len(json.dumps(dict(files=files,directories=directories),sort_keys=True,separators=(',',':')).encode())<=15*1024**2)
    overlay=root/'docker-compose.online-storage.yml'
    ps();config=json.loads(observed(compose+['-f',str(root/'docker-compose.online.yml'),'-f',str(overlay),'config','--format','json']))
    mount=[value for value in config['services']['backend']['volumes'] if value['target']=='/app/storage/dispatch-documents']
    require(len(mount)==1 and mount[0]['type']=='volume' and mount[0]['source']=='backend_storage_dispatch_documents')
    name=config['volumes']['backend_storage_dispatch_documents']['name'];require(re.fullmatch('[a-zA-Z0-9_.-]+',name))
    connection,response=request('GET','/volumes/'+quote(name,safe=''));require(response.status==404);response.read(4097);connection.close()
    require(not interrupted);mutation_started=True
    docker(['volume','create','--label','com.docker.compose.project='+project,'--label','com.docker.compose.volume=backend_storage_dispatch_documents','--label','io.sabalan.protected.dispatch-operation='+deployment,name])
    volume=json.loads(docker(['volume','inspect',name]))[0]
    require(volume['Name']==name and volume['Driver']=='local' and not volume.get('Options') and volume['Labels']['io.sabalan.protected.dispatch-operation']==deployment)
    target=Path(volume['Mountpoint']);require(target.resolve(strict=True)==target and target.is_dir() and not list(target.iterdir()));os.chmod(target,0o700)
    for relative in sorted(directories,key=lambda value:(value.count('/'),value)):(target/relative).mkdir(mode=0o700,parents=True,exist_ok=True)
    expected={value['key']:value for value in files}
    if status==200:
        for relative,member,stream in entries():
            if member is None:continue
            file=target/relative;file.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            with file.open('xb') as output:
                os.chmod(file,0o600);digest=hashlib.sha256();size=0
                while True:
                    chunk=stream.read(262144)
                    if not chunk:break
                    output.write(chunk);digest.update(chunk);size+=len(chunk)
                output.flush();os.fsync(output.fileno())
            require(dict(key=relative,bytes=size,sha256=digest.hexdigest())==expected[relative])
            digest=hashlib.sha256()
            with file.open('rb') as source:
                for chunk in iter(lambda:source.read(262144),b''):digest.update(chunk)
                os.fsync(source.fileno())
            require(digest.hexdigest()==expected[relative]['sha256'])
    for current,children,names in os.walk(target,topdown=False):
        fd=os.open(current,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd)
    st=target.stat();files.sort(key=lambda value:value['key'])
    proof=dict(format='sabalan-protected-dispatch-root/v1',deploymentId=deployment,releaseId=release,oldContainerId=old_id,oldImage=old_image,oldStartedAt=old['State']['StartedAt'],sourceWasMissing=status==404,sourceArchiveSha256=archive_sha,files=files,directories=sorted(directories),volume=name,directory=dict(device=str(st.st_dev),inode=str(st.st_ino)),publicOnlineAdmission=False,checkpointRequired=True)
    output=directory/('online-dispatch-root-'+deployment+'.json')
    raw=(json.dumps(proof,sort_keys=True,separators=(',',':'))+'\n').encode()
    fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
    try:require(os.write(fd,raw)==len(raw));os.fsync(fd)
    finally:os.close(fd)
    fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd)
    require(inspect()['State']['StartedAt']==old['State']['StartedAt'])
    require(not interrupted)
    print(json.dumps(dict(proof=str(output),sha256=hashlib.sha256(raw).hexdigest(),files=len(files),bytes=sum(file['bytes'] for file in files),sourceWasMissing=status==404,checkpointRequired=True,publicOnlineAdmission=False)))


if __name__=='__main__':
    for number in [signal.SIGINT,signal.SIGTERM,signal.SIGHUP,signal.SIGPIPE]:signal.signal(number,interrupt)
    try:run()
    except BaseException:
        # Preserve every ORIGINAL client handle and the same gate descriptors.
        # A failed/unknown daemon mutation never becomes absence/adoption.
        for state in original_children:
            if not state['closed']:state['code']=state['child'].wait();state['closed']=True
            for thread in state.get('threads',[]):
                if thread.ident is not None:thread.join()
        for connection in original_connections:connection.close()
        if mutation_started:
            os.write(2,b'PROTECTED_DISPATCH_MUTATION_OUTCOME_HELD_BY_ORIGINAL_OWNER\n')
            while True:signal.pause()
        raise
