"""Fixed backup image receiver fragment, embedded with reviewed host guards.

No import, app start, checkpoint deletion, retention change or public admission.
All newly created bytes stay in this operation's private incident-held point.
"""
import os


def sync(directory):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)


def save_owned(file, raw):
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
    try:
        offset = 0
        while offset < len(raw):
            count = os.write(fd, raw[offset:]);need(count > 0);offset += count
        os.fsync(fd)
    finally:os.close(fd)
    need(file.read_bytes() == raw)
    sync(file.parent)


class ImageHost:
    def __init__(self):
        self.children=[];self.interrupted=False;self.before=host();self.native=node()
        self.active_verifier=[None];self.verifier_eof=[None];self.verifier_intent=False
        self.parent=private_directory(PARENT);self.locks=[];self.lock_names=[]
        self.node_fd=os.open(NODE,os.O_RDONLY|os.O_NOFOLLOW)
        need(identity(os.fstat(self.node_fd))==self.native)

    def acquire(self):
        import fcntl,errno
        need(self.node_fd not in [9,10])
        for number in [9,10]:
            try:os.fstat(number)
            except OSError as error:need(error.errno==errno.EBADF)
            else:raise AssertionError('UNKNOWN_INHERITED_LOCK_DESCRIPTOR')
        for name in [PARENT/'drill-ownership.lock',Path('/run/lock/sabalan-backup-storage.lock')]:
            need(name.parent.resolve(strict=True)==name.parent)
            fd=os.open(name,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
            try:
                st=os.fstat(fd);need(stat.S_ISREG(st.st_mode) and st.st_uid==0 and st.st_nlink==1 and not st.st_mode&0o022)
                need(identity(st)==identity(name.lstat()));fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
                self.locks.append((fd,identity(st)));self.lock_names.append(name)
            except BaseException:os.close(fd);raise
        # Keep these exact OFDs in every verifier child, as in FULL's owner.
        originals=[fcntl.fcntl(fd,fcntl.F_DUPFD_CLOEXEC,11) for fd,_ in self.locks]
        for fd,_ in self.locks:os.close(fd)
        self.locks=[]
        for source,target in zip(originals,[9,10]):
            os.dup2(source,target,inheritable=True);os.close(source)
            self.locks.append((target,identity(os.fstat(target))))
        self.lock_guard()

    def lock_guard(self):
        need(host()==self.before and identity(os.fstat(self.node_fd))==identity(NODE.lstat())==self.native and private_directory(PARENT)==self.parent)
        for (fd,expected),name in zip(self.locks,self.lock_names):need(identity(os.fstat(fd))==identity(name.lstat())==expected)

    def close(self):
        for fd,_ in reversed(self.locks):os.close(fd)
        self.locks=[]
        os.close(self.node_fd)


def drain_verifier_after_fault(h):
    """Same retained Popen only; no signal, PID adoption or replacement child."""
    import time,threading
    child=h.active_verifier[0]
    if child is None:return not h.verifier_intent
    prior=next((row for row in h.children if row.get('pid')==child.pid),None)
    if prior and prior.get('pipesClosed') and prior.get('stdoutEof') and prior.get('stderrEof') and type(prior.get('code')) is int and prior.get('observationFault') is None:return True
    both_closed=child.stdout.closed and child.stderr.closed
    if both_closed:
        eof=h.verifier_eof[0]
        if not isinstance(eof,dict) or eof.get('stdout') is not True or eof.get('stderr') is not True:return False
    elif child.stdout.closed or child.stderr.closed:return False
    else:
        # Two fixed-size discard readers, not communicate() output buffers.
        eof=[False,False];counts=[0,0];readers=[]
        def discard(pipe,index):
            while True:
                try:raw=os.read(pipe.fileno(),65536)
                except BaseException:time.sleep(.05);continue
                if not raw:eof[index]=True;return
                counts[index]=min(2**53-1,counts[index]+len(raw))
        for index,pipe in enumerate([child.stdout,child.stderr]):
            while True:
                try:reader=threading.Thread(target=discard,args=(pipe,index),daemon=False);break
                except BaseException:time.sleep(.05)
            readers.append(reader)
            while reader.ident is None:
                try:reader.start();break
                except BaseException:time.sleep(.05)
        for reader in readers:
            while True:
                try:
                    reader.join(.1)
                    if not reader.is_alive():break
                except BaseException:time.sleep(.05)
        if not all(eof):return False
    while True:
        try:code=child.wait();break
        except BaseException:time.sleep(.05)
    for stream in [child.stdout,child.stderr]:
        while True:
            try:stream.close();break
            except BaseException:time.sleep(.05)
    proof=dict(format='sabalan-same-original-verifier-drain/v1',pid=child.pid,code=code,stdoutEof=True,stderrEof=True,actualWaitObserved=True,maximumReadBytes=65536,retainedOutputBytes=0,signalSent=False,replacementChildStarted=False)
    if prior is not None:prior['exceptionalDrainProof']=proof
    else:h.children.append(dict(pid=child.pid,code=code,pipesClosed=True,stdoutEof=True,stderrEof=True,observationFault=['VERIFIER_COLLECTOR_EXCEPTION_DRAINED'],exceptionalDrainProof=proof))
    return True


def resolve_negative_verifier_custody(h,channel):
    try:
        drained=drain_verifier_after_fault(h)
        h.lock_guard()
        # The drain can block: cancellation must be checked AFTER it as well.
        return drained and not h.interrupted and all(channel['known_remote_row_closed'](row) for row in h.children)
    except BaseException:return False


def retain_unknown_image_owner():
    import time
    while True:
        try:time.sleep(30)
        except BaseException:pass


def run_repository():
    import datetime,io,signal
    need(sys.platform=='linux' and os.getuid()==0 and not sys.flags.optimize)
    os.umask(0o077);h=ImageHost();handlers={};point=None;point_identity=None;created=False;custody_safe=False
    channel={};exec(compile(CHANNEL_SOURCE,'same-original-image-channel','exec'),channel)
    transfer={};exec(compile(TRANSFER_SOURCE,'same-original-image-transfer','exec'),transfer)
    try:
        def cancelled(_signal,_frame):h.interrupted=True
        for sig in [signal.SIGINT,signal.SIGTERM]:handlers[sig]=signal.signal(sig,cancelled)
        h.acquire()
        for name in BACKUP_ABSENT:
            file=Path(name);need(file.parent==PARENT)
            try:file.lstat()
            except FileNotFoundError:pass
            else:raise AssertionError('FULL_TEMPORARY_INPUT_REAPPEARED')
        now=datetime.datetime.now(datetime.timezone.utc)
        age=(now-datetime.datetime.fromisoformat(CAPACITY_OBSERVED_AT.replace('Z','+00:00'))).total_seconds()
        need(0<=age<=600 and type(CANONICAL_RESERVE)is int and CANONICAL_RESERVE>=0)
        point=PARENT/('image-repository-'+OPERATION);need(not os.path.lexists(point))
        space=os.statvfs(PARENT);block=space.f_frsize
        required=sum(((row['cipher']['bytes']+block-1)//block)*block for row in IMAGES.values())
        code_allocated=sum(((len(raw)+block-1)//block)*block for raw in FILES.values())+16*block
        floor=CANONICAL_RESERVE+512*1024**2
        need(space.f_bavail*block>=floor+required+code_allocated)
        h.lock_guard();point.mkdir(mode=0o700);created=True;point_identity=private_directory(point);sync(PARENT)
        save_owned(point/'ACTIVE-INCIDENT-HOLD.json',channel['frame'](dict(format='sabalan-image-repository-incident-hold/v1',operation=OPERATION,fullOperation=FULL_OPERATION,productionAdmission=False)))
        for name,raw in FILES.items():save_owned(point/name,raw)
        owned=private_directory(point);stored=[];retrieved=[]
        def current():
            h.lock_guard();need(not h.interrupted and private_directory(point)==owned)
            free=os.statvfs(point);need(free.f_bavail*free.f_frsize>=floor)
        for sequence,role in enumerate(('backend','inquiry','frontend')):
            current();row=IMAGES[role];file=point/(role+'.sabrec')
            wanted=transfer['request'](OPERATION,role,sequence,str(file),row['cipher']['bytes'],row['cipher']['sha256'])
            channel['write_frame'](sys.stdout.buffer,wanted)
            result=transfer['receive_owned'](sys.stdin.buffer,file,wanted);current();stored.append(result)
        # Independent RSA/GCM consumes the STORED complete backend cipher.
        module={};exec(compile(COLLECTOR_SOURCE,'image-original-independent-verifier','exec'),module)
        source=transfer['verify_source'](point/'backend.sabrec',IMAGES['backend']['cipher'])
        try:
            output=io.BytesIO()
            with os.fdopen(os.dup(source['fd']),'rb') as stream:
                h.verifier_intent=True
                row,error=module['collect'](h,[str(NODE),'--max-old-space-size=128',str(point/'verify.cjs')],output,2*1024**2,stdin=stream)
            need(not error);transfer['assert_source_current'](source)
            proof=json.loads(output.getvalue());expected=IMAGES['backend']
            need(proof['format']=='sabalan-source-a-independent-image-stream-gcm/v1' and proof['image']==expected['image'])
            need(proof['gcmAuthenticated'] is True and proof['cipherBytes']==expected['cipher']['bytes'] and proof['cipherSha256']==expected['cipher']['sha256'])
            need(proof['plainBytes']==expected['gzip']['bytes'] and proof['plainSha256']==expected['gzip']['sha256'])
            need(proof['privateRsaExported'] is False and proof['plaintextPersisted'] is False and proof['productionAdmission'] is False)
        finally:os.close(source['fd'])
        current()
        for sequence,role in enumerate(('backend','inquiry','frontend')):
            wanted=transfer['request'](OPERATION,role,sequence,str(point/(role+'.sabrec')),IMAGES[role]['cipher']['bytes'],IMAGES[role]['cipher']['sha256'])
            source=transfer['verify_source'](point/(role+'.sabrec'),IMAGES[role]['cipher'])
            try:
                # verify_source retained the exact full-size FD at offset zero.
                with os.fdopen(os.dup(source['fd']),'rb') as stream:
                    retrieved.append(channel['send_retrieval'](stream,sys.stdout.buffer,sys.stdin.buffer,wanted,current))
                transfer['assert_source_current'](source)
            finally:os.close(source['fd'])
        current();need(all(c['code']==0 and c['pipesClosed'] and c['observationFault'] is None for c in h.children))
        result=dict(format='sabalan-c3-image-repository-original/v1',operation=OPERATION,fullOperation=FULL_OPERATION,point=str(point),images=IMAGES,stored=stored,retrieved=retrieved,independentBackend=proof,originalChildren=h.children,allOriginalChildrenClosed=True,canonicalReserveBytes=CANONICAL_RESERVE,floorBytes=floor,allocatedContentEstimateBytes=required,retrievalQualified=True,incidentHoldPreserved=True,imageImported=False,productionAdmission=False)
        save_owned(point/'RETRIEVAL-QUALIFIED.json',channel['frame'](result))
        channel['write_frame'](sys.stdout.buffer,dict(event='IMAGE_REPOSITORY_RESULT',result=result))
        need(sys.stdin.buffer.read(1)==b'');current();custody_safe=True;return 0
    except BaseException as error:
        # Tell the owning writer to close stdin before draining the SAME pipe.
        closed=resolve_negative_verifier_custody(h,channel)
        try:
            h.lock_guard()
            if created:need(point_identity is not None and private_directory(point)==point_identity)
        except BaseException:closed=False
        try:channel['write_frame'](sys.stdout.buffer,dict(event='IMAGE_REPOSITORY_NEGATIVE',operation=OPERATION,fullOperation=FULL_OPERATION,failureType=type(error).__name__,partialPointPreserved=created,originalChildren=h.children,interrupted=h.interrupted,allOriginalChildrenClosed=closed,productionAdmission=False))
        except BaseException:pass
        while sys.stdin.buffer.read(262144):pass
        custody_safe=closed and not h.interrupted
        return 1
    finally:
        # Includes any exception in drain, classification, or protocol cleanup.
        # No failed observation can fall through to dropping the original OFDs.
        if not custody_safe or h.interrupted:retain_unknown_image_owner()
        for sig,handler in handlers.items():signal.signal(sig,handler)
        h.close()
