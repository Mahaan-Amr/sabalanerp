#!/usr/bin/env python3
"""Fixed backup-host launch: pin source, acquire locks, own original Node.

No Docker/SSH mutation is performed here. Both original processes retain the
SAME lock OFDs; an unexpected child exit retains custody in this guardian.
"""
import fcntl
import importlib.util
import threading
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time

PRIVATE=Path('/root/sabalan-recovery-private')
FILES=('scripts/run-independent-full-restore-controller.mjs',
       'scripts/lib/independent-private-qualification-controller.mjs',
       'scripts/lib/independent-private-qualification-material.mjs','scripts/lib/independent-checkpoint-transport.mjs',
       'scripts/lib/independent-physical-replay.mjs')


def read(file, expected, maximum=16*1024**2):
    assert file.resolve(strict=True)==file
    fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        before=os.fstat(fd)
        assert stat.S_ISREG(before.st_mode) and before.st_uid==0 and before.st_nlink==1
        assert before.st_mode&0o777==0o400 and 0<before.st_size<=maximum
        with os.fdopen(os.dup(fd),'rb') as stream:raw=stream.read(maximum+1)
        identity=lambda value:(value.st_dev,value.st_ino,value.st_size,value.st_mtime_ns,value.st_ctime_ns,value.st_uid,value.st_mode,value.st_nlink)
        assert identity(before)==identity(os.fstat(fd))==identity(file.lstat()) and len(raw)==before.st_size
        assert re.fullmatch(r'[a-f0-9]{64}',expected) and hashlib.sha256(raw).hexdigest()==expected
        return raw
    finally:os.close(fd)


def main():
    assert sys.platform=='linux' and os.getuid()==0 and not sys.flags.optimize and len(sys.argv) in (3,4)
    standalone=len(sys.argv)==4
    if standalone:assert sys.argv[3] in ('wal-only','metadata-only','repository-promotion','certification-ack','terminal-ack','point-transfer')
    os.umask(0o077);config_file=Path(sys.argv[1]);assert config_file.is_relative_to(PRIVATE)
    config=json.loads(read(config_file,sys.argv[2]));assert config['format']=='sabalan-original-independent-full-restore-input/v1'
    root=Path(config['controllerRoot']);assert root.is_relative_to(PRIVATE) and root.resolve(strict=True)==root
    assert set(config['controllerFiles'])==set(FILES)
    for name in FILES:read(root/name,config['controllerFiles'][name])
    executable=Path(config['nodeExecutable']);assert executable.is_absolute() and executable.resolve(strict=True)==executable
    fd=os.open(executable,os.O_RDONLY|os.O_NOFOLLOW);hasher=hashlib.sha256()
    try:
        before=os.fstat(fd);assert stat.S_ISREG(before.st_mode) and before.st_uid==0 and not before.st_mode&0o022
        while raw:=os.read(fd,262144):hasher.update(raw)
        after=os.fstat(fd);assert (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns)
        assert hasher.hexdigest()==config['nodeExecutableSha256']
    finally:os.close(fd)
    probe=subprocess.Popen([str(executable),'--version'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    output,error=probe.communicate();assert probe.returncode==0 and not error
    version=re.fullmatch(rb'v([0-9]+)\.([0-9]+)\.([0-9]+)\n',output);assert version
    assert tuple(map(int,version.groups()))>=(18,20,0) and output.decode().strip()==config['nodeExecutableVersion']
    locks=[]
    for file in [PRIVATE/'drill-ownership.lock',Path('/run/lock/sabalan-backup-storage.lock')]:
        assert file.parent.resolve(strict=True)==file.parent
        fd=os.open(file,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
        value=os.fstat(fd);named=file.lstat()
        assert stat.S_ISREG(value.st_mode) and value.st_uid==0 and value.st_nlink==1 and not value.st_mode&0o022
        assert (value.st_dev,value.st_ino)==(named.st_dev,named.st_ino)
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        locks.append(fcntl.fcntl(fd,fcntl.F_DUPFD_CLOEXEC,11));os.close(fd)
    for source,target in zip(locks,[9,10]):os.dup2(source,target,inheritable=True)
    for fd in locks:os.close(fd)
    helper_file=Path(config['bundleRoot'])/'independent-image-transfer.py'
    read(helper_file,config['sourcePins']['independent-image-transfer.py'],65536)
    helper_spec=importlib.util.spec_from_file_location('fixed_original_image_transfer',helper_file)
    helper=importlib.util.module_from_spec(helper_spec);helper_spec.loader.exec_module(helper)
    if standalone:
        window_file=Path(config['bundleRoot'])/'independent-wal-window-controller.py';read(window_file,config['sourcePins'][window_file.name],65536)
        spec=importlib.util.spec_from_file_location('original_standalone_window',window_file)
        window=importlib.util.module_from_spec(spec);spec.loader.exec_module(window)
        try:
            if sys.argv[3]=='wal-only':window.run_standalone(config,helper,read)
            else:
                raw=sys.stdin.buffer.readline(16*1024**2+1);assert raw and len(raw)<=16*1024**2 and raw.endswith(b'\n')
                source=json.loads(raw)
                if sys.argv[3]=='repository-promotion':result=window.promote_repository_original(config,source,read)
                elif sys.argv[3]=='certification-ack':result=window.certify_point_original(config,source,read)
                elif sys.argv[3]=='terminal-ack':result=window.persist_terminal_original(config,source,read)
                elif sys.argv[3]=='point-transfer':result=window.receive_physical_point(config,source,helper,read)
                else:result=window.publish_physical_metadata(config,source)
                print(json.dumps(result),flush=True)
            return
        except BaseException:
            print(json.dumps(dict(event='ORIGINAL_GUARDIAN_HELD',phase='HELD',productionAdmission=False)),flush=True)
            while True:time.sleep(30)
    # The launcher remains the original guardian. An unexpected Node exit must
    # not release the two host locks while daemon-owned actors may still exist.
    child=subprocess.Popen([str(executable),'--max-old-space-size=192',str(root/FILES[0]),str(config_file),sys.argv[2]],
                           stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(9,10))
    errors=[];err=bytearray();transfers=[];final_lines=[]
    physical=bool(config.get('onlinePhysicalPoint'))
    print_lock=threading.Lock();node_lock=threading.Lock();storage=threading.Lock()
    condition=threading.Condition();expected_image=None;producer_drained=False
    pending_certificates=set();window_threads=[];window_cipher_bytes=0;seen_windows=set();reader=None
    def emit(value):
        with print_lock:print(json.dumps(value),flush=True)
    def node_send(value):
        with node_lock:child.stdin.write(helper.frame(value));child.stdin.flush()
    if physical:
        window_file=Path(config['bundleRoot'])/'independent-wal-window-controller.py'
        read(window_file,config['sourcePins'][window_file.name],65536)
        spec=importlib.util.spec_from_file_location('original_owned_window_controller',window_file)
        window=importlib.util.module_from_spec(spec);spec.loader.exec_module(window)
        windows=PRIVATE/'native-qa'/'wal-windows'
        if not windows.exists():windows.mkdir(mode=0o700)
        assert windows.resolve(strict=True)==windows and windows.lstat().st_uid==0 and windows.lstat().st_mode&0o777==0o700
        window.fsync_parent(windows.parent)
        def consume_input():
            nonlocal expected_image,producer_drained,window_cipher_bytes
            try:
                while True:
                    raw=sys.stdin.buffer.readline(2*1024**2+1);assert raw and len(raw)<=2*1024**2 and raw.endswith(b'\n')
                    value=json.loads(raw);event=value.get('event')
                    if event=='IMAGE_TRANSFER_BEGIN':
                        with condition:
                            assert expected_image is not None;wanted=expected_image
                        class Prefix:
                            def __init__(self):self.first=raw
                            def readline(self,count):
                                if self.first is not None:result=self.first;self.first=None;return result
                                return sys.stdin.buffer.readline(count)
                            def read(self,count):return sys.stdin.buffer.read(count)
                        proof=helper.receive_owned(Prefix(),Path(wanted['path']),wanted)
                        ack=dict(event='IMAGE_TRANSFER_STORED',operation=config['operation'],role=wanted['role'],sequence=wanted['sequence'],proof=proof)
                        transfers.append(ack)
                        with condition:expected_image=None;condition.notify_all()
                        node_send(ack)
                    elif event=='WAL_WINDOW_BEGIN':
                        assert not producer_drained
                        wanted=value['request'];total=window.request(wanted);checksum=window.digest(wanted)
                        assert value['requestSha256']==checksum and checksum not in seen_windows
                        assert window_cipher_bytes+total<=window.MAX_CIPHER,'WAL_WINDOW_RETAINED_QUOTA'
                        # Reserve is cumulative ciphertext + one bounded plaintext object;
                        # full restore has already admitted this separate 320MiB peak.
                        space=os.statvfs(windows);assert space.f_bavail*space.f_frsize>=total+window.MAX_PLAIN+64*1024**2
                        root=windows/checksum;root.mkdir(mode=0o700);(root/'ciphertexts').mkdir(mode=0o700);window.fsync_parent(windows)
                        for row in wanted['objects']:
                            target=root/'ciphertexts'/row['name']
                            transfer=dict(event='WAL_WINDOW_CIPHER',role=row['name'],requestSha256=checksum,path=str(target),bytes=row['bytes'],sha256=row['sha256'])
                            helper.receive_owned(sys.stdin.buffer,target,transfer)
                        seen_windows.add(checksum);window_cipher_bytes+=total
                        with condition:pending_certificates.add(checksum)
                        def verify(value=value,root=root):
                            try:
                                # The single stdin owner never waits for this mutex:
                                # an image payload/ACK behind this window must drain
                                # while Node owns its original crypto phase.
                                with storage:result=window.verify_original(config,value,root,read)
                                emit(result)
                            except BaseException as error:
                                errors.append(error)
                                with condition:condition.notify_all()
                        thread=threading.Thread(target=verify,daemon=True);window_threads.append(thread);thread.start()
                    elif event=='WAL_WINDOW_CERTIFICATE_ACK':
                        with condition:assert value['requestSha256'] in pending_certificates
                        stored=window.store_certificate_original(config,value,windows/value['requestSha256'],read)
                        emit(stored)
                        with condition:pending_certificates.remove(value['requestSha256']);condition.notify_all()
                    elif event=='WAL_WINDOW_PRODUCER_DRAINED':
                        with condition:
                            assert not producer_drained;producer_drained=True;condition.notify_all()
                        # Continue reading certificate ACKs until all original issued
                        # verifiers have been acknowledged by the SAME Windows owner.
                        if not pending_certificates:return
                    else:raise RuntimeError('ORIGINAL_GUARDIAN_INPUT_REFUSED')
                    if producer_drained and not pending_certificates:return
            except BaseException as error:
                errors.append(error)
                with condition:condition.notify_all()
        reader=threading.Thread(target=consume_input,daemon=True);reader.start()
        emit(dict(event='INDEPENDENT_GUARDIAN_READY',operation=config['operation'],originalGuardianPid=os.getpid(),originalNodePid=child.pid,productionAdmission=False))
    def collect_error():
        try:
            while raw:=child.stderr.read(65536):
                assert len(err)+len(raw)<=65536;err.extend(raw)
        except BaseException as error:errors.append(error)
        finally:child.stderr.close()
    error_thread=threading.Thread(target=collect_error,daemon=True);error_thread.start()
    try:
        while line:=child.stdout.readline(65537):
            assert len(line)<=65536 and line.endswith(b'\n')
            value=json.loads(line);event=value.get('event')
            assert not errors
            if event=='STORAGE_PHASE_BEGIN':
                assert physical and value['operation']==config['operation'];storage.acquire()
                node_send(dict(event=event+'_ACK',operation=config['operation']))
            elif event=='STORAGE_PHASE_END':
                assert physical and value['operation']==config['operation'];storage.release()
                node_send(dict(event=event+'_ACK',operation=config['operation']))
            elif event=='IMAGE_TRANSFER_REQUEST':
                sequence=len(transfers);assert sequence<len(helper.ROLES);role=helper.ROLES[sequence]
                transfer=config['images'][role]['transfer'];assert transfer['stagedFromOriginalSsh'] is True
                wanted=helper.request(config['operation'],role,sequence,transfer['cipherPath'],transfer['cipherBytes'],transfer['cipherSha256'])
                assert value==wanted and not final_lines
                if physical:
                    with condition:assert expected_image is None;expected_image=wanted
                    emit(wanted)
                else:
                    emit(wanted);proof=helper.receive_owned(sys.stdin.buffer,Path(wanted['path']),wanted)
                    ack=dict(event='IMAGE_TRANSFER_STORED',operation=config['operation'],role=role,sequence=sequence,proof=proof)
                    transfers.append(ack);node_send(ack)
            elif event=='WAL_WINDOW_DRAIN_REQUEST':
                assert physical and value['operation']==config['operation'];emit(value)
                with condition:
                    while not errors and (not producer_drained or pending_certificates):condition.wait(timeout=1)
                    assert not errors and expected_image is None
                reader.join(timeout=30);assert not reader.is_alive()
                for thread in window_threads:thread.join(timeout=30);assert not thread.is_alive()
                node_send(dict(event='WAL_WINDOW_DRAINED',operation=config['operation']))
            else:final_lines.append(line);assert len(final_lines)==1
        child.stdout.close();child.stdin.close();status=child.wait(timeout=60)
        error_thread.join(timeout=30);assert not error_thread.is_alive() and not errors
        if reader:assert not reader.is_alive() and producer_drained and not pending_certificates
        output=b''.join(final_lines);error=bytes(err)
    except BaseException:
        emit(dict(format='sabalan-original-independent-full-restore-launch/v1',phase='HELD',productionAdmission=False))
        while True:time.sleep(30)
    try:
        assert child.returncode==0 and len(output)<=65536 and len(error)<=65536
        value=json.loads(output);assert value['pass'] is True and value['phase']=='COMPLETE' and value['productionAdmission'] is False
        assert value['retentionPublished'] is False and re.fullmatch(r'[a-f0-9]{32}',value['operation'])
        report_file=PRIVATE/'native-qa'/('full-restore-'+value['operation'])/'controller-evidence.json'
        report_raw=read(report_file,value['reportSha256']);report=json.loads(report_raw)
        assert report['operation']==value['operation'] and report['pass'] is True and report['phase']=='COMPLETE'
        assert report['productionAdmission'] is False and report['originalDockerProcesses']
        assert report['applicationStageOrder']==list(helper.ROLES) and report['imageTransfers']==transfers
        staged=any(config['images'][role].get('transfer',{}).get('stagedFromOriginalSsh') for role in helper.ROLES)
        assert len(transfers)==(3 if staged else 0)
        print(json.dumps(dict(format='sabalan-original-independent-full-restore-launch/v1',originalNodePid=child.pid,
                              originalNodeReturncode=child.returncode,reportSha256=value['reportSha256'],operation=value['operation'],
                              reportRawBase64=base64.b64encode(report_raw).decode(),imageTransfers=transfers,applicationStageOrder=list(helper.ROLES),
                              productionAdmission=False,retentionPublished=False,**{'pass':True})),flush=True)
    except BaseException:
        print(json.dumps(dict(format='sabalan-original-independent-full-restore-launch/v1',phase='HELD',
                              originalNodePid=child.pid,originalNodeReturncode=child.returncode,productionAdmission=False)),flush=True)
        while True:time.sleep(30)


if __name__=='__main__':main()
