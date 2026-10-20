"""Fixed original Inquiry pair controllers; diagnostic isolated SQLite only.

The Windows creator owns the outer Dockerexecs and carrier incarnations. This
file owns only children it actually creates; reports never reconstruct handles.
"""
import base64
import ctypes
import datetime
import hashlib
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import signal
import socket
import sqlite3
import stat
import subprocess
import sys
import threading
import time
if sys.platform=='linux': import fcntl
os.umask(0o077)

def check(value,code='INQUIRY_PAIR_UNPROVEN'):
    if not value:raise RuntimeError(code)
def encoded(value):return (json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True)+'\n').encode()
def digest(raw):return hashlib.sha256(raw).hexdigest()
def read(file,maximum=8*1024*1024):
    file=Path(file);check(file.resolve(strict=True)==file)
    fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        before=os.fstat(fd);check(stat.S_ISREG(before.st_mode)and before.st_uid==os.getuid()and before.st_nlink==1 and not before.st_mode&0o077 and before.st_size<=maximum)
        raw=b''
        while chunk:=os.read(fd,262144):
            raw+=chunk;check(len(raw)<=maximum)
        key=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
        check(key(before)==key(os.fstat(fd))==key(file.lstat()))
        return raw
    finally:os.close(fd)
def save(file,raw,mode=0o400):
    fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
    try:
        with os.fdopen(fd,'wb',closefd=False)as stream:stream.write(raw);stream.flush();os.fsync(fd)
    finally:os.close(fd)
    directory=os.open(Path(file).parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(directory)
    finally:os.close(directory)
def birth(pid):
    return dict(pid=pid,startTicks=Path('/proc/'+str(pid)+'/stat').read_text().rsplit(') ',1)[1].split()[19],
        bootId=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),pidNamespace=os.readlink('/proc/'+str(pid)+'/ns/pid'))
def private(directory):
    value=Path(directory).lstat();check(Path(directory).resolve(strict=True)==Path(directory)and stat.S_ISDIR(value.st_mode)and value.st_uid==os.getuid()and not value.st_mode&0o077)
def wait(body,code,child=None,seconds=90):
    end=time.monotonic()+seconds
    while True:
        result=body()
        if result:return result
        check(child is None or child.poll()is None,code+'_ORIGINAL_EXITED')
        check(time.monotonic()<end,code);time.sleep(.02)
def validate_pair(actors):
    check(set(actors)=={'old','current'})
    for actor in actors.values():
        check(re.fullmatch(r'[a-f0-9]{64}',actor['containerId'])and re.fullmatch(r'sha256:[a-f0-9]{64}',actor['image'])
            and re.fullmatch(r'[a-f0-9]{64}',actor['runtimeBundleSha256'])and re.fullmatch(r'[a-f0-9]{40}',actor['sourceCommit']))
        address=ipaddress.ip_address(actor['host']);check(address.version==4 and address.is_private and not address.is_loopback and not address.is_unspecified)
        check(isinstance(actor['startedAt'],str)and len(actor['startedAt'])<=64)
    for field in ('containerId','image','host'):check(actors['old'][field]!=actors['current'][field])

def prisma_tokens(raw):
    text=raw.decode();pattern=re.compile(r'\s+|//[^\n]*(?:\n|$)|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"|[A-Za-z_][A-Za-z_0-9]*|[0-9]+(?:\.[0-9]+)?|[^\s]',re.ASCII)
    result=[];offset=0
    for match in pattern.finditer(text):
        check(match.start()==offset);offset=match.end();value=match.group()
        if not value.isspace()and not value.startswith(('//','/*')):result.append(value)
    check(offset==len(text));return result

def channel(public_key,session):
    source=Path(__file__).with_name('original-host-controller-channel.fixture.py')
    spec=importlib.util.spec_from_file_location('retained_inquiry_channel',source);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    module.COMMANDS=frozenset({'PREPARE_INQUIRY_SCHEMA','PREPARE_INQUIRY_PAIR','START_INQUIRY','RUN_INQUIRY_BROWSER','REFUSE_INQUIRY_BROWSER_CAPACITY','ACQUIRE_INQUIRY_DRAIN','STOP_INQUIRY','FINISH_INQUIRY_PAIR'})
    module.EVENTS=frozenset({'HELLO','INQUIRY_SCHEMA_PREPARED','INQUIRY_PAIR_PREPARED','ACTOR_STARTED','INQUIRY_READY','INQUIRY_BROWSER_DONE','INQUIRY_DRAIN_HELD','INQUIRY_CLOSED','INQUIRY_PAIR_CLOSED','HELD'})
    return module.OriginalHostChannel(public_key,session,'candidate')

class Controller:
    def __init__(self,mode,root,public_key,session):
        self.mode=mode;self.root=Path(root);private(self.root)
        check(re.fullmatch(r'/app/online-runtime-acceptance/retained-browser-[a-f0-9]{32}',root))
        self.channel=channel(public_key,session);self.children=[];self.gate=None;self.native=None;self.ready=None
        self.directory=self.root/('controller-'+mode);self.directory.mkdir(mode=0o700)
        check(ctypes.CDLL(None,use_errno=True).prctl(36,1,0,0,0)==0)
    def child(self,name,argv,env=None,cwd=None,descriptors=()):
        output=open(self.directory/(name+'.stdout'),'xb',buffering=0);errors=open(self.directory/(name+'.stderr'),'xb',buffering=0)
        process=subprocess.Popen(argv,env=env,cwd=cwd,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=descriptors)
        owner=dict(process=process,birth=birth(process.pid),threads=[],streams=[output,errors],exceeded=False,closed=False);self.children.append(owner)
        def pump(source,target):
            count=0
            try:
                while chunk:=source.read(65536):
                    count+=len(chunk)
                    if count<=8*1024*1024:target.write(chunk)
                    else:owner['exceeded']=True
            finally:source.close()
        for source,target in ((process.stdout,output),(process.stderr,errors)):
            thread=threading.Thread(target=pump,args=(source,target));thread.start();owner['threads'].append(thread)
        return owner
    def closed(self,owner,expected=(0,)):
        code=owner['process'].wait()
        for thread in owner['threads']:thread.join()
        for stream in owner['streams']:os.fsync(stream.fileno());stream.close()
        owner['closed']=True;check(code in expected and not owner['exceeded'],'ORIGINAL_CHILD_FAILED')
        return code
    def lock(self,file):
        save(file,b'',0o600);value=Path(file).stat()
        return dict(file=str(file),device=str(value.st_dev),inode=str(value.st_ino),ownerUid=os.getuid())
    def prepare_schema(self,body):
        check(self.mode=='schema'and set(body)=={'canonicalSchemaSha256'})
        original=read(self.root/'inquiry-schema.prisma');check(digest(original)==body['canonicalSchemaSha256'])
        installed=Path('/app/node_modules/.prisma/client/schema.prisma');raw=installed.read_bytes()
        check(prisma_tokens(raw)==prisma_tokens(original),'INSTALLED_INQUIRY_SCHEMA_DIFFERS')
        check(not (self.root/'inquiry.db').exists())
        environment={key:value for key,value in os.environ.items()if not key.startswith(('PG','BACKEND_','INQUIRY_NATIVE_'))and key not in ('DATABASE_URL','NODE_OPTIONS','NODE_PATH')}
        environment.update(DATABASE_URL='file:'+str(self.root/'inquiry.db')+'?connection_limit=2&pool_timeout=5')
        child=self.child('schema',['/usr/local/bin/node','/app/node_modules/prisma/build/index.js','db','push','--skip-generate','--schema',str(installed)],environment,'/app');self.closed(child)
        file=self.root/'inquiry.db';file.chmod(0o600);connection=sqlite3.connect('file:'+str(file)+'?mode=ro',uri=True)
        try:
            check(connection.execute('PRAGMA integrity_check').fetchone()==('ok',))
            for table in ('Product','Admin','User'):check(connection.execute('SELECT count(*) FROM "'+table+'"').fetchone()==(0,))
        finally:connection.close()
        return dict(canonicalSchemaSha256=digest(original),installedSchemaSha256=digest(raw),actualImagePrismaDbPush=True,originalCliClosed=True)
    def prepare(self,body):
        check(self.mode=='issuer'and set(body)=={'actors','database'})
        validate_pair(body['actors']);database=body['database'];check(set(database)=={'name','systemIdentifier','oid'}and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,62}',database['name'])and re.fullmatch(r'[1-9][0-9]{0,24}',database['systemIdentifier'])and type(database['oid'])is int and database['oid']>0)
        coordination=self.root/'coordination';coordination.mkdir(mode=0o700)
        for name in ('online','online/native','online/work','online/admission','online/admission/staging'):(coordination/name).mkdir(mode=0o700)
        gate=self.lock(coordination/'deployment-write-admission.lock');interlock=self.lock(coordination/'deployment-runtime-control.lock');worker=self.lock(coordination/'deployment-online-worker.lock')
        save(coordination/'state.json',encoded(dict(mode='NORMAL',updatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())),0o600)
        common_database={key:database[key]for key in ('name','systemIdentifier')}
        definition=encoded(dict(format='sabalan-online-admission-scope/v1',gate=gate,interlock=interlock,worker=worker,database=common_database))
        save(coordination/'online/admission/scope.json',definition)
        save(coordination/'online/admission/00000000.json',encoded(dict(format='sabalan-online-capture-admission/v1',generation=0,phase='OPEN',previousSha256=None,capture=None,closureSha256=None)))
        sql=self.root/'inquiry.db'
        check(sql.is_file()and sql.resolve(strict=True)==sql)
        connection=sqlite3.connect(sql)
        try:
            for table in ('Product','Admin','User'):check(connection.execute('SELECT count(*) FROM "'+table+'"').fetchone()==(0,))
            password=secrets.token_hex(24);save(self.root/'admin-password',password.encode())
            script=self.root/'seed-password.cjs';save(script,b"const fs=require('node:fs');require('/app/node_modules/bcryptjs').hash(fs.readFileSync(process.argv[2],'utf8'),4).then(value=>process.stdout.write(value+'\\n')).catch(()=>{process.exitCode=1});\n")
            child=self.child('password',['/usr/local/bin/node',str(script),str(self.root/'admin-password')]);self.closed(child)
            hashed=read(self.directory/'password.stdout').strip().decode();check(re.fullmatch(r'\$2[aby]\$04\$[./A-Za-z0-9]{53}',hashed))
            now=int(time.time()*1000);connection.execute('INSERT INTO "Admin"(id,email,passwordHash,createdAt,updatedAt)VALUES(?,?,?,?,?)',('retained-inquiry-admin','retained-inquiry@example.invalid',hashed,now,now));connection.commit()
        finally:connection.close()
        sql.chmod(0o600);session_secret=secrets.token_hex(48);save(self.root/'session-secret',session_secret.encode())
        scopes={}
        for name,actor in body['actors'].items():
            runtime=secrets.token_hex(32);native=coordination/'online/native'/runtime;work=coordination/'online/work'/runtime;native.mkdir(mode=0o700);work.mkdir(mode=0o700)
            self.lock(native/'deployment-runtime-control.lock')
            scope=dict(format='sabalan-online-runtime-scope/v2',runtimeId=runtime,releaseId='retained-inquiry-'+self.root.name[-32:],manifestSha256=actor['runtimeBundleSha256'],sourceCommit=actor['sourceCommit'],image=actor['image'],nonce=secrets.token_hex(32),purpose='http',role='serving',coordinationDirectory=str(coordination),nativeDirectory=str(native),boundaryDirectory=str(work),gate=gate,interlock=interlock,worker=None,admission=dict(directory=str(coordination/'online/admission'),scopeSha256=digest(definition)),database=common_database)
            namespace='sabalan-rt-'+digest(runtime.encode())[:48]
            save(work/'scope.json',encoded(dict(format='sabalan-runtime-namespace/v1',scope=dict(runtimeId=runtime,image=actor['image'],registrySha256=actor['runtimeBundleSha256'],generation=1,gate={key:gate[key]for key in ('device','inode','ownerUid')},postgresApplicationName=namespace))),0o600)
            raw=encoded(scope);authority=Path('/app/runtime-authority');private(authority);save(authority/(runtime+'.json'),raw)
            scopes[name]=dict(scope=scope,file='/run/sabalan-online/'+runtime+'.json',sha256=digest(raw))
        configuration=dict(format='sabalan-retained-inquiry-pair/v1',root=str(self.root),actors=body['actors'],database=database,scopes=scopes,sqlite=dict(path=str(sql),device=str(sql.stat().st_dev),inode=str(sql.stat().st_ino)))
        raw=encoded(configuration);save(self.root/'pair.json',raw);self.configuration=configuration
        return dict(configurationFile=str(self.root/'pair.json'),configurationSha256=digest(raw),scopes=scopes,sqlite=configuration['sqlite'])
    def start(self,body):
        check(self.mode in ('old','current')and set(body)=={'configurationSha256'})
        raw=read(self.root/'pair.json');check(digest(raw)==body['configurationSha256']);config=json.loads(raw);grant=config['scopes'][self.mode];scope=grant['scope'];actor=config['actors'][self.mode]
        check(digest(Path('/app/online-runtime/entry.cjs').read_bytes())==actor['runtimeBundleSha256'])
        check(prisma_tokens(Path('/app/node_modules/.prisma/client/schema.prisma').read_bytes())==prisma_tokens(read(self.root/'inquiry-schema.prisma')),'INSTALLED_INQUIRY_SCHEMA_DIFFERS')
        check(read(grant['file'])==encoded(scope),'ORIGINAL_RO_SCOPE_CHANGED')
        environment={key:value for key,value in os.environ.items()if not key.startswith(('PG','BACKEND_','INQUIRY_NATIVE_'))and key not in ('DATABASE_URL','NODE_OPTIONS','NODE_PATH')}
        environment.update(NODE_ENV='production',DATABASE_URL='file:'+str(self.root/'inquiry.db')+'?connection_limit=2&pool_timeout=5',SESSION_SECRET=read(self.root/'session-secret').decode(),BACKEND_RUNTIME_ROLE='serving',BACKEND_ONLINE_SCOPE_FILE=grant['file'],BACKEND_ONLINE_SCOPE_SHA256=grant['sha256'],RECOVERY_COORDINATION_DIR=scope['coordinationDirectory'],INQUIRY_RUNTIME_GENERATION='1')
        native=Path(scope['nativeDirectory'])/'deployment-runtime-native.json';work=Path(scope['boundaryDirectory'])/'state.json'
        command=['/app/node_modules/next/dist/bin/next','start']
        if actor.get('entryPath') is not None:
            check(actor['entryPath']=='/app/online-runtime/inquiry-legacy-entry.cjs' and actor['legacyBusinessSource']['kind']=='COMPILED_IMAGE'
                  and actor['legacyBusinessSource']['image']=='sha256:ab6e2933e2d0d397f0b1a514dba69206e21856fa7d4275ab33383020bf9dd66e'
                  and actor['legacyBusinessSource']['sourceCommit'] is None,'LEGACY_COMPILED_PROVENANCE_REQUIRED')
            check(digest(Path(actor['entryPath']).read_bytes())==actor['ownedLegacyEntrySha256'],'LEGACY_OWNED_ENTRY_CHANGED')
            command=[actor['entryPath']]
        self.native=self.child('native',['/usr/bin/python3','-I','-B','/app/online-runtime/scripts/online-inquiry-owner.py','/usr/local/bin/node',*command,'--hostname',actor['host'],'--port','3001'],environment,'/app')
        self.channel.emit('ACTOR_STARTED',dict(runtimeId=scope['runtimeId'],birth=self.native['birth']))
        def ready():
            if not native.exists()or not work.exists():return None
            value=json.loads(read(native));state=json.loads(read(work))
            check(value['phase']=='ACTIVE'and value['onlineScope']['sha256']==grant['sha256']and value['guardian']==self.native['birth'])
            if state['phase']!='QUIESCENT':return None
            try:
                with socket.create_connection((actor['host'],3001),timeout=1)as stream:stream.sendall(b'GET /admin/login HTTP/1.1\r\nHost: localhost:3199\r\nConnection: close\r\n\r\n');response=stream.recv(256)
                if not response.startswith(b'HTTP/1.1 200'):return None
            except OSError:return None
            return dict(runtimeId=scope['runtimeId'],host=actor['host'],port=3001,image=actor['image'],nativeActiveRawBase64=base64.b64encode(read(native)).decode(),workRawBase64=base64.b64encode(read(work)).decode(),scopeSha256=grant['sha256'])
        self.ready=wait(ready,'INQUIRY_READY_UNPROVEN',self.native['process']);self.configuration=config;return self.ready
    def drain(self,body):
        check(self.mode=='issuer'and body=={}and getattr(self,'browser_closed',False))
        fd=os.open(self.root/'coordination/deployment-write-admission.lock',os.O_RDWR|os.O_NOFOLLOW)
        self.gate=fd
        # Failure to acquire is a held boundary; a deadline never grants EX.
        fcntl.flock(fd,fcntl.LOCK_EX)
        for grant in self.configuration['scopes'].values():check(json.loads(read(Path(grant['scope']['boundaryDirectory'])/'state.json'))['phase']=='QUIESCENT')
        return dict(gate=dict(device=str(os.fstat(fd).st_dev),inode=str(os.fstat(fd).st_ino)),originalGateExclusive=True)
    def stop(self,body):
        check(self.mode in ('old','current')and body=={}and self.native and self.ready)
        # Independently require another process's actual EX on the named gate.
        gate=os.open(self.root/'coordination/deployment-write-admission.lock',os.O_RDWR|os.O_NOFOLLOW)
        try:
            try:fcntl.flock(gate,fcntl.LOCK_SH|fcntl.LOCK_NB)
            except BlockingIOError:pass
            else:raise RuntimeError('INQUIRY_DRAIN_EX_REQUIRED')
        finally:os.close(gate)
        grant=self.configuration['scopes'][self.mode];scope=grant['scope'];work=Path(scope['boundaryDirectory'])/'state.json';native=Path(scope['nativeDirectory'])/'deployment-runtime-native.json'
        check(json.loads(read(work))['phase']=='QUIESCENT'and birth(self.native['process'].pid)==self.native['birth'])
        self.native['process'].send_signal(signal.SIGTERM);code=self.closed(self.native,(128,))
        raw=read(native);value=json.loads(raw);state=read(work)
        check(value['phase']=='QUIESCENT'and value['nativeReaped']is True and value['sqliteNativeClosed']is True and value['stoppedBySignal']is True
            and value['activeClaimSha256']==digest(base64.b64decode(self.ready['nativeActiveRawBase64']))and json.loads(state)['phase']=='QUIESCENT')
        return dict(runtimeId=scope['runtimeId'],originalGuardian=self.native['birth'],originalWrapperStatus=code,requestedStop='SIGTERM',actualNativeStatus=value['nativeStatus'],nativeRawBase64=base64.b64encode(raw).decode(),activeRawBase64=self.ready['nativeActiveRawBase64'],workRawBase64=base64.b64encode(state).decode(),allOriginalChildrenClosed=True)
    def run_browser(self,body):
        check(self.mode=='issuer'and body=={}and not hasattr(self,'browser_closed'))
        profile=Path('/tmp')/('iq-'+secrets.token_hex(8));profile.mkdir(mode=0o700)
        environment=dict(os.environ,HOME=str(profile),XDG_CONFIG_HOME=str(profile),XDG_CACHE_HOME=str(profile),TMPDIR=str(profile))
        chrome=self.child('chrome',['/usr/bin/chromium','--headless=new','--no-sandbox','--disable-setuid-sandbox','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+str(profile),'about:blank'],environment)
        portfile=profile/'DevToolsActivePort';wait(lambda:portfile.exists(),'ORIGINAL_CHROME_NOT_READY',chrome['process']);lines=portfile.read_text().splitlines();check(len(lines)==2 and lines[0].isdigit()and re.fullmatch(r'/devtools/browser/[a-f0-9-]+',lines[1]))
        lock=os.open(self.root/'routing-publication.lock',os.O_RDWR|os.O_CREAT|os.O_EXCL,0o600);fcntl.flock(lock,fcntl.LOCK_EX);os.dup2(lock,20,inheritable=True)
        if lock!=20:os.close(lock)
        args=dict(root=str(self.root),browserWSEndpoint='ws://127.0.0.1:'+lines[0]+lines[1],originalChrome=chrome['birth'],configurationSha256=digest(read(self.root/'pair.json')))
        save(self.root/'browser-input.json',encoded(args))
        child=self.child('browser',['/usr/local/bin/node',str(self.root/'inquiry-paired-browser.mjs'),str(self.root/'browser-input.json')],dict(os.environ),str(self.root),descriptors=(20,))
        browser_error=None
        try:self.closed(child,(0,1))
        except BaseException as error:
            if not child['closed']:raise
            browser_error=error
        # The original browser child may fail before connecting. Close only
        # this still-owned Chrome through its real private CDP endpoint, never
        # a timeout signal or a reconstructed process name/PID.
        if chrome['process'].poll()is None:
            check(birth(chrome['process'].pid)==chrome['birth'])
            closer=self.root/'close-original-chrome.cjs'
            save(closer,b"const p=require('/app/node_modules/puppeteer');p.connect({browserWSEndpoint:process.argv[2]}).then(b=>b.close()).catch(()=>{process.exitCode=1});\n")
            closing=self.child('chrome-close',['/usr/local/bin/node',str(closer),args['browserWSEndpoint']]);self.closed(closing,(0,1))
        self.closed(chrome)
        while True:
            try:pid,_=os.waitpid(-1,0)
            except ChildProcessError:break
            check(pid>0)
        os.close(20);self.browser_closed=True
        if child['process'].returncode!=0 or browser_error is not None:
            result=dict(format='sabalan-original-installed-inquiry-browser-negative/v1',originalBrowserStatus=child['process'].returncode,
                stderrSha256=digest(read(self.directory/'browser.stderr')),originalChrome=chrome['birth'],originalChromeClosed=True,qualificationSuccess=False)
        else:
            result=json.loads(read(self.directory/'browser.stdout'));check(result['format']=='sabalan-original-installed-inquiry-browser/v1')
        self.browser_result=result;return result
    def finish(self,body):
        check(self.mode=='issuer'and body=={}and self.gate is not None and self.browser_closed)
        closures={}
        for name,grant in self.configuration['scopes'].items():
            raw=read(Path(grant['scope']['nativeDirectory'])/'deployment-runtime-native.json');value=json.loads(raw)
            check(value['phase']=='QUIESCENT'and value['nativeReaped']and value['sqliteNativeClosed']and value['stoppedBySignal'])
            check(json.loads(read(Path(grant['scope']['boundaryDirectory'])/'state.json'))['phase']=='QUIESCENT');closures[name]=dict(nativeSha256=digest(raw),nativeRawBase64=base64.b64encode(raw).decode())
        file=self.root/'inquiry.db';connection=sqlite3.connect('file:'+str(file)+'?mode=ro',uri=True)
        try:
            check(connection.execute('PRAGMA integrity_check').fetchone()==('ok',));rows=connection.execute('SELECT rowNumber,name,description FROM Product ORDER BY rowNumber').fetchall()
            if self.browser_result['format']=='sabalan-original-installed-inquiry-browser/v1':
                check(rows==sorted(tuple((row[key]for key in ('rowNumber','name','description')))for row in self.browser_result['expectedProducts']))
            check(connection.execute('SELECT count(*) FROM Admin').fetchone()==(1,))
        finally:connection.close()
        st=file.stat();check(dict(path=str(file),device=str(st.st_dev),inode=str(st.st_ino))==self.configuration['sqlite'])
        fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW);checksum=hashlib.sha256()
        try:
            while chunk:=os.read(fd,262144):checksum.update(chunk)
            os.fsync(fd)
        finally:os.close(fd)
        check(all(row['closed']for row in self.children));self.channel.assert_observers_closed()
        os.close(self.gate);self.gate=None
        success=self.browser_result['format']=='sabalan-original-installed-inquiry-browser/v1'and all(json.loads(base64.b64decode(row['nativeRawBase64']))['nativeStatus']in(0,143,-15)for row in closures.values())
        return dict(format='sabalan-original-installed-inquiry-pair/v1',qualificationSuccess=success,sqlite=dict(**self.configuration['sqlite'],sha256=checksum.hexdigest(),bytes=st.st_size),rows=[list(row)for row in rows],closures=closures,browser=self.browser_result,allOriginalChildrenClosed=True,productionAdmission=False,realElapsed24HoursQualified=False)
    def run(self):
        self.channel.emit('HELLO',dict(mode=self.mode,originalController=birth(os.getpid())))
        if self.mode=='schema':
            self.channel.emit('INQUIRY_SCHEMA_PREPARED',self.prepare_schema(self.channel.receive('PREPARE_INQUIRY_SCHEMA').body))
        elif self.mode=='issuer':
            body=self.channel.receive('PREPARE_INQUIRY_PAIR').body;self.channel.emit('INQUIRY_PAIR_PREPARED',self.prepare(body))
            request=self.channel.receive({'RUN_INQUIRY_BROWSER','REFUSE_INQUIRY_BROWSER_CAPACITY'})
            if request.command=='REFUSE_INQUIRY_BROWSER_CAPACITY':
                check(request.body=={});self.browser_closed=True;self.browser_result=dict(format='sabalan-original-installed-inquiry-browser-negative/v1',reason='ORIGINAL_RESOURCE_ADMISSION_REFUSED',qualificationSuccess=False)
                self.channel.emit('INQUIRY_BROWSER_DONE',self.browser_result)
            else:
                check(request.body=={});self.channel.emit('INQUIRY_BROWSER_DONE',self.run_browser({}))
            self.channel.receive('ACQUIRE_INQUIRY_DRAIN');self.channel.emit('INQUIRY_DRAIN_HELD',self.drain({}))
            self.channel.receive('FINISH_INQUIRY_PAIR');self.channel.emit('INQUIRY_PAIR_CLOSED',self.finish({}))
        else:
            self.channel.emit('INQUIRY_READY',self.start(self.channel.receive('START_INQUIRY').body))
            self.channel.receive('STOP_INQUIRY');self.channel.emit('INQUIRY_CLOSED',self.stop({}))
        self.channel.assert_observers_closed();check(all(row['closed']for row in self.children))

def main():
    check(sys.platform=='linux'and os.getuid()==0 and len(sys.argv)==5)
    mode,root,key,session=sys.argv[1:];check(mode in ('issuer','schema','old','current'))
    owner=Controller(mode,root,key,session)
    try:owner.run()
    except BaseException:
        if mode=='schema'and all(child['closed']for child in owner.children):
            # This mode cannot launch a serving/native actor. A known failed
            # image-owned schema CLI can close negatively without stranding
            # the host's original keeper restoration.
            try:owner.channel.emit('INQUIRY_SCHEMA_PREPARED',dict(actualImagePrismaDbPush=False,originalCliClosed=True,qualificationSuccess=False))
            except BaseException:pass
            raise SystemExit(1)
        try:owner.channel.emit('HELD',dict(mode=mode,reason='ORIGINAL_INQUIRY_OUTCOME_UNPROVEN'))
        except BaseException:pass
        # Unknown child/signal/native/SQLite outcomes retain THIS controller.
        while True:time.sleep(1)
if __name__=='__main__':main()
