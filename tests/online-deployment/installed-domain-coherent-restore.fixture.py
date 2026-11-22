"""Second, supplemental coherent SQL/nine-file-cut proof after installed writes.

The first point's SQLite is reused with exact immutable-byte lineage. This is
NOT a COMPLETE three-application recovery point or production promotion proof.
Original handles remain here on every negative; no replacement/kill/adoption.
"""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import time
from urllib.parse import urlunsplit,unquote

OWNER = None

def digest(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def pin(value): return tuple(getattr(value,key) for key in ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_mode','st_uid','st_nlink'))
def birth(pid):
    process=Path('/proc')/str(pid);fields=(process/'stat').read_text().rsplit(') ',1)[1].split()
    return dict(pid=pid,startTicks=fields[19],bootId=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),pidNamespace=os.readlink(process/'ns/pid'))
def stable(file,maximum):
    file=Path(file)
    if not file.is_absolute() or file.resolve(strict=True)!=file:raise RuntimeError('DOMAIN_RESTORE_PATH_UNSAFE')
    fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        before=os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1 or before.st_uid!=os.geteuid() or not 0<before.st_size<=maximum:raise RuntimeError('DOMAIN_RESTORE_FILE_UNSAFE')
        result=bytearray()
        while chunk:=os.read(fd,min(262144,maximum+1-len(result))):
            result.extend(chunk)
            if len(result)>maximum:raise RuntimeError('DOMAIN_RESTORE_FILE_BOUND')
        if pin(before)!=pin(os.fstat(fd)) or pin(before)!=pin(file.lstat()):raise RuntimeError('DOMAIN_RESTORE_FILE_CHANGED')
        return bytes(result),pin(before)
    finally:os.close(fd)

def stable_digest(file,maximum):
    file=Path(file)
    if not file.is_absolute() or file.resolve(strict=True)!=file:raise RuntimeError('DOMAIN_RESTORE_PATH_UNSAFE')
    fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        before=os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1 or before.st_uid!=os.geteuid() or not 0<before.st_size<=maximum:raise RuntimeError('DOMAIN_RESTORE_FILE_UNSAFE')
        checksum=hashlib.sha256();total=0
        while chunk:=os.read(fd,262144):
            total+=len(chunk)
            if total>maximum:raise RuntimeError('DOMAIN_RESTORE_FILE_BOUND')
            checksum.update(chunk)
        if pin(before)!=pin(os.fstat(fd)) or pin(before)!=pin(file.lstat()) or total!=before.st_size:raise RuntimeError('DOMAIN_RESTORE_FILE_CHANGED')
        return dict(bytes=total,sha256=checksum.hexdigest()),pin(before)
    finally:os.close(fd)

def immutable_copy(file,target,maximum):
    expected,before=stable_digest(file,maximum)
    incoming=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    outgoing=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o400)
    try:
        if pin(os.fstat(incoming))!=before:raise RuntimeError('DOMAIN_RESTORE_COPY_SOURCE_CHANGED')
        while chunk:=os.read(incoming,262144):
            view=memoryview(chunk)
            while view:
                written=os.write(outgoing,view)
                if written<=0:raise RuntimeError('DOMAIN_RESTORE_COPY_SHORT_WRITE')
                view=view[written:]
        os.fsync(outgoing)
        if pin(os.fstat(incoming))!=before:raise RuntimeError('DOMAIN_RESTORE_COPY_SOURCE_CHANGED')
    finally:os.close(incoming);os.close(outgoing)
    if stable_digest(file,maximum)!=(expected,before) or stable_digest(target,maximum)[0]!=expected:raise RuntimeError('DOMAIN_RESTORE_COPY_CHANGED')
    parent=os.open(target.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(parent)
    finally:os.close(parent)
    return expected,before

def original_custody_closed(sql):
    if OWNER is None:return True
    if any(child.poll() is None for child in OWNER['children']):return False
    if OWNER.get('capture') is None:return True
    child,grant=OWNER['capture'];native=json.loads(stable(Path(grant['scope']['nativeDirectory'])/'deployment-runtime-native.json',262144)[0])
    return native['guardian']==OWNER['birth'] and native['onlineScope']['sha256']==grant['sha256'] and native['onlineScope']['scope']==grant['scope'] and native['phase']=='QUIESCENT' and native['nativeReaped'] and native['databaseQuiet'] and not native['stoppedBySignal'] and child.returncode==native['nativeStatus'] and sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='"+native['namespace']+"'")=='0' and sql("SELECT count(*) FROM pg_prepared_xacts WHERE database='"+grant['scope']['database']['name']+"'")=='0'

def read_capture_admission(root,grant):
    specification=importlib.util.spec_from_file_location('domain_restore_capture_admission',root/'online-capture-admission.py')
    module=importlib.util.module_from_spec(specification);specification.loader.exec_module(module)
    return module.CaptureAdmission(dict(scope=grant['scope'],sha256=grant['sha256'])).state()

def wait_original(child,logs,check):
    # A log/deadline problem is sticky but never authorizes losing the child.
    violation=False
    while child.poll() is None:
        violation=violation or any(file.stat().st_size>limit for file,limit in logs)
        time.sleep(.02)
    child.wait();check(not violation and all(file.stat().st_size<=limit for file,limit in logs),'DOMAIN_RESTORE_ORIGINAL_LOG_BOUND')

def sync_tree(root):
    for directory,_,files in os.walk(root,topdown=False):
        for name in files:
            fd=os.open(Path(directory)/name,os.O_RDONLY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd)
        fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd)

def _run(root,index,config,source,sql,history,write,check,role_client,domain,coherent):
    global OWNER
    check(OWNER is None,'DOMAIN_RESTORE_ORIGINAL_ALREADY_STARTED')
    definition=index['privateQualification']['domainRestore'];grant=definition['captureGrant'];destination=Path(definition['root']);database=definition['database'];oid=str(definition['databaseOid'])
    check(domain['format']=='sabalan-installed-domain-writers/v1','DOMAIN_RESTORE_ACTUAL_QUALIFICATION_REQUIRED')
    check(re.fullmatch(r'qa_application_native_[a-f0-9]{32}',database) and database not in [index['database'],index['restoredDatabase']],'DOMAIN_RESTORE_DATABASE_NOT_DISTINCT')
    existing=[*index['grants'],index['restoredGrant'],index['restoredBaselineGrant'],*index['privateQualification']['httpGrants'],index['privateQualification']['oldJobsGrant'],index['privateQualification']['jobsGrant']]
    check(grant['scope']['purpose']=='capture' and grant['scope']['database']['name']==index['restoredDatabase'] and all(grant['scope']['runtimeId']!=old['scope']['runtimeId'] and grant['scope']['nonce']!=old['scope']['nonce'] for old in existing),'DOMAIN_RESTORE_CAPTURE_GRANT_REUSED')
    baseline=definition['baselineGrant'];check(baseline['scope']['purpose']=='jobs' and baseline['scope']['database']['name']==database and baseline['scope']['runtimeId']!=grant['scope']['runtimeId'] and baseline['scope']['nonce']!=grant['scope']['nonce'],'DOMAIN_RESTORE_BASELINE_GRANT_INVALID')
    check(all(baseline['scope']['runtimeId']!=old['scope']['runtimeId'] and baseline['scope']['nonce']!=old['scope']['nonce'] for old in existing),'DOMAIN_RESTORE_BASELINE_GRANT_REUSED')
    check(sql("SELECT count(*) FROM pg_stat_activity WHERE datname='"+index['restoredDatabase']+"'")=='0' and sql("SELECT count(*) FROM pg_prepared_xacts WHERE database='"+index['restoredDatabase']+"'")=='0','DOMAIN_RESTORE_SOURCE_SQL_NOT_DRAINED')
    check(sql("SELECT oid FROM pg_database WHERE datname='"+database+"'")==oid,'DOMAIN_RESTORE_TARGET_DATABASE_CHANGED')
    OWNER=dict(children=[],capture=None,completed=False)
    app=Path(index['privateQualification']['qualificationRoot']);manifest_raw=stable(root/'restored-file-baseline.json',8*1024**2)[0];first_baseline=json.loads(manifest_raw)
    sources=[]
    for value in first_baseline['sources']:
        live,store=Path(value['liveRoot']),Path(value['storeRoot']);left,right=live.lstat(),store.lstat()
        check(live.resolve(strict=True)==live and store.resolve(strict=True)==store and stat.S_ISDIR(left.st_mode) and stat.S_ISDIR(right.st_mode),'DOMAIN_RESTORE_SOURCE_ROOT_UNSAFE')
        sources.append(dict(name=value['name'],path=str(live),device=str(left.st_dev),inode=str(left.st_ino),storeRoot=str(store),storeIdentity=dict(device=str(right.st_dev),inode=str(right.st_ino))))
    check(len(sources)==9 and len({row['name'] for row in sources})==9,'DOMAIN_RESTORE_NINE_ROOTS_REQUIRED')
    component=root/'installed-domain-coherent-component';component.mkdir(mode=0o700)
    parent_manifest,parent_pin=stable(root/'coherent-component/captured.json',8*1024**2);parent=json.loads(parent_manifest)
    check(parent['captureId']==coherent['captureId'] and coherent['passResult'] is True,'DOMAIN_RESTORE_PARENT_CAPTURE_CHANGED')
    parent_sqlite_file=root/'coherent-component'/parent['sqliteSnapshot']['file'];parent_sqlite,parent_sqlite_pin=stable_digest(parent_sqlite_file,512*1024**2)
    check(parent_sqlite['bytes']==parent['sqliteSnapshot']['bytes'] and parent_sqlite['sha256']==parent['sqliteSnapshot']['sha256'],'DOMAIN_RESTORE_PARENT_SQLITE_CHANGED')
    closure=coherent['inquiry']['sourceClosure'];source_native_file=Path(index['inquiryGrants']['source']['scope']['nativeDirectory'])/'deployment-runtime-native.json';source_native,source_native_pin=stable(source_native_file,262144)
    check(digest(source_native)==closure['nativeSha256'] and closure['nativeReaped'] and closure['sqliteNativeClosed'],'DOMAIN_RESTORE_PARENT_INQUIRY_NOT_CLOSED')
    # Preserve the original parent's inode proof; use a fresh immutable copy as
    # the canonical worker's required SQLite input, not a current Inquiry claim.
    sqlite_file=component/'reused-parent-inquiry.db';check(immutable_copy(parent_sqlite_file,sqlite_file,512*1024**2)==(parent_sqlite,parent_sqlite_pin),'DOMAIN_RESTORE_PARENT_SQLITE_COPY_CHANGED')
    sqlite_stat=sqlite_file.lstat();capture_id=os.urandom(32).hex();handshake=os.urandom(32).hex()
    scope=dict(format='sabalan-coherent-capture-scope/v3',captureId=capture_id,handshake=handshake,systemIdentifier=grant['scope']['database']['systemIdentifier'],databaseName=index['restoredDatabase'],storeRoot=None,sources=[{key:value[key] for key in ['name','path','device','inode','storeRoot']} for value in sources],inquiry=dict(path=str(sqlite_file),device=str(sqlite_stat.st_dev),inode=str(sqlite_stat.st_ino)),logicalDump=True,sealer=dict(script=str(root/'native-file-sealer.cjs'),sha256=digest(stable(root/'native-file-sealer.cjs',16*1024**2)[0]),stores=[dict(name=value['name'],**value['storeIdentity']) for value in sources]))
    write(component/'scope.json',encoded(scope));env=dict(os.environ,DATABASE_URL=urlunsplit(source._replace(path='/'+index['restoredDatabase'],query='connection_limit=2&pool_timeout=10')),PGHOST=source.hostname,PGPORT=str(source.port or 5432),PGUSER=unquote(source.username),PGPASSWORD=unquote(source.password),PGDATABASE='postgres',PGAPPNAME='installed-domain-second-restore',PGCONNECT_TIMEOUT='5',NODE_ENV='test',BACKEND_RUNTIME_ROLE='control',RECOVERY_COORDINATION_DIR=grant['scope']['coordinationDirectory'],BACKEND_ONLINE_SCOPE_FILE=grant['file'],BACKEND_ONLINE_SCOPE_SHA256=grant['sha256'],NODE_PATH='/app/node_modules')
    prior_admission,prior_admission_raw=read_capture_admission(root,grant)
    check(prior_admission['phase']=='OPEN','DOMAIN_RESTORE_CAPTURE_ADMISSION_CLOSED')
    out,err=component/'capture.stdout',component/'capture.stderr'
    with out.open('xb') as stdout,err.open('xb') as stderr:
        child=subprocess.Popen(['/usr/bin/python3','-I','-B',str(root/'online-runtime-owner.py'),'/usr/bin/python3','-I','-B',str(root/'application-native-capture.worker.py'),str(component/'scope.json')],env=env,stdin=subprocess.PIPE,stdout=stdout,stderr=stderr)
    OWNER['children'].append(child);OWNER['capture']=(child,grant);OWNER['birth']=birth(child.pid)
    frozen=None
    while frozen is None:
        check(out.stat().st_size<=262144 and err.stat().st_size<=1024**2,'DOMAIN_RESTORE_CAPTURE_LOG_BOUND')
        for line in out.read_bytes().splitlines():
            try:record=json.loads(line)
            except (ValueError,UnicodeError):continue
            if isinstance(record,dict) and record.get('phase')=='FROZEN':frozen=record
        check(frozen is not None or child.poll() is None,'DOMAIN_RESTORE_CAPTURE_FAILED_BEFORE_FROZEN')
        if frozen is None:time.sleep(.02)
    check(frozen['handshake']==handshake and len(frozen['versionedCuts'])==9,'DOMAIN_RESTORE_CAPTURE_FROZEN_CHANGED')
    active_raw=stable(Path(grant['scope']['nativeDirectory'])/'deployment-runtime-native.json',262144)[0];active=json.loads(active_raw)
    check(active['phase']=='ACTIVE' and active['guardian']==OWNER['birth'] and active['onlineScope']['sha256']==grant['sha256'],'DOMAIN_RESTORE_ORIGINAL_ACTIVE_BINDING_CHANGED')
    child.stdin.write(encoded(dict(phase='BEGIN_CAPTURE',handshake=handshake,versionedCuts=frozen['versionedCuts'])));child.stdin.flush();child.stdin.close()
    wait_original(child,[(out,262144),(err,1024**2)],check);check(child.returncode==0 and original_custody_closed(sql),'DOMAIN_RESTORE_CAPTURE_ORIGINAL_NOT_CLOSED')
    native_raw=stable(Path(grant['scope']['nativeDirectory'])/'deployment-runtime-native.json',262144)[0]
    native=json.loads(native_raw)
    scope_raw=stable(Path(grant['file']),262144)[0]
    check(digest(scope_raw)==grant['sha256'] and json.loads(scope_raw)==grant['scope'] and native['guardian']==OWNER['birth'] and native['activeClaimSha256']==digest(active_raw),'DOMAIN_RESTORE_CAPTURE_CLOSURE_BINDING_CHANGED')
    admission,admission_raw=read_capture_admission(root,grant)
    check(admission['phase']=='OPEN' and admission['generation']==prior_admission['generation']+2 and admission['closureSha256']==digest(native_raw) and admission['capture']==dict(runtimeId=grant['scope']['runtimeId'],scopeSha256=grant['sha256'],guardian=OWNER['birth']),'DOMAIN_RESTORE_CAPTURE_ADMISSION_NOT_REOPENED')
    namespace=native['namespace'];check(re.fullmatch(r'sabalan-rt-[a-f0-9]{48}',namespace),'DOMAIN_RESTORE_CAPTURE_NAMESPACE_INVALID')
    source_system=sql('SELECT system_identifier FROM pg_control_system()');source_oid=sql("SELECT oid FROM pg_database WHERE datname='"+index['restoredDatabase']+"'");visible=sql("SELECT (rolsuper OR pg_has_role(current_user,'pg_read_all_stats','MEMBER'))::text FROM pg_roles WHERE rolname=current_user")=='true'
    check(visible and source_system==grant['scope']['database']['systemIdentifier'] and source_oid==str(index['restoredOid']) and sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='"+namespace+"'")=='0' and sql("SELECT count(*) FROM pg_prepared_xacts WHERE database='"+index['restoredDatabase']+"'")=='0','DOMAIN_RESTORE_CAPTURE_FRESH_SQL_UNPROVEN')
    intent_raw=stable(component/'intent.json',262144)[0];intent=json.loads(intent_raw)
    check(intent['captureId']==capture_id and intent['scopeSha256']==digest(stable(component/'scope.json',262144)[0]) and intent['nativeClaimSha256']==digest(active_raw) and intent['namespace']==namespace,'DOMAIN_RESTORE_CAPTURE_INTENT_CHANGED')
    closure=dict(format='sabalan-original-confined-capture-closure/v1',purpose='capture',originalPopenPid=child.pid,originalReturncode=child.returncode,scopeSha256=grant['sha256'],runtimeId=grant['scope']['runtimeId'],namespace=namespace,activeClaimSha256=digest(active_raw),nativeRawBase64=base64.b64encode(native_raw).decode(),activeRawBase64=base64.b64encode(active_raw).decode(),scopeRawBase64=base64.b64encode(scope_raw).decode(),intentRawBase64=base64.b64encode(intent_raw).decode(),admissionBeforeRawBase64=base64.b64encode(prior_admission_raw).decode(),admissionAfterRawBase64=base64.b64encode(admission_raw).decode(),freshSql=dict(visible=True,systemIdentifier=source_system,databaseOid=source_oid,namespace=namespace,namespaceSessions=0,prepared=0))
    captured_raw=stable(component/'captured.json',8*1024**2)[0];captured=json.loads(captured_raw);check(captured['captureId']==capture_id and captured['versionedCuts']==frozen['versionedCuts'],'DOMAIN_RESTORE_CAPTURE_POINT_CHANGED')
    census_raw=stable(component/'registered-backend-boundary.json',8*1024**2)[0]
    check(captured['registeredBackendBoundarySha256']==digest(census_raw),'DOMAIN_RESTORE_CAPTURE_CENSUS_CHANGED')
    closure['censusRawBase64']=base64.b64encode(census_raw).decode()
    dump=component/captured['logicalDump']['file'];dump_identity,_=stable_digest(dump,1024**3);check(dump_identity=={key:captured['logicalDump'][key] for key in ['bytes','sha256']},'DOMAIN_RESTORE_DUMP_CHANGED')
    reader_spec=importlib.util.spec_from_file_location('installed_domain_independent_reader',root/'recovery-versioned-files.py');reader=importlib.util.module_from_spec(reader_spec);reader_spec.loader.exec_module(reader)
    check(not destination.exists(),'DOMAIN_RESTORE_TARGET_EXISTS');destination.mkdir(mode=0o700);versions=destination/'.versioned-files';versions.mkdir(mode=0o700);restored=[];baseline_sources=[]
    write(destination/'acceptance-seed.json',stable(app/'acceptance-seed.json',65536)[0],0o600)
    for cut,enrolled in zip(captured['versionedCuts'],sources):
        check(cut['name']==enrolled['name'],'DOMAIN_RESTORE_CUT_ORDER_CHANGED');target=component/('independent-'+cut['name']);receipt=reader.SealedVersionedFiles(cut['storeRoot'],cut['captureId'],cut['sha256']).restore(str(target));restored.append(receipt)
        relative=Path(enrolled['path']).relative_to(app);live=destination/relative;live.parent.mkdir(mode=0o700,parents=True,exist_ok=True);check(not live.exists(),'DOMAIN_RESTORE_ROOT_EXISTS');shutil.copytree(target/'files',live);sync_tree(live);store=versions/('root-'+str(len(baseline_sources)));store.mkdir(mode=0o700)
        baseline_sources.append(dict(name=cut['name'],liveRoot=str(live),storeRoot=str(store),cutSha256=cut['sha256'],restoreReceipt=dict(path=str(target/'complete.json'),sha256=digest(stable(target/'complete.json',8*1024**2)[0])),files=sorted(receipt['files'],key=lambda value:value['key'])))
    restore_out,restore_err=component/'pg-restore.stdout',component/'pg-restore.stderr'
    with restore_out.open('xb') as stdout,restore_err.open('xb') as stderr:
        restore=subprocess.Popen(['pg_restore','--no-owner','--no-privileges','--exit-on-error','-d',database,str(dump)],env=env,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr)
    OWNER['children'].append(restore);wait_original(restore,[(restore_out,1048576),(restore_err,1048576)],check);check(restore.returncode==0 and history(database)==history(index['restoredDatabase']),'DOMAIN_RESTORE_SQL_FAILED')
    baseline_manifest=component/'baseline.json';write(baseline_manifest,encoded(dict(format='sabalan-application-restored-file-baseline/v1',captureId=capture_id,capturedManifest=dict(path=str(component/'captured.json'),sha256=digest(captured_raw)),sources=baseline_sources)))
    baseline_done=role_client.request('RUN_PRIVATE_DOMAIN_BASELINE',dict(manifestPath=str(baseline_manifest),manifestSha256=digest(stable(baseline_manifest,8*1024**2)[0])),'PRIVATE_DOMAIN_BASELINE_DONE',baseline)
    baseline_proof=json.loads(stable(Path(str(baseline_manifest)+'.completed.json'),8*1024**2)[0]);check(baseline_proof['captureId']==capture_id and baseline_proof['runtimeId']==baseline['scope']['runtimeId'] and len(baseline_proof['proofs'])==9,'DOMAIN_RESTORE_BASELINE_UNPROVEN')
    expected=component/'domain-expectations.json';write(expected,encoded(domain))
    verified=role_client.request('VERIFY_PRIVATE_DOMAIN_RESTORE',dict(expectationsPath=str(expected),expectationsSha256=digest(stable(expected,8*1024**2)[0])),'PRIVATE_DOMAIN_RESTORE_VERIFIED')
    check(verified['result']['independentRestoreVerified'] is True and verified['result']['observerDisconnected'] is True,'DOMAIN_RESTORE_DOMAIN_UNPROVEN')
    for file,raw,pinned in [(root/'coherent-component/captured.json',parent_manifest,parent_pin),(source_native_file,source_native,source_native_pin)]:check(stable(file,max(len(raw),262144))==(raw,pinned),'DOMAIN_RESTORE_PARENT_PROVENANCE_CHANGED')
    check(stable_digest(parent_sqlite_file,512*1024**2)==(parent_sqlite,parent_sqlite_pin),'DOMAIN_RESTORE_PARENT_SQLITE_PROVENANCE_CHANGED')
    check(sql("SELECT oid FROM pg_database WHERE datname='"+database+"'")==oid and sql("SELECT count(*) FROM pg_stat_activity WHERE datname='"+database+"'")=='0' and sql("SELECT count(*) FROM pg_prepared_xacts WHERE database='"+database+"'")=='0','DOMAIN_RESTORE_TARGET_NOT_QUIET')
    OWNER['completed']=True
    return dict(format='sabalan-installed-domain-supplemental-restore/v1',passResult=True,productionAdmission=False,completeRecoveryPoint=False,reusedParentSqlite=True,sourceCaptureId=parent['captureId'],parentCapturedSha256=digest(parent_manifest),parentSqlite=dict(**parent_sqlite,device=str(parent_sqlite_pin[0]),inode=str(parent_sqlite_pin[1])),parentInquiryNativeSha256=digest(source_native),captureId=capture_id,capturedManifestSha256=digest(captured_raw),freshSourceDatabase=index['restoredDatabase'],restoredDatabase=database,restoredDatabaseOid=oid,restoredFileRoots=9,restoredFileCount=sum(len(value['files']) for value in restored),qualificationSha256=digest(encoded(domain)),captureScopeSha256=grant['sha256'],captureClosure=closure,baselineScopeSha256=baseline['sha256'],baselineProof=baseline_proof,baselineClosure=baseline_done['closure'],restoredDomain=verified['result'],restoredObserverClosure=verified['closure'],originalChildrenClosed=True,independentRestoreVerified=True)

def run(*args,**kwargs):
    try:
        return _run(*args,**kwargs)
    except BaseException:
        # Only terminate our own input stream, never another process. EOF lets
        # the original capture worker close its own transaction/descriptors on
        # a pre-handshake failure. Keep THIS controller and original handles
        # until every actual child exits; admission is never reset here.
        if OWNER is not None:
            if OWNER.get('capture') is not None:
                child,_grant=OWNER['capture']
                if child.stdin is not None and not child.stdin.closed:
                    try:child.stdin.close()
                    except BrokenPipeError:pass
            while any(child.poll() is None for child in OWNER['children']):time.sleep(.02)
            for child in OWNER['children']:child.wait()
        raise
