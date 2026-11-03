"""Finite image owner, invoked only as the SAME retained Root's direct child.

The containing Root owns genuine LOCAL/FULL tokens. JSON chooses no commands,
keys, services or sources; live request/ACK supplies fresh per-phase inputs.
"""
import hashlib,json,os,pathlib,secrets,signal,stat,sys

REPO=pathlib.Path('C:/Users/mahan/.codex/worktrees/native-c3-execution-419/sabalanerp')
Q=pathlib.Path('D:/sabalanerp-online-qa')
FILES={
 'custody':'original-image-owner-custody.py',
 'backendSource':'original-c3-backend-stream-source.py',
 'backendOwner':'original-c3-backend-stream-owner.py',
 'backendMaterial':'original-c3-backend-stream-material.py',
 'repositorySource':'original-image-repository-source.py',
 'repositoryChannel':'original-image-repository-channel.py',
 'repositoryRemote':'original-image-repository-remote.py',
 'repositoryTransport':'original-image-repository-transport.py'}


def read(ref,maximum=8*1024**2):
    file=pathlib.Path(ref['file']);a=file.lstat()
    assert file.resolve(strict=True)==file and stat.S_ISREG(a.st_mode) and a.st_nlink==1 and 0<a.st_size<=maximum
    shape=lambda s:tuple(getattr(s,k) for k in ['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_mode','st_nlink'])
    cross=lambda s:tuple(getattr(s,k) for k in ['st_ino','st_size','st_mtime_ns','st_mode','st_nlink'])
    with file.open('rb') as stream:
        held=os.fstat(stream.fileno());assert cross(held)==cross(a)
        raw=stream.read(maximum+1);assert len(raw)==a.st_size and shape(held)==shape(os.fstat(stream.fileno()))
    assert shape(a)==shape(file.lstat()) and hashlib.sha256(raw).hexdigest()==ref['sha256']
    return raw


def execute(raw,file,name):
    scope=dict(__file__=str(file),__name__=name);exec(compile(raw,str(file),'exec'),scope);return scope


def save(file,value):
    raw=(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
    fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_BINARY',0),0o600)
    try:
        offset=0
        while offset<len(raw):count=os.write(fd,raw[offset:]);assert count>0;offset+=count
        os.fsync(fd)
    finally:os.close(fd)
    return dict(file=str(file),sha256=hashlib.sha256(raw).hexdigest())


def emit(value):
    raw=(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode();assert len(raw)<=65536
    assert sys.stdout.buffer.write(raw)==len(raw);sys.stdout.buffer.flush()


def phase_negative_closed(value,directory):
    """Strict finite closure only; interruption/observation faults stay HELD."""
    if value.get('format') not in ['sabalan-c3-backend-stream-phase-negative/v1','sabalan-c3-image-capacity-negative/v1'] or value.get('interrupted') is not False:return False
    rows=value.get('originalClosures')
    if not isinstance(rows,list) or not rows:return False
    for reference in rows:
        if not isinstance(reference,dict) or set(reference)!={'file','sha256'} or pathlib.Path(reference['file']).parent!=pathlib.Path(directory):return False
        try:row=json.loads(read(reference))
        except (OSError,ValueError,AssertionError):return False
        if row.get('format')!='sabalan-secret-stdin-original-closure/v1':return False
        if type(row.get('originalPid')) is not int or row['originalPid']<=0 or type(row.get('code')) is not int:return False
        if not(row['code']==0 or row.get('phase')=='validateArchive' and row['code']==1):return False
        if row.get('signal') is not None or row.get('stdoutEof') is not True or row.get('stderrEof') is not True:return False
        if row.get('localInterrupted') is not False or row.get('interrupted',False) is not False:return False
        if row.get('observationFaults')!=[] or row.get('observationFaultCounts')!={} or row.get('observationFaultTotal')!=0:return False
        if row.get('observationFaultLogOverflow') is not False or row.get('cancellations')!=[]:return False
        if row.get('killed',False) is not False or row.get('outputBoundExceeded',False) is not False:return False
    return True


def main(configuration):
    assert os.name=='nt' and not sys.flags.optimize
    config=json.loads(read(configuration))
    assert set(config)=={'format','operation','rootOperation','parent','sources','auditDirectory','retirement','content','productionAdmission'}
    assert config['format']=='sabalan-c3-image-repository-owner-input/v1' and config['productionAdmission'] is False
    operation=config['operation'];root_operation=config['rootOperation']
    import re
    assert re.fullmatch('[a-f0-9]{32}',operation) and re.fullmatch('[a-f0-9]{32}',root_operation)
    audit=pathlib.Path(config['auditDirectory']);assert audit==Q/('419-image-repository-'+operation)
    assert audit.resolve(strict=True)==audit and audit.is_dir() and not any(audit.iterdir())
    assert pathlib.Path(config['parent']['lockFile'])==Q/'deployment.lock'
    retirement=config['retirement'];assert retirement['rootOperation']==root_operation
    assert retirement['originalOwnerClosed'] is True and retirement['localJobRetired'] is True and retirement['backupTransferRetired'] is True
    assert retirement['productionAdmission'] is False
    assert set(config['sources'])==set(FILES)
    raw={};modules={}
    for name,file in FILES.items():
        ref=config['sources'][name];assert pathlib.Path(ref['file'])==REPO/'deploy/scripts'/file
        raw[name]=read(ref)
    for name in ['custody','backendSource','backendOwner','backendMaterial','repositorySource','repositoryChannel','repositoryTransport']:
        modules[name]=execute(raw[name],config['sources'][name]['file'],'same_original_image_'+name)
    custody=modules['custody']['ParentCustody'](config['parent'])
    interrupted=[];handlers={};password=None;phases=[];backend_component=None;repository=None;failure=None;custody_known=True
    def cancel(number,_frame):
        if number not in interrupted:interrupted.append(number)
    class Guard:
        def assert_current(self):
            custody.assert_current();assert not interrupted,'IMAGE_OWNER_INTERRUPTED'
    guard=Guard()
    def revalidate_sources():
        guard.assert_current()
        for name,ref in config['sources'].items():assert read(ref)==raw[name]
    try:
        for number in [signal.SIGINT,signal.SIGTERM]:handlers[number]=signal.signal(number,cancel)
        guard.assert_current()
        emit(dict(format='sabalan-r9-master-private-credential-ready/v1',operation=operation,credentialsRead=False,productionAdmission=False))
        credential_raw=bytearray(sys.stdin.buffer.readline(16385));assert credential_raw.endswith(b'\n') and len(credential_raw)<=16384
        frame=json.loads(credential_raw)
        credential_raw[:]=b'\0'*len(credential_raw)
        assert set(frame)=={'format','operation','credential'} and frame['format']=='sabalan-r9-master-private-credential/v1' and frame['operation']==operation
        password=frame.pop('credential');assert isinstance(password,str) and 0<len(password)<=4096 and not any(c in password for c in '\r\n\0')
        content=config['content'];assert content['format']=='sabalan-c3-deployment-image-content/v1'
        assert content['backendCipherRequired'] is True and content['retrievalProven'] is False and content['productionAdmission'] is False
        assert content['images']['backend']['graph']==modules['backendSource']['component']()['archiveGraph']
        encryption=None;local=None
        for sequence,stage in enumerate(('BACKEND_ENCRYPT','BACKEND_LOCAL_VERIFY','BACKUP_STORE'),1):
            revalidate_sources();challenge=secrets.token_hex(32)
            wanted=dict(format='sabalan-image-repository-owner-request/v1',operation=operation,sequence=sequence,stage=stage,challenge=challenge)
            emit(wanted)
            ack_raw=sys.stdin.buffer.readline(65537);assert ack_raw.endswith(b'\n') and len(ack_raw)<=65536
            ack=json.loads(ack_raw);expected=dict(wanted,format='sabalan-image-repository-owner-ack/v1')
            result=ack.pop('result');assert ack==expected
            assert set(result)=={'format','operation','stage','configuration','productionAdmission'}
            assert result['format']=='sabalan-image-repository-phase-plan/v1' and result['operation']==operation and result['stage']==stage and result['productionAdmission'] is False
            ref=result['configuration'];file=pathlib.Path(ref['file']);assert file.parent==pathlib.Path(configuration['file']).parent
            phase=json.loads(read(ref));assert set(phase)=={'format','operation','rootOperation','stage','productionInputs','productionAdmission'}
            assert phase['format']=='sabalan-c3-image-repository-phase-input/v1' and phase['operation']==operation and phase['rootOperation']==root_operation and phase['stage']==stage and phase['productionAdmission'] is False
            guard.assert_current()
            kind={'BACKEND_ENCRYPT':'encrypt-existing','BACKEND_LOCAL_VERIFY':'local-decrypt','BACKUP_STORE':'capacity-only'}[stage]
            custody_known=False
            material=modules['backendMaterial']['materialize'](phase['productionInputs'],operation,kind,guard,modules['backendSource'],modules['backendOwner'],raw['backendSource'],encryption if kind=='local-decrypt' else None)
            custody_known=True
            owned=execute(read(material['ownedFunction']),material['ownedFunction']['file'],'same_original_backend_'+kind)
            custody_known=False
            try:receipt=owned['run_capacity' if kind=='capacity-only' else 'run'](guard)
            except BaseException:
                negative_file=pathlib.Path(material['binding']['output'])/('capacity-negative.json' if kind=='capacity-only' else 'phase-negative.json')
                if negative_file.is_file():
                    reference=dict(file=str(negative_file),sha256=hashlib.sha256(negative_file.read_bytes()).hexdigest())
                    negative=json.loads(read(reference));custody_known=phase_negative_closed(negative,negative_file.parent)
                    phases.append(dict(stage=stage,negativeReceipt=reference,originalCustodyKnown=custody_known))
                raise
            custody_known=True
            value=json.loads(read(receipt));phases.append(dict(stage=stage,receipt=receipt))
            revalidate_sources()
            assert value['allOriginalChildrenClosed'] is True and value['productionAdmission'] is False
            if stage=='BACKEND_ENCRYPT':encryption=receipt
            elif stage=='BACKEND_LOCAL_VERIFY':
                local=receipt;enc=json.loads(read(encryption));assert value['remote']['native']['result']['gcmAuthenticated'] is True
                backend_component=save(audit/'backend-content-local-verified.json',dict(format='sabalan-c3-backend-closed-crypto-content/v1',component=enc['component'],cipher=enc['streamOutput'],encryption=encryption,localVerification=local,localDecryptVerified=True,independentDecryptVerified=False,allOriginalChildrenClosed=True,productionAdmission=False))
            else:
                assert encryption is not None and local is not None
                enc=json.loads(read(encryption));images={role:dict(image=row['graph']['index'],gzip=row['gzip'],cipher=row['cipher'],archiveGraph=row['graph']) for role,row in content['images'].items()}
                images['backend']['cipher']=enc['streamOutput']
                source=modules['repositorySource']['build'](operation,retirement['operation'],images,value['remote'],phase['productionInputs']['observedAt'],modules['backendSource'],raw['repositoryChannel'],raw['repositoryRemote'])
                helper_file=Q/'C30-strict-complete-actual-plan-source-r9-full-capsule-observer-20261025/backup_credential.py'
                helper_raw=modules['backendSource']['pinned'](helper_file,'2d7114304b5b31647a91b4d6fdfaa281de6e4d3ddcfbec4be962ecd2f85b321d')
                helper=execute(helper_raw,helper_file,'same_original_backup_credential')
                review=modules['backendSource']['captured_sources'](modules['backendSource']['REVIEW'],modules['backendSource']['REVIEW_SHA'])
                core_source=modules['backendSource']['execute_source'](review['build-original.py'],modules['backendSource']['REVIEW']/'build-original.py','same_original_image_collector_source')['build']().decode()
                core_source=modules['backendSource']['replace_once'](core_source,"'nativeSshSignature','stageSource','binaryPhase','validateArchive'","'nativeSshSignature','stageSource','binaryPhase','validateArchive','credentialIdentity','credentialAcl'")
                core=execute(core_source.encode(),audit/'same-original-collector.py','same_original_image_collector');collector=core['SourceStreamOwner'](audit)
                class CredentialGuard:
                    def assert_current(self):
                        guard.assert_current();assert not collector.interrupted,'IMAGE_CREDENTIAL_OWNER_INTERRUPTED'
                credential_guard=CredentialGuard();original_run=collector.run_original
                def guarded_credential_run(*args,**kwargs):
                    credential_guard.assert_current()
                    try:return original_run(*args,**kwargs)
                    finally:credential_guard.assert_current()
                collector.run_original=guarded_credential_run
                transfer_file=REPO/'tests/online-deployment/independent-image-transfer.fixture.py'
                transfer=execute(modules['backendSource']['pinned'](transfer_file,'55d6390c6cc87c62a0484ec46a871b32ba97fcdb2a57aa9214512eb9671ee9ca'),transfer_file,'same_original_image_transfer')
                custody_known=False
                try:repository=modules['repositoryTransport']['run'](source,images,operation,password,helper,collector,transfer,modules['repositoryChannel'],credential_guard)
                finally:collector.close()
                closure=repository['original']
                custody_known=closure['actualOriginalClosed'] and repository['remoteOriginalsClosed'] and not closure['interrupted'] and closure['observationFaults']==[] and closure['credentialEchoRefused'] is False and closure['stderrBytes']==0
                assert repository['remote'] is None or repository['remote']['fullOperation']==retirement['operation']
                repository['credentialOriginalClosures']=collector.children
                assert repository['retrievalQualified'] is True,'IMAGE_REPOSITORY_CLOSED_NEGATIVE'
        revalidate_sources()
    except BaseException as error:failure=type(error).__name__
    finally:
        password=None
        for number,handler in handlers.items():signal.signal(number,handler)
        custody.close()
    qualified=failure is None and custody_known and repository is not None and repository['retrievalQualified'] is True
    receipt=save(audit/'owner-result.json',dict(format='sabalan-c3-image-repository-owner/v1',operation=operation,rootOperation=root_operation,retirement=retirement,phases=phases,backendComponent=backend_component,repository=repository,originalCustodyKnown=custody_known,retrievalQualified=qualified,failureType=failure,outerOriginalClosurePending=True,productionAdmission=False))
    emit(dict(format='sabalan-image-repository-owner-result/v1',operation=operation,**receipt,retrievalQualified=qualified,outerOriginalClosurePending=True,productionAdmission=False))
    assert sys.stdin.buffer.read(1)==b''
    return 0


if __name__=='__main__':
    assert len(sys.argv)==3
    sys.exit(main(dict(file=str(pathlib.Path(sys.argv[1])),sha256=sys.argv[2])))
