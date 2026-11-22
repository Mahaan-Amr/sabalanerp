#!/usr/bin/env python3
"""Original engine-namespace local point owner, private duplex protocol only."""
import base64,fcntl,hashlib,importlib.util,json,os,queue,re,secrets,stat,sys,threading,time,urllib.parse
from pathlib import Path

def require(value,code):
    if not value:raise RuntimeError('LOCAL_ONLINE_DRIVER_'+code)
def raw(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def descriptor(value):return dict(rawBase64=base64.b64encode(value).decode(),bytes=len(value),sha256=sha(value))
def validate_installed_capture_bytes(body,expected):
    observed=json.loads(body);require(observed==expected,'INSTALLED_CAPTURE_HELPER_BYTES_CHANGED');return observed
def source_host(identity):
    # This QA host is Windows hardware with a Linux guardian. The original
    # Windows factory owns the fixed CIM child; this never claims container DMI.
    require(identity['scheme']=='WINDOWS_HARDWARE_UUID_WITH_LINUX_GUARDIAN_BOOT'and re.fullmatch('[a-f0-9]{64}',identity['machineUuidSha256']),'LOCAL_WINDOWS_HARDWARE_IDENTITY_REQUIRED')
    child=identity['originalWindowsProbe'];require(type(child['pid'])is int and child['pid']>0 and child['code']==0 and child['signal']is None and re.fullmatch('[a-f0-9]{64}',child['stdoutSha256']),'ORIGINAL_WINDOWS_PROBE_REQUIRED')
    boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip().lower();require(re.fullmatch('[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',boot)and boot!='00000000-0000-0000-0000-000000000000','REAL_GUARDIAN_BOOT_REQUIRED')
    return dict(machineUuidSha256=identity['machineUuidSha256'],kernelBootIdSha256=sha(boot.encode()))
def load(file,name):
    spec=importlib.util.spec_from_file_location(name,file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

class PrivateProtocol:
    def __init__(self,operation):
        self.operation=operation;self.commands=queue.Queue();self.responses={};self.condition=threading.Condition();self.output=threading.Lock();self.error=None
        self.reader=threading.Thread(target=self.read,name='original-local-command-reader');self.reader.start()
    def emit(self,event,**value):
        with self.output:sys.stdout.buffer.write(raw(dict(event=event,operation=self.operation,**value)));sys.stdout.buffer.flush()
    def read(self):
        try:
            while True:
                line=sys.stdin.buffer.readline(32*1024*1024+1)
                if not line:
                    with self.condition:self.error='ORIGINAL_INPUT_EOF';self.condition.notify_all()
                    self.commands.put(None);return
                require(len(line)<=32*1024*1024 and line.endswith(b'\n'),'INPUT_BOUND');value=json.loads(line)
                if value.get('format')=='sabalan-original-local-online-rpc-result/v1':
                    with self.condition:
                        require(set(value)=={'format','rpcId','result'}and value['rpcId']in self.responses and self.responses[value['rpcId']]is None,'RPC_SEQUENCE')
                        self.responses[value['rpcId']]=value['result'];self.condition.notify_all()
                else:
                    require(set(value)=={'format','sequence','command'}and value['format']=='sabalan-original-local-online-command/v1'and value['command']in('POINT','TICK','FINISH_POINT_ONLY'),'FIXED_COMMAND');self.commands.put(value)
        except BaseException:
            with self.condition:self.error='ORIGINAL_INPUT_INVALID';self.condition.notify_all()
            self.commands.put(None)
    def rpc(self,command,value):
        identifier=secrets.token_hex(16)
        with self.condition:self.responses[identifier]=None
        self.emit('RPC',rpcId=identifier,command=command,input=value)
        with self.condition:
            while self.responses[identifier]is None:
                require(self.error is None,'RPC_ORIGINAL_INPUT_UNKNOWN');self.condition.wait(.2)
            return self.responses.pop(identifier)

def main():
    require(os.getuid()==0 and sys.platform=='linux'and len(sys.argv)==1,'ORIGINAL_LINUX_ENTRY')
    line=sys.stdin.buffer.readline(32*1024*1024+1);require(line.endswith(b'\n')and len(line)<=32*1024*1024,'INITIAL_BOUND');header=json.loads(line)
    stage=Path(header['originalEntry']['sourceRootNative']);require(Path(__file__).resolve(strict=True)==stage/'local-online-checkpoint-driver.py'and stage.stat().st_uid==0 and stage.stat().st_mode&0o777==0o700,'PRIVATE_NATIVE_STAGE')
    for relative,wanted in header['sourcePins'].items():require(sha((stage/Path(relative).name).read_bytes())==wanted,'SOURCE_PIN_CHANGED')
    plan=header['capturePlanData'];require(plan['format']=='sabalan-original-local-online-capture-plan/v1'and re.fullmatch(r'qa_application_(?:native|restored)_[a-f0-9]{32}',plan['database']['name']),'ORIGINAL_CAPTURE_PLAN')
    p=load(stage/'online-checkpoint-producer.py','local_original_producer');h=load(stage/'online-local-host-runtime.py','local_original_host');runtime=h.validate(header['runtimeQualification']['descriptor'])
    protocol=PrivateProtocol(header['operation']);owned=None;manager=None
    controller_root=stage/'controller';controller_root.mkdir(mode=0o700)
    placeholder=os.fstat(9);require(stat.S_ISCHR(placeholder.st_mode)and header['originalEntry']['reservedFd9']==dict(device=placeholder.st_dev,inode=placeholder.st_ino,mode=placeholder.st_mode,rdev=placeholder.st_rdev),'ORIGINAL_FD9_PLACEHOLDER_REQUIRED')
    lock=controller_root/'original-deployment.lock';fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_RDWR,0o600)
    require(fd!=9 and (os.fstat(9).st_dev,os.fstat(9).st_ino,os.fstat(9).st_mode,os.fstat(9).st_rdev)==(placeholder.st_dev,placeholder.st_ino,placeholder.st_mode,placeholder.st_rdev),'FD9_PLACEHOLDER_CHANGED')
    if fd!=9:os.dup2(fd,9);os.close(fd)
    fcntl.flock(9,fcntl.LOCK_EX|fcntl.LOCK_NB);lock_identity=(os.fstat(9).st_dev,os.fstat(9).st_ino)
    expected=sorted(row['id']for row in plan['originalServiceIdentities'].values())
    def ownership():
        require((os.fstat(9).st_dev,os.fstat(9).st_ino)==lock_identity,'ORIGINAL_FD9_CHANGED')
        for relative,wanted in header['sourcePins'].items():require(sha((stage/Path(relative).name).read_bytes())==wanted,'SOURCE_PIN_CHANGED')
    children=p.OriginalChildren(controller_root,ownership,retained_fds=(9,));counter=0
    def run(arguments,maximum=4*1024*1024):
        nonlocal counter
        counter+=1;child=children.start('preflight-'+str(counter),arguments,maximum=maximum);return children.finish(child,maximum)
    compose='/mnt/host/d/sabalanerp/docker-compose.local.yml'
    local_context=None
    if 'localDevSuspension'in plan:
        require('localDevCaptureScope'in plan and plan['localDevCaptureScope']['selection']==plan['localDevSuspension'],'LOCAL_DEV_PLAN_SCOPE_REQUIRED')
        local_context=dict(project='sabalanerp-local',database=plan['database'],capture=dict(runtimeId=plan['grant']['scope']['runtimeId'],scopeSha256=plan['grant']['sha256']),composeSha256=p.source_sha(compose),localDevSuspension=plan['localDevCaptureScope'],helpers=dict(localDevSuspension=dict(file=str(stage/'local-dev-frontend-suspension.py'),sha256=header['sourcePins']['deploy/scripts/local-dev-frontend-suspension.py']),suspensionOwner=dict(file=str(stage/'run-local-dev-frontend-suspension.mjs'),sha256=header['sourcePins']['scripts/run-local-dev-frontend-suspension.mjs']),suspensionVerifier=dict(file=str(stage/'local-dev-frontend-suspension.mjs'),sha256=header['sourcePins']['scripts/lib/local-dev-frontend-suspension.mjs'])))
        p.local_dev_validator(local_context)
    else:require('localDevCaptureScope'not in plan,'LOCAL_DEV_UNSELECTED_SCOPE_REFUSED')
    def census():
        body=run([*runtime['docker'],'compose','-f',compose,'-p','sabalanerp-local','ps','--all','--no-trunc','--format','json']);rows=json.loads(body)if body.lstrip().startswith(b'[')else[json.loads(x)for x in body.splitlines()if x];p.validate_census(rows,expected,'sabalanerp-local',local_context=local_context)
        if local_context is not None:p.inspect_local_dev_suspension(local_context,lambda args:run([*runtime['docker'],*args]))
    def docker(arguments):census();return run([*runtime['docker'],*arguments])
    try:
        inspected=json.loads(docker(['inspect',*expected]));candidate=next(x for x in inspected if x['Config']['Labels']['com.docker.compose.service']=='backend-candidate');pg=next(x for x in inspected if x['Config']['Labels']['com.docker.compose.service']=='postgres')
        require({k:plan['backend'][k]for k in('containerId','image','startedAt')}==dict(containerId=candidate['Id'],image=candidate['Image'],startedAt=candidate['State']['StartedAt']),'BACKEND_CHANGED')
        def mapped(path,write=False):
            matches=[x for x in candidate['Mounts']if path.startswith(x['Destination'].rstrip('/')+'/')and(not write or x['RW'])]
            require(matches,'HOST_PATH_NOT_MOUNTED');matches.sort(key=lambda x:len(x['Destination']),reverse=True);mount=matches[0];value=Path(mount['Source'])/str(Path(path).relative_to(mount['Destination']));require(value.resolve(strict=True)==value,'HOST_PATH_ALIAS');return value
        grant=plan['grant'];scope=grant['scope'];require(scope['purpose']=='capture'and scope['database']=={k:plan['database'][k]for k in('name','systemIdentifier')},'CAPTURE_SCOPE_CHANGED')
        grant_file=mapped(grant['file']);require(sha(p.private_bytes(grant_file,immutable=True))==grant['sha256'],'RO_CAPTURE_AUTHORITY_MISSING')
        runtime_root=scope['coordinationDirectory'].rstrip('/')+'/online/checkpoints/'+secrets.token_hex(32);parent=mapped(scope['coordinationDirectory'],True)/'online'/'checkpoints';parent.mkdir(mode=0o700,parents=True,exist_ok=True);root=parent/Path(runtime_root).name;root.mkdir(mode=0o700)
        networks=[row['IPAddress']for name,row in candidate['NetworkSettings']['Networks'].items()if name.startswith('sabalanerp-local')and row['IPAddress']];require(len(networks)==1,'PRIVATE_NETWORK_IDENTITY')
        env=dict(x.split('=',1)for x in candidate['Config']['Env']if'='in x);url=urllib.parse.urlsplit(env['DATABASE_URL']);database_url=urllib.parse.urlunsplit(url._replace(path='/'+plan['database']['name'],query='connection_limit=2&pool_timeout=10'))
        pg_env=dict(x.split('=',1)for x in pg['Config']['Env']if'='in x);user=pg_env['POSTGRES_USER'];require(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',user),'POSTGRES_USER')
        entry='/app/dist/scripts/sealNativeVersionedFiles.js';entry_sha=docker(['exec',candidate['Id'],'/usr/bin/python3','-I','-B','-c',"import hashlib;print(hashlib.sha256(open("+repr(entry)+",'rb').read()).hexdigest())"]).decode().strip();require(re.fullmatch('[a-f0-9]{64}',entry_sha),'SEALER_ENTRY')
        installed_names=('online-runtime-owner.py','capture-coherent-components.py','capture-coordination-history.py','online-runtime-scope.py','online-backend-boundary.py','online-inquiry-boundary.py','recovery-database-freeze.py','coherent-versioned-file-cuts.py','recovery-versioned-files.py','native-versioned-file-sealer.py','recovery-file-generations.py','online-checkpoint-inventory.py','online-checkpoint-coverage.py','receive-postgres-wal.py')
        installed_expected={name:header['sourcePins']['deploy/scripts/'+name]for name in installed_names}
        installed_raw=docker(['exec',candidate['Id'],'/usr/bin/python3','-I','-B','-c',"import hashlib,json;print(json.dumps({n:hashlib.sha256(open('/app/scripts/'+n,'rb').read()).hexdigest()for n in "+repr(installed_names)+"}))"]);installed_actual=validate_installed_capture_bytes(installed_raw,installed_expected)
        require(installed_actual==installed_expected,'INSTALLED_CAPTURE_HELPER_BYTES_CHANGED');installed_child=children.children[-1];installed_proof=dict(format='sabalan-original-local-installed-capture-helpers/v1',containerId=candidate['Id'],image=candidate['Image'],files=installed_actual,originalPid=installed_child.process.pid,returncode=installed_child.process.returncode,signal=None,stdout=descriptor(installed_raw))
        host=source_host(header['sourceHostIdentity']);require(host['kernelBootIdSha256']==header['originalEntry']['kernelBootIdSha256'],'ENTRY_BOOT_CHANGED')
        # Signature verification remains the real fixed host executable, never a label.
        require(Path('/usr/bin/openssl').is_file()and os.access('/usr/bin/openssl',os.X_OK),'HOST_OPENSSL_UNAVAILABLE')
        helpers={key:dict(file=str(stage/name),sha256=sha((stage/name).read_bytes()))for key,name in dict(receiver='receive-postgres-wal.py',base='capture-postgres-base.py',owner='online-runtime-owner.py',capture='capture-coherent-components.py',supervisor='native-process-owner',coverage='online-checkpoint-coverage.py',reader='recovery-versioned-files.py',inventory='online-checkpoint-inventory.py',producer='online-checkpoint-producer.py',localRuntime='online-local-host-runtime.py').items()}
        sources=[dict(name='retained-'+str(i).zfill(2),path=row['live'],device=row['liveDevice'],inode=row['liveInode'],storeRoot=row['store'])for i,row in enumerate(plan['roots'])];require(len(sources)==9,'NINE_ACTUAL_ROOTS')
        stores=[dict(name=source['name'],device=str(row['storeDevice']),inode=str(row['storeInode']))for source,row in zip(sources,plan['roots'])]
        config=dict(format='sabalan-original-online-checkpoint-producer/v1',project='sabalanerp-local',root=str(root),runtimeRoot=runtime_root,captureId=Path(runtime_root).name,operationId='online-'+header['operation'],targetCommit=scope['sourceCommit'],database=plan['database'],databaseUrl=database_url,backend=dict(containerId=candidate['Id'],image=candidate['Image'],startedAt=candidate['State']['StartedAt'],privateAddress=networks[0]),postgres=dict(containerId=pg['Id'],image=pg['Image'],startedAt=pg['State']['StartedAt'],user=user),expectedContainerIds=expected,composeFile=compose,composeSha256=p.source_sha(compose),dockerSha256=p.source_sha(runtime['docker'][0]),lockFile=str(lock),helpers=helpers,localHostRuntime=header['runtimeQualification']['descriptor'],capture=dict(runtimeId=scope['runtimeId'],scope=scope,scopeFile=str(grant_file),runtimeScopeFile=grant['file'],scopeSha256=grant['sha256'],nativeDirectoryHost=str(mapped(scope['nativeDirectory'])),boundaryDirectoryHost=str(mapped(scope['boundaryDirectory']))),sources=sources,inquiry=plan['inquiry'],inquiryRuntimeIds=plan['inquiryRuntimeIds'],sealer=dict(entrySha256=entry_sha,stores=stores),qualificationPublicKeySha256=sha((stage/'qualification-public-key.pem').read_bytes()))
        if local_context is not None:
            config['localDevSuspension']=local_context['localDevSuspension'];config['helpers'].update(local_context['helpers'])
        configuration=controller_root/'original-input.json';p.publish(configuration,config);owner_root=controller_root/'owner';owner_root.mkdir(mode=0o700);module=load(stage/'local-online-checkpoint-owner.py','local_original_owner');owned=module.create_original_local_checkpoint_owner(producer_module=p,configuration_file=str(configuration),configuration_sha256=sha(raw(config)),controller_source=str(stage/'local-online-checkpoint-controller.worker.cjs'),controller_sha256=sha((stage/'local-online-checkpoint-controller.worker.cjs').read_bytes()),owner_directory=str(owner_root))
        class Ports:
            def read_original_continuous_context(self,runtime_id):return owned.read_original_continuous_context(runtime_id)
            def read_original_qualification_public_key_path(self):return str(stage/'qualification-public-key.pem')
            def seal_original_wal_window(self,value):return self.seal('SEAL_WAL',value)
            def seal(self,command,value):
                result=protocol.rpc(command,value);body=base64.b64decode(result['rawBase64'],validate=True);require(len(body)==result['bytes']and sha(body)==result['sha256'],'CRYPTO_RESPONSE_BYTES');receipt=Path(result['runtimeReceipt']);require(receipt.is_absolute(),'CRYPTO_RUNTIME_RECEIPT');observed=p.private_bytes(mapped(str(receipt)),64*1024*1024);require(observed==body,'CRYPTO_RUNTIME_READBACK');return body
            def verify_original_wal_window(self,request,sealed):
                directory=Path(sealed);seal=p.private_bytes(directory/'seal-state.json');capture=p.private_bytes(directory.parent/'capture-state.json');result=protocol.rpc('VERIFY_WAL',dict(request=request,sealRawBase64=base64.b64encode(seal).decode(),captureRawBase64=base64.b64encode(capture).decode(),sourceRuntimeId=scope['runtimeId']));body=base64.b64decode(result['rawBase64'],validate=True);require(len(body)==result['bytes']and sha(body)==result['sha256'],'WINDOW_CERTIFICATE_BYTES');return body
        ports=Ports();coverage=load(stage/'continuous-online-wal-owner.py','local_original_coverage')
        protocol.emit('READY',sourceHost=host,sourceHostIdentity=header['sourceHostIdentity'],installedCaptureHelpers=installed_proof,backend=config['backend'],database=plan['database']);sequence=0
        while True:
            command=protocol.commands.get();require(command is not None and command['sequence']==sequence+1,'COMMAND_SEQUENCE');sequence+=1;name=command['command']
            if name=='POINT':
                require(manager is None,'POINT_ALREADY_STARTED');manager=coverage.startOriginalOnlineWalCoverage(owned.producer,ports,p);owned.manager=manager;point=manager.checkpoint();producer=point['point'];producer_file=root/'original-point-result.json';p.publish(producer_file,producer);sealed=ports.seal('SEAL_POINT',dict(componentManifestFile=producer['manifestRuntimeFile'],componentManifestSha256=producer['manifestSha256']));component=owned.producer.original_point['component'];result=dict(producer=producer,ownedOutputs=dict(producer=descriptor(producer_file.read_bytes()),plaintextManifest=descriptor(p.private_bytes(Path(producer['manifestFile']),16*1024*1024)),sealedManifest=descriptor(sealed),captured=descriptor(p.private_bytes(component/'captured.json',16*1024*1024)),coverage=descriptor(p.private_bytes(root/'coverage.json',16*1024*1024))),liveCoverage=point['liveCoverage'],sourceHost=host,sourceHostIdentity=header['sourceHostIdentity'],installedCaptureHelpers=installed_proof,postgresUser=user)
            elif name=='TICK':require(manager is not None,'POINT_NOT_STARTED');result=manager.tick()
            else:
                require(manager is not None,'POINT_NOT_STARTED');result=dict(pointOnly=manager.finish_point_only_qualification(),owner=owned.close_original());require(children.closed(),'PREFLIGHT_ORIGINAL_CHILDREN_UNKNOWN');protocol.emit('COMMAND_COMPLETED',sequence=sequence,command=name,result=result);protocol.emit('CLOSED',result=result);protocol.reader.join();require(protocol.error=='ORIGINAL_INPUT_EOF','INPUT_CLOSE_REQUIRED');fcntl.flock(9,fcntl.LOCK_UN);os.close(9);return
            protocol.emit('COMMAND_COMPLETED',sequence=sequence,command=name,result=result)
    except BaseException as error:
        protocol.emit('UNKNOWN_HELD',reason=type(error).__name__+':'+str(error)[:180]if str(error).startswith('LOCAL_')else type(error).__name__)
        # The same original handles and FD9 remain retained on any unresolved path.
        while True:time.sleep(1)

if __name__=='__main__':main()
