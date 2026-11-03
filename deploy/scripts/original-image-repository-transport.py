"""One finite pinned Plink duplex original; never reconnects or signals it."""
import hashlib
import json
import os
import pathlib
import threading
import time


def validate_remote_result(result,images,operation,retrieved):
    assert result['format']=='sabalan-c3-image-repository-original/v1'
    assert result['operation']==operation and result['retrievalQualified'] is True and result['productionAdmission'] is False
    assert result['images']==images and result['allOriginalChildrenClosed'] is True
    assert result['point']=='/root/sabalan-recovery-private/image-repository-'+operation
    assert result['incidentHoldPreserved'] is True and result['imageImported'] is False
    assert result['floorBytes']==result['canonicalReserveBytes']+512*1024**2 and result['canonicalReserveBytes']>0
    assert len(result['stored'])==len(result['retrieved'])==len(retrieved)==3
    for index,role in enumerate(('backend','inquiry','frontend')):
        stored=result['stored'][index];remote=result['retrieved'][index];local=retrieved[index]
        assert stored['role']==remote['role']==local['role']==role
        assert stored['bytes']==remote['bytes']==local['bytes']==images[role]['cipher']['bytes']
        assert stored['sha256']==remote['sha256']==local['sha256']==images[role]['cipher']['sha256']
        assert stored['path']==result['point']+'/'+role+'.sabrec'
        assert stored['fsyncFileAndDirectory'] is True and stored['fullReadbackVerified'] is True
        assert remote['actualClientAcknowledgement'] is True and local['actualClientBytesHashed'] is True
        assert remote['requestSha256']==local['requestSha256']
    backend=images['backend'];proof=result['independentBackend']
    assert proof['format']=='sabalan-source-a-independent-image-stream-gcm/v1'
    assert proof['image']==backend['image'] and proof['gcmAuthenticated'] is True
    assert proof['cipherBytes']==backend['cipher']['bytes'] and proof['cipherSha256']==backend['cipher']['sha256']
    assert proof['plainBytes']==backend['gzip']['bytes'] and proof['plainSha256']==backend['gzip']['sha256']
    assert proof['independentPublicKeySha256']=='455e5a7ba5990866ca6992c0fd177fa0df5b22b5d3e985c41ee306e3a779b8af'
    assert proof['privateRsaExported'] is False and proof['plaintextPersisted'] is False and proof['productionAdmission'] is False
    assert result['originalChildren'] and all(row['code']==0 and row['pipesClosed'] and row['stdoutEof'] and row['stderrEof'] and row['observationFault'] is None for row in result['originalChildren'])


def run(material, images, operation, password, helper, collector, transfer, channel, parent_custody):
    parent_custody.assert_current()
    sources={}
    try:
        for role in ('backend','inquiry','frontend'):
            sources[role]=transfer['verify_source'](images[role]['cipher']['file'],images[role]['cipher'])
        with helper['private_backup_password'](collector,password) as password_file:
            argv=helper['plink_argv'](password_file,material['command'])
            executable=pathlib.Path(argv[0]);named=executable.stat()
            with executable.open('rb') as held_executable:
                held=os.fstat(held_executable.fileno())
                portable=lambda st:tuple(getattr(st,k) for k in ['st_ino','st_size','st_mtime_ns','st_mode','st_nlink'])
                exact=lambda st:tuple(getattr(st,k) for k in ['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_mode','st_nlink'])
                assert portable(named)==portable(held)
                parent_custody.assert_current()
                result=collect_channel(argv,material,images,operation,sources,transfer,channel,parent_custody,password)
                assert exact(held)==exact(os.fstat(held_executable.fileno())) and exact(named)==exact(executable.stat())
                return result
    finally:
        for source in sources.values():os.close(source['fd'])


def collect_channel(argv,material,images,operation,sources,transfer,channel,parent_custody,password):
    import signal
    assert threading.current_thread() is threading.main_thread()
    interrupted=[];previous={}
    def cancel(number,_frame):
        if number not in interrupted:interrupted.append(number)
    try:
        for number in [signal.SIGINT,signal.SIGTERM]:previous[number]=signal.signal(number,cancel)
        return _collect_channel(argv,material,images,operation,sources,transfer,channel,parent_custody,password,interrupted)
    finally:
        # Inner scope returns only after actual wait and both SAME-pipe EOFs.
        for number,handler in previous.items():signal.signal(number,handler)


def _collect_channel(argv,material,images,operation,sources,transfer,channel,parent_custody,password,interrupted):
    import subprocess
    child=None
    errors=bytearray();stderr_bytes=0;stderr_eof=False;faults=[];result=None;failure=None;remote_negative=None
    def fault(name):
        if name not in faults and len(faults)<32:faults.append(name)
    def current():
        parent_custody.assert_current()
        assert not interrupted,'IMAGE_REPOSITORY_INTERRUPTED'
        assert not faults,'IMAGE_REPOSITORY_OBSERVATION_FAULT'
    def read_errors():
        nonlocal stderr_bytes,stderr_eof
        while True:
            try:raw=child.stderr.read(65536)
            except BaseException as error:fault(type(error).__name__);time.sleep(.05);continue
            if not raw:stderr_eof=True;return
            stderr_bytes+=len(raw)
            if len(errors)+len(raw)<=65536:errors.extend(raw)
            else:fault('STDERR_BOUND')
    reader=threading.Thread(target=read_errors,name='owned-image-repository-stderr',daemon=False)
    sent=[];retrieved=[];stdout_eof=False;code=None
    current()
    child=subprocess.Popen(argv,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                           creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    while True:
        if reader.ident is not None:break
        try:reader.start();break
        except BaseException as error:fault(type(error).__name__);time.sleep(.05)
    try:
        current()
        assert child.stdin.write(material['source'])==len(material['source']);child.stdin.flush()
        for sequence,role in enumerate(('backend','inquiry','frontend')):
            current()
            wanted=transfer['request'](operation,role,sequence,'/root/sabalan-recovery-private/image-repository-'+operation+'/'+role+'.sabrec',images[role]['cipher']['bytes'],images[role]['cipher']['sha256'])
            event=channel['read_frame'](child.stdout)
            channel['reject_negative'](event)
            assert event==wanted,'IMAGE_REPOSITORY_UPLOAD_REQUEST_CHANGED'
            sent.append(transfer['send_owned'](sources[role],child.stdin,wanted))
        for sequence,role in enumerate(('backend','inquiry','frontend')):
            wanted=transfer['request'](operation,role,sequence,'/root/sabalan-recovery-private/image-repository-'+operation+'/'+role+'.sabrec',images[role]['cipher']['bytes'],images[role]['cipher']['sha256'])
            retrieved.append(channel['receive_retrieval'](child.stdout,child.stdin,wanted,current))
        event=channel['read_frame'](child.stdout)
        channel['reject_negative'](event)
        assert set(event)=={'event','result'} and event['event']=='IMAGE_REPOSITORY_RESULT'
        result=event['result'];validate_remote_result(result,images,operation,retrieved)
        for source in sources.values():transfer['assert_source_current'](source)
        current()
    except BaseException as error:
        failure=type(error).__name__
        candidate=getattr(error,'repository_negative',None)
        if isinstance(candidate,dict) and set(candidate)=={'event','operation','fullOperation','failureType','partialPointPreserved','originalChildren','interrupted','allOriginalChildrenClosed','productionAdmission'}:
            if candidate['operation']==operation and candidate['fullOperation']==material.get('fullOperation') and candidate['productionAdmission'] is False and candidate['allOriginalChildrenClosed'] is True and candidate['interrupted'] is False:
                rows=candidate['originalChildren']
                if isinstance(rows,list) and all(channel['known_remote_row_closed'](row) for row in rows):remote_negative=candidate
    finally:
        # All paths close input, drain these SAME two pipes, and wait naturally.
        while True:
            try:child.stdin.close();break
            except BaseException as error:fault(type(error).__name__);time.sleep(.05)
        while True:
            try:raw=child.stdout.read(65536)
            except BaseException as error:fault(type(error).__name__);time.sleep(.05);continue
            if not raw:stdout_eof=True;break
            fault('UNEXPECTED_TRAILING_STDOUT')
        while True:
            try:code=child.wait();break
            except BaseException as error:fault(type(error).__name__);time.sleep(.05)
        while True:
            try:
                reader.join(.1)
                if not reader.is_alive():break
            except BaseException as error:fault(type(error).__name__);time.sleep(.05)
        for stream in [child.stdout,child.stderr]:
            while True:
                try:stream.close();break
                except BaseException as error:fault(type(error).__name__);time.sleep(.05)
    echo=password.encode() in errors
    errors[:]=b'\0'*len(errors)
    row=dict(originalPid=child.pid,code=code,stdoutEof=stdout_eof,stderrEof=stderr_eof,
             killed=False,stderrBytes=stderr_bytes,observationFaults=faults,interrupted=bool(interrupted),credentialEchoRefused=echo,
             actualOriginalClosed=stdout_eof and stderr_eof and code is not None)
    qualified=failure is None and not faults and not interrupted and not echo and stderr_bytes==0 and code==0
    return dict(format='sabalan-c3-image-repository-windows-original/v1',operation=operation,
                original=row,sent=sent,retrieved=retrieved,remote=result if qualified else None,
                remoteNegative=remote_negative,remoteOriginalsClosed=qualified or remote_negative is not None,
                retrievalQualified=qualified,failureType=failure,productionAdmission=False)
