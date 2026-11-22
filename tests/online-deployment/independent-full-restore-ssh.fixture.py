"""Fixed authenticated original SSH launch; no reconnect or receipt adoption."""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import subprocess
import sys
import threading
import time
import uuid


REMOTE_BOOTSTRAP="""import hashlib
import importlib.util,os,pathlib,stat,sys
p=pathlib.Path(sys.argv[1]); expected=sys.argv[2]; config=sys.argv[3]; config_sha=sys.argv[4]; mode=sys.argv[5]
assert mode in ('full','wal-only','metadata-only','repository-promotion','certification-ack','terminal-ack','point-transfer')
assert p.resolve(strict=True)==p
fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
try:
 before=os.fstat(fd);assert stat.S_ISREG(before.st_mode) and before.st_uid==0 and before.st_nlink==1 and before.st_mode&0o777==0o400 and 0<before.st_size<=65536
 with os.fdopen(os.dup(fd),'rb') as f:raw=f.read(65537)
 after=os.fstat(fd);named=p.lstat()
 pin=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode,s.st_uid,s.st_nlink)
 assert len(raw)==before.st_size and pin(before)==pin(after)==pin(named) and hashlib.sha256(raw).hexdigest()==expected
finally:os.close(fd)
sys.argv=[str(p),config,config_sha]+([mode] if mode!='full' else [])
exec(compile(raw,str(p),'exec'),{'__name__':'__main__','__file__':str(p)})
"""


def main():
    assert not sys.flags.optimize and len(sys.argv)==1
    raw=sys.stdin.buffer.readline(16*1024**2+1);assert 0<len(raw)<=16*1024**2 and raw.endswith(b'\n')
    request=json.loads(raw);profile=request['profile'];remote=request['remote']
    assert profile['format']=='sabalan-independent-fixed-ssh-profile/v1'
    assert profile['host']=='94.182.177.74' and profile['port']==22 and profile['user']=='root'
    assert re.fullmatch(r'[a-f0-9]{64}',profile['hostKeySha256'])
    for key in ['remoteControllerSha256','remoteConfigurationSha256']:assert re.fullmatch(r'[a-f0-9]{64}',request[key])
    assert re.fullmatch(r'[a-f0-9]{32}',remote['operation'])
    for key in ['launcherPath','configurationPath']:
        value=remote[key];assert isinstance(value,str) and str(PurePosixPath(value))==value and value.startswith('/root/sabalan-recovery-private/')
        assert '..' not in PurePosixPath(value).parts and '\x00' not in value and '\n' not in value and '\r' not in value
    assert remote['launcherPath'].endswith('/deploy/scripts/run-independent-full-restore-controller.py')
    assert remote['configurationPath'].endswith('.json')
    password=request.pop('password');assert isinstance(password,str) and 0<len(password)<=4096
    assert sys.platform=='win32'
    executable=Path('C:/Program Files/PuTTY/plink.exe').resolve(strict=True)
    assert str(executable)==profile['plinkExecutable'] and re.fullmatch(r'[a-f0-9]{64}',profile['plinkExecutableSha256'])
    with executable.open('rb') as binary:assert hashlib.file_digest(binary,'sha256').hexdigest()==profile['plinkExecutableSha256']
    ssh_directory=Path('C:/Users/mahan/.ssh');assert ssh_directory.resolve(strict=True)==ssh_directory
    private_file=ssh_directory/('.codex-independent-restore-'+uuid.uuid4().hex)
    helper_file=Path(__file__).with_name('independent-image-transfer.fixture.py')
    assert hashlib.sha256(helper_file.read_bytes()).hexdigest()==request['transferHelperSha256']
    helper_spec=importlib.util.spec_from_file_location('original_image_transfer',helper_file)
    helper=importlib.util.module_from_spec(helper_spec);helper_spec.loader.exec_module(helper)
    sources={};transfers=[]
    for role,expected in request.get('imageSources',{}).items():
        assert role in helper.ROLES and isinstance(expected['path'],str)
        file=Path(expected['path']);assert file.is_relative_to(Path('D:/sabalanerp-online-qa')) and file.name==role+'.sabrec'
        sources[role]=helper.verify_source(file,expected)
    assert len(sources) in (0,3)
    child=None;started=False
    try:
        descriptor=os.open(private_file,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.close(descriptor)
        user=subprocess.check_output(['C:/Windows/System32/whoami.exe'],text=True).strip()
        protected=subprocess.run(['C:/Windows/System32/icacls.exe',str(private_file),'/inheritance:r','/grant:r',user+':F'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW)
        assert protected.returncode==0,'ORIGINAL_SSH_PRIVATE_ACL_UNPROVEN'
        private_file.write_text(password+'\n',encoding='utf8');password=None
        args=['/usr/bin/python3','-I','-B','-c',REMOTE_BOOTSTRAP,remote['launcherPath'],request['remoteControllerSha256'],remote['configurationPath'],request['remoteConfigurationSha256'],({'sabalan-original-physical-repository-promotion-input/v1':'repository-promotion','sabalan-original-physical-certification-input/v1':'certification-ack','sabalan-original-terminal-coverage-persistence-input/v1':'terminal-ack','sabalan-original-independent-physical-point-transfer-input/v1':'point-transfer'}.get(request['metadataPublication']['format'],'metadata-only')) if request.get('metadataPublication') else 'wal-only' if request.get('walStandalone') else 'full']
        # The command is fixed. shlex quotes path/hash arguments; neither the
        # profile nor a caller supplies executable code or an arbitrary command.
        fingerprint='SHA256:'+base64.b64encode(bytes.fromhex(profile['hostKeySha256'])).decode().rstrip('=')
        command=[str(executable),'-batch','-noagent','-ssh','-l','root','-P','22','-hostkey',fingerprint,'-pwfile',str(private_file),'94.182.177.74',' '.join(shlex.quote(value) for value in args)]
        # No caller-supplied ChildProcess: retain this SAME original PuTTY
        # process/pipes from birth through authenticated remote closure.
        child=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW);started=True
        if request.get('metadataPublication'):
            publication=request['metadataPublication'];local_files=publication.get('files',[]);held_point=[]
            try:
                for row in local_files:
                    file=Path(row['file']);assert file.is_relative_to(Path('D:/sabalanerp-online-qa'));held_point.append(helper.verify_source(file,row))
                header={key:value for key,value in publication.items() if key!='files'};child.stdin.write(helper.frame(header));child.stdin.flush()
                for row,owned in zip(local_files,held_point):
                    target='/root/sabalan-recovery-private/native-qa/online-point-'+publication['request']['captureId']+'/ciphertexts/'+row['name']+'.sabrec'
                    wanted=dict(event='PHYSICAL_POINT_CIPHER',role=row['name'],requestSha256=publication['requestSha256'],path=target,bytes=row['bytes'],sha256=row['sha256']);helper.send_owned(owned,child.stdin,wanted)
            finally:
                for owned in held_point:helper.assert_source_current(owned);os.close(owned['fd'])
        outputs={};errors=[];threads=[];send_lock=threading.Lock();print_lock=threading.Lock();producer_drained=False;commands=None
        def emit(value):
            with print_lock:print(json.dumps(value),flush=True)
        def consume_commands():
            nonlocal producer_drained
            try:
                while True:
                    raw=sys.stdin.buffer.readline(2*1024**2+1);assert raw and len(raw)<=2*1024**2 and raw.endswith(b'\n')
                    value=json.loads(raw);event=value.get('event')
                    if event=='WAL_WINDOW_SEND':
                        assert not producer_drained
                        wanted=value['request'];assert len(wanted['objects'])==len(value['files'])<=16
                        owned=[]
                        try:
                            for item,row in zip(wanted['objects'],value['files']):
                                file=Path(row['file']);assert file.is_relative_to(Path('D:/sabalanerp-online-qa')) and row['name']==item['name'] and row['bytes']==item['bytes'] and row['sha256']==item['sha256']
                                owned.append(helper.verify_source(file,item))
                            with send_lock:
                                header=dict(event='WAL_WINDOW_BEGIN',request=wanted,requestSha256=value['requestSha256'],ownedOutputs=value['ownedOutputs'],sourceOriginalPid=value['sourceOriginalPid'],sourceRuntimeId=value['sourceRuntimeId'])
                                child.stdin.write(helper.frame(header));child.stdin.flush()
                                for item,source in zip(wanted['objects'],owned):
                                    remote_root='/root/sabalan-recovery-private/native-qa/wal-windows/'+value['requestSha256']
                                    transfer=dict(event='WAL_WINDOW_CIPHER',role=item['name'],requestSha256=value['requestSha256'],path=remote_root+'/ciphertexts/'+item['name'],bytes=item['bytes'],sha256=item['sha256'])
                                    helper.send_owned(source,child.stdin,transfer)
                        finally:
                            for source in owned:helper.assert_source_current(source);os.close(source['fd'])
                    elif event in ('WAL_WINDOW_CERTIFICATE_ACK','WAL_WINDOW_PRODUCER_DRAINED'):
                        if event=='WAL_WINDOW_PRODUCER_DRAINED':assert not producer_drained;producer_drained=True
                        with send_lock:child.stdin.write(helper.frame(value));child.stdin.flush()
                    elif event=='ORIGINAL_GUARDIAN_INPUT_CLOSED':
                        assert producer_drained;return
                    else:raise RuntimeError('ORIGINAL_SSH_COMMAND_REFUSED')
            except BaseException as error:errors.append(error)
        if request.get('liveGuardian'):
            commands=threading.Thread(target=consume_commands,daemon=True);commands.start()

        def collect(name,stream,maximum):
            chunks=[];total=0
            try:
                while line:=stream.readline(maximum+1):
                    total+=len(line)
                    if total>maximum:raise RuntimeError('ORIGINAL_SSH_REMOTE_OUTPUT_BOUND')
                    if name=='stdout':
                        value=json.loads(line)
                        if value.get('event')=='IMAGE_TRANSFER_REQUEST':
                            sequence=len(transfers);assert sequence<len(helper.ROLES);role=helper.ROLES[sequence]
                            source=sources[role];expected=source['expected']
                            wanted=helper.request(remote['operation'],role,sequence,expected['targetPath'],expected['bytes'],expected['sha256'])
                            assert value==wanted
                            with send_lock:transfers.append(helper.send_owned(source,child.stdin,wanted))
                            continue
                        if value.get('phase')=='HELD':emit(dict(event='ORIGINAL_GUARDIAN_HELD',productionAdmission=False));continue
                        if value.get('event') in ('INDEPENDENT_GUARDIAN_READY','WAL_WINDOW_RESULT','WAL_WINDOW_DRAIN_REQUEST','WAL_WINDOW_CERTIFICATE_STORED'):
                            assert request.get('liveGuardian')
                            if value['event']=='INDEPENDENT_GUARDIAN_READY':value['originalPlinkPid']=child.pid
                            emit(value);continue
                    chunks.append(line)
                outputs[name]=b''.join(chunks)
            except BaseException as error:errors.append(error)
            finally:stream.close()
        for name,stream,maximum in [('stdout',child.stdout,12*1024**2),('stderr',child.stderr,65536)]:
            thread=threading.Thread(target=collect,args=(name,stream,maximum));thread.start();threads.append(thread)
        for thread in threads:thread.join()
        if commands:
            emit(dict(event='ORIGINAL_GUARDIAN_INPUT_CLOSE_REQUEST'))
            commands.join(timeout=30);assert not commands.is_alive()
        assert not errors
        child.stdin.close();status=child.wait();assert status==0
        assert len(transfers)==len(sources)
        out=outputs['stdout'];assert out and len(out)<=12*1024**2
        # This frame comes only from this channel's ORIGINAL pinned launcher's
        # stdout after its OWN Node process closed. No remote report-file read.
        launched=json.loads(out)
        if request.get('metadataPublication'):
            assert launched['format'] in ('sabalan-original-independent-physical-metadata-publication/v1','sabalan-original-independent-physical-repository-promotion/v1','sabalan-original-independent-physical-certification-ack/v1','sabalan-original-independent-terminal-coverage-ack/v1','sabalan-original-independent-physical-point-transfer/v1') and launched['productionAdmission'] is False
        elif request.get('walStandalone'):
            assert launched['format']=='sabalan-original-independent-wal-window-launch/v1' and launched['originalVerifierReturncode']==0 and launched['originalCertificateVerifierReturncode']==0
        else:assert launched['format']=='sabalan-original-independent-full-restore-launch/v1' and launched['originalNodeReturncode']==0
        if not request.get('metadataPublication'):assert launched['pass'] is True and launched['operation']==remote['operation']
        assert private_file.parent.resolve(strict=True)==ssh_directory and private_file.name.startswith('.codex-independent-restore-')
        private_file.unlink()
        for source in sources.values():helper.assert_source_current(source);os.close(source['fd'])
        with executable.open('rb') as binary:assert hashlib.file_digest(binary,'sha256').hexdigest()==profile['plinkExecutableSha256']
        print(json.dumps(dict(format='sabalan-original-independent-ssh/v1',originalRemoteExitStatus=status,
                              hostKeyBinding='PINNED_PLINK_ENFORCED',enforcedHostKeySha256=profile['hostKeySha256'],originalPlinkPid=child.pid,originalPlinkReturncode=status,
                              remoteControllerSha256=request['remoteControllerSha256'],
                              remoteConfigurationSha256=request['remoteConfigurationSha256'],remoteStdoutBase64=base64.b64encode(out).decode(),
                              remoteStderrSha256=hashlib.sha256(outputs['stderr']).hexdigest(),imageTransfers=transfers,applicationStageOrder=list(helper.ROLES))),flush=True)
    except BaseException:
        if not started:
            if private_file.exists():private_file.unlink()
            print('ORIGINAL_INDEPENDENT_SSH_PRELAUNCH_REFUSED',file=sys.stderr,flush=True);sys.exit(1)
        print(json.dumps(dict(event='ORIGINAL_GUARDIAN_HELD',format='sabalan-original-independent-ssh/v1',phase='HELD',productionAdmission=False)),flush=True)
        # No timeout, reconnect, PID adoption, signal or posthoc report can
        # turn a lost original channel into successful remote closure.
        while True:time.sleep(30)


if __name__=='__main__':main()
