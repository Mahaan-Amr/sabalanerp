"""Retire only the proved closed failed drill's terminal containers/derived copy."""
import base64, fcntl, hashlib, importlib.util, itertools, json, os
from pathlib import Path
import stat, subprocess, sys, time

if sys.flags.optimize: raise RuntimeError('ASSERTIONS_REQUIRED')
ROOT = Path('/root/sabalan-recovery-private/native-qa/actual-image-customer-dd67e319494eb352c7fd8729eb5b3fa8')
QA = ROOT.parent
ACTIVE = QA / 'actual-image-customer-cleanup-active.json'
OPERATION = ROOT.name
BACKEND = 'e522d2a12bd5119c373c7035858cea6fc2e0427eb08f1cd442605ebd354f632b'
POSTGRES = 'a71ae8fbc0e6a95b06436dd25478effec6236d45d86fb4bedc0dd4aee72e7e83'
BASE_SHA = 'c4b485ccc756ea48e08a72ea9c8dbdfd00aa9d1a892c63b0788985f699957c09'
OWNER_SHA = 'c2b096894f7bdf920881c668deca48b1b7afedc4267956ed31e1743ed3687d83'
DOCKER = ['docker','--host','unix:///var/run/docker.sock']
mutated = closed = False
for name in ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']: os.environ.pop(name,None)

def require(value, reason):
    if not value: raise RuntimeError(reason)

def digest(path):
    before=path.lstat()
    require(path.resolve(strict=True)==path and stat.S_ISREG(before.st_mode) and before.st_nlink==1,'UNSAFE_FILE')
    checksum=hashlib.sha256()
    with path.open('rb') as stream:
        while chunk:=stream.read(1024**2): checksum.update(chunk)
    after=path.lstat()
    fields=lambda value:(value.st_dev,value.st_ino,value.st_size,value.st_mtime_ns,value.st_ctime_ns,value.st_mode,value.st_uid,value.st_nlink)
    require(fields(after)==fields(before),'FILE_CHANGED')
    return checksum.hexdigest()

def read(path):
    digest(path)
    return json.loads(path.read_text())

def sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)

def save(path, value):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
    try:
        with os.fdopen(fd,'wb',closefd=False) as stream:
            stream.write((json.dumps(value,sort_keys=True,indent=2)+'\n').encode());stream.flush();os.fsync(fd)
    finally: os.close(fd)
    sync(path.parent)

def docker(*args): return subprocess.check_output([*DOCKER,*args],text=True)
def inspect(identifier):
    rows=json.loads(docker('inspect',identifier))
    require(len(rows)==1 and rows[0]['Id']==identifier,'DAEMON_ID_CHANGED')
    return rows[0]

def native(args, token):
    path=ROOT/'docker-command-active.json'
    require(not path.exists(),'UNKNOWN_COMMAND')
    command={'token':token,'arguments':args,'phase':'ACTIVE'};save(path,command)
    env=dict(os.environ,SABALAN_NATIVE_STORAGE_ROOT=str(ROOT/'native-control'),
             SABALAN_NATIVE_STORAGE_MAX_BYTES='33554432',SABALAN_NATIVE_STORAGE_RESERVE_BYTES='1073741824')
    child=subprocess.Popen([str(ROOT/'native-owner'),'120',token,*args],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=env,pass_fds=(8,9))
    save(ROOT/(token+'-native-start.json'),{'pid':child.pid,'startTicks':Path('/proc/'+str(child.pid)+'/stat').read_text().rsplit(') ',1)[1].split()[19]})
    output=bytearray()
    with (ROOT/'native-control'/(token+'.log')).open('xb') as log:
        while chunk:=child.stdout.read(65536):
            require(len(output)+len(chunk)<=4*1024**2,'OUTPUT_BOUND');output.extend(chunk);log.write(chunk)
        status=child.wait();log.flush();os.fsync(log.fileno())
    require(output.endswith(('\nSABALAN_NATIVE_REAPED '+token+' '+str(status)+'\n').encode()),'NATIVE_CLOSURE_UNPROVEN')
    save(ROOT/(token+'-native-completion.json'),{'status':status,'outputSha256':hashlib.sha256(output).hexdigest()})
    require(status==0,'NATIVE_FAILED')
    return command,bytes(output)

def acknowledge(command):
    require(read(ROOT/'docker-command-active.json')==command,'COMMAND_CHANGED')
    os.rename(ROOT/'docker-command-active.json',ROOT/(command['token']+'-daemon-acknowledged.json'));sync(ROOT)

try:
    expected_inputs={'closed_process_references.py':'a6570121bc431553a3f215ccaf73063d642921501fe8ab1b7310a8ec4175ff4a',
                     'closed_diagnostic_holds.py':'543c507fcd97ac32310e0dc0e8e73cde391669075fbdd55d3f7870bdfdd80b36',
                     'retire-with-process-references.py':'9134926393675ea4846e4dd925ff6fc132a8592df009672767f081b33fa08b54'}
    inputs=globals().get('CLEANUP_INPUTS');require(isinstance(inputs,dict) and set(inputs)==set(expected_inputs),'CLEANUP_INPUTS_UNPROVEN')
    payloads={}
    for name,expected in expected_inputs.items():
        data=base64.b64decode(inputs[name],validate=True)
        require(len(data)<128*1024 and hashlib.sha256(data).hexdigest()==expected,'CLEANUP_SOURCE_CHANGED')
        compile(data,name,'exec');payloads[name]=data
    references={};exec(compile(payloads['closed_process_references.py'],'closed_process_references.py','exec'),references)
    holds={};exec(compile(payloads['closed_diagnostic_holds.py'],'closed_diagnostic_holds.py','exec'),holds)
    descriptors=[]
    for path,expected,target in [(Path('/root/sabalan-recovery-private/drill-ownership.lock'),(64513,13050),9),
                                 (Path('/run/lock/sabalan-backup-storage.lock'),(29,6),8)]:
        value=path.lstat();require(path.resolve(strict=True)==path and stat.S_ISREG(value.st_mode) and value.st_nlink==1 and value.st_uid==0 and not value.st_mode&0o022,'UNSAFE_LOCK')
        fd=os.open(path,os.O_RDWR|os.O_NOFOLLOW);require((os.fstat(fd).st_dev,os.fstat(fd).st_ino)==expected,'LOCK_CHANGED')
        descriptors.append((fcntl.fcntl(fd,fcntl.F_DUPFD_CLOEXEC,20),target));os.close(fd)
    for fd,target in descriptors: os.dup2(fd,target,inheritable=True);fcntl.flock(target,fcntl.LOCK_EX|fcntl.LOCK_NB)
    for directory in [QA.parent,QA,ROOT]:
        st=directory.lstat();require(directory.resolve(strict=True)==directory and stat.S_ISDIR(st.st_mode) and st.st_uid==0 and not st.st_mode&0o022,'UNSAFE_ROOT')
    reconciled_markers={ROOT/'ownership-held-unproven.json':'7a7404e2d780a37a89b9fbac73bd388f7a16a46cb3bb7ca948a498acda118f85'}
    hold_census=holds['assert_no_diagnostic_holds']([QA.parent,QA],ROOT,reconciled_markers)
    closure=read(ROOT/'failed-component-closed.json')
    require(closure['phase']=='FAILED_COMPONENT_CLOSED' and closure['originalOperation']==OPERATION
            and closure['controllerRetiredAfterClosure'] and closure['originalLocksReacquired']
            and closure['backendExitCode']==1 and closure['stopClientExitCode']==137
            and closure['dataAndContainersRetained'] and not closure['productionAdmission'] and not closure['healthyRecoveryPoint'],'FAILED_CLOSURE_UNPROVEN')
    require(Path('/proc/sys/kernel/random/boot_id').read_text().strip()==closure['bootId'],'BOOT_CHANGED')
    pid=Path('/proc')/str(closure['controllerPid'])
    if pid.exists():
        fields=(pid/'stat').read_text().rsplit(') ',1)[1].split()
        require(fields[19]!=closure['controllerStartTicks'] or fields[0]=='Z','ORIGINAL_CONTROLLER_LIVE')
    require(read(ROOT/'closed-failed-owner-intent.json')==closure['originalIntent']
            and read(ROOT/'closed-failed-stop-postgres-command.json')==closure['originalCommand'],'CLOSED_INTENT_CHANGED')
    evidence=closure['originalEvidence']
    for token,item in evidence['nativeHashes'].items():
        require(digest(ROOT/(token+'-native-start.json'))==item['start'] and digest(ROOT/(token+'-native-completion.json'))==item['completion']
                and digest(ROOT/'native-control'/(token+'.log'))==item['output'],'ORIGINAL_NATIVE_CHANGED')
    require(evidence['originalSqlCount']==0 and evidence['originalPreparedCount']==0
            and digest(ROOT/'pgdata/global/pg_control')==evidence['pgControlSha256'] and not (ROOT/'pgdata/postmaster.pid').exists(),'CLOSED_DATA_CHANGED')
    manifest=read(ROOT/'input-manifest.json')
    for name,item in manifest['files'].items():
        require('/' not in name and '\\' not in name and digest(ROOT/name)==item['sha256'],'ORIGINAL_INPUT_CHANGED')
    require(digest(ROOT/'native-owner')==OWNER_SHA,'NATIVE_OWNER_CHANGED')
    require(digest(ROOT/'mount_guard.py')=='165101a51ecc00db4b12ff65a5b2fe55f7037b4407ccdde5e799afa7bda54cd7','MOUNT_GUARD_CHANGED')
    spec=importlib.util.spec_from_file_location('guard',ROOT/'mount_guard.py');guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)
    guard.isolate_mount_namespace()
    targets=[ROOT/'pgdata',ROOT/'restore-input.tar'];derived={}
    reference_identities=set();entries=logical_bytes=0
    for target in targets:
        require(target.resolve(strict=True)==target and target.parent==ROOT,'DERIVED_PATH_CHANGED');guard.assert_no_nested_mounts(target)
        st=target.lstat();require(st.st_uid==70,'DERIVED_OWNER_CHANGED');derived[target.name]=[st.st_dev,st.st_ino]
        for entry in itertools.chain([target],target.rglob('*')) if target.is_dir() else [target]:
            value=entry.lstat()
            require(value.st_dev==st.st_dev and value.st_uid==70 and (stat.S_ISDIR(value.st_mode) or (stat.S_ISREG(value.st_mode) and value.st_nlink==1)),'UNSAFE_DERIVED_TREE')
            reference_identities.add((value.st_dev,value.st_ino));entries+=1
            if stat.S_ISREG(value.st_mode):logical_bytes+=value.st_size
            require(entries<=250000 and logical_bytes<=1536*1024**2,'DERIVED_TREE_BOUND')
    require((ROOT/'restore-input.tar').stat().st_size==378808320 and digest(ROOT/'restore-input.tar')==BASE_SHA,'DERIVED_COPY_CHANGED')
    source=QA/'production-base-restore-dbfc6b6eca9741469ae3076756b165a8/base.tar'
    require(digest(source)==BASE_SHA,'SOURCE_BASE_CHANGED')
    before={}
    for record in evidence['containers']:
        row=inspect(record['id']);state=row['State']
        require(row['Image']==record['image'] and row['Config']['Labels']['sabalan.drill.operation']==OPERATION
                and state['Status']=='exited' and state['ExitCode']==record['status'] and state['Pid']==0
                and not state['OOMKilled'] and not row.get('ExecIDs'),'ORIGINAL_DAEMON_CHANGED')
        before[record['id']]=row
    ids=docker('ps','-aq').split();rows=json.loads(docker('inspect',*ids)) if ids else []
    for row in rows:
        for mount in row.get('Mounts',[]):
            if mount.get('Type')!='bind':continue
            path=Path(mount['Source'])
            if any(path==target or path in target.parents or target in path.parents for target in targets):
                require(row['Id'] in before,'FOREIGN_DERIVED_REFERENCE')
    process_census=references['assert_no_process_references'](reference_identities)
    hold_census=holds['assert_no_diagnostic_holds']([QA.parent,QA],ROOT,reconciled_markers)
    if globals().get('EXECUTE_RETIREMENT') is not True:
        print(json.dumps({'phase':'CLOSED_FAILED_RETIREMENT_READY_READONLY','originalOperation':OPERATION,
                         'measuredClosedDerivedIdentities':derived,'processReferenceCensus':process_census,
                         'diagnosticHoldCensus':hold_census,'productionAdmission':False}));raise SystemExit(0)
    intent={'phase':'RETIRE_CLOSED_FAILED_DERIVED','originalOperation':OPERATION,'pid':os.getpid(),
            'startTicks':Path('/proc/self/stat').read_text().rsplit(') ',1)[1].split()[19],
            'failedClosureSha256':digest(ROOT/'failed-component-closed.json'),'productionAdmission':False}
    save(ACTIVE,intent);mutated=True
    for name,data in payloads.items():
        path=ROOT/name;fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o444)
        try:
            with os.fdopen(fd,'wb',closefd=False) as stream:stream.write(data);stream.flush();os.fsync(fd)
        finally:os.close(fd)
        require(digest(path)==expected_inputs[name],'INSTALLED_CLEANUP_SOURCE_CHANGED')
    sync(ROOT)
    save(ROOT/'measured-closed-derived-identities.json',{'identityBasis':'measured-after-proven-original-closure','identities':derived})
    for identifier in [BACKEND,POSTGRES]:
        require(identifier in before and inspect(identifier)['State']['Status']=='exited','TERMINAL_CONTAINER_CHANGED')
        command,_=native([*DOCKER,'rm',identifier],'closed-failed-rm-'+('backend' if identifier==BACKEND else 'postgres'))
        require(identifier not in docker('ps','-aq','--no-trunc').split(),'DAEMON_REMOVAL_UNPROVEN');acknowledge(command)
    save(ROOT/'daemon-closure.json',{'backendClosed':True,'postgresClosed':True,'taggedSqlCount':0,'preparedTransactionCount':0,
         'containersRemovedWithoutForce':True,'derivedIdentities':derived,'identityBasis':'measured-after-proven-original-closure',
         'failedClosureSha256':intent['failedClosureSha256'],'componentPassed':False})
    command,output=native(['python3','-I','-B',str(ROOT/'retire-with-process-references.py'),str(ROOT)],'retire-derived')
    results=[json.loads(line) for line in output.decode().splitlines() if line.startswith('{"exactDerivedPathsRetired":')]
    require(len(results)==1 and results[0]['exactDerivedPathsRetired'] and all(not p.exists() for p in targets),'DERIVED_RETIREMENT_UNPROVEN')
    require(digest(source)==BASE_SHA,'SOURCE_BASE_CHANGED')
    for record in evidence['containers']:require(inspect(record['image'])['Id']==record['image'],'SOURCE_IMAGE_CHANGED')
    acknowledge(command)
    result={'phase':'CLOSED_FAILED_DERIVED_RETIRED','originalOperation':OPERATION,'componentPassed':False,'backendExitCode':1,
            'stopClientExitCode':137,'retirement':results[0],'failedClosureSha256':intent['failedClosureSha256'],
            'originalEvidenceRetained':True,'productionAdmission':False,'healthyRecoveryPoint':False}
    save(ROOT/'closed-failed-retirement-proof.json',result)
    require(read(ACTIVE)==intent,'CLEANUP_INTENT_CHANGED');os.rename(ACTIVE,ROOT/'closed-failed-cleanup-owner-intent.json');sync(ROOT);sync(QA)
    closed=True;print(json.dumps(result))
except BaseException:
    if mutated and not closed:
        while True:time.sleep(1)
    raise
