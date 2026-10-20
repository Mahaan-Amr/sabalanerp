#!/usr/bin/env python3
"""Archive only genuinely closed legacy control records at first bootstrap.
No application process is signalled, adopted, started or certified by this
metadata transition. Unknown markers remain an explicit protected failure.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import threading
import time
from urllib.parse import urlsplit,unquote

sys_path=Path(__file__).resolve().parent
originals=[];mutated=False;locks=[]

def require(value):
    if not value:raise RuntimeError('PROTECTED_LEGACY_RECORD_RETIREMENT_UNPROVEN')

def encoded(value):return (json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def pin(value):return (value.st_dev,value.st_ino,value.st_size,value.st_mtime_ns,value.st_ctime_ns,value.st_mode,value.st_uid,value.st_nlink)

def read(file):
    descriptor=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        before=os.fstat(descriptor);require(stat.S_ISREG(before.st_mode) and before.st_uid==0 and before.st_nlink==1
          and not before.st_mode&0o077 and 0<before.st_size<=16384 and file.resolve()==file)
        raw=os.read(descriptor,16385);require(len(raw)==before.st_size and pin(before)==pin(os.fstat(descriptor))==pin(file.lstat()))
        return json.loads(raw),raw,pin(before)
    finally:os.close(descriptor)

def closed(value,kind):
    require(value.get('format')==kind and value.get('phase')=='QUIESCENT' and value.get('nativeReaped') is True
      and value.get('databaseQuiet') is True and type(value.get('nativeStatus')) is int
      and re.fullmatch(r'[a-z0-9_-]{1,63}',value.get('namespace','')))
    if kind=='sabalan-runtime-native/v1':
        require(re.fullmatch(r'[a-f0-9]{48}',value.get('instanceId','')) and value['namespace']=='sabalan-rt-'+value['instanceId'])
        identity=dict(database=value['initialDatabase']['name'],oid=str(value['initialDatabase']['oid']),system=value['clusterIdentifier'])
    else:identity=value.get('identity')
    require(isinstance(identity,dict) and re.fullmatch(r'[A-Za-z0-9_]{1,63}',identity.get('database',''))
      and re.fullmatch(r'[1-9][0-9]*',str(identity.get('oid',''))) and re.fullmatch(r'[1-9][0-9]*',identity.get('system','')))
    return identity

def query(sql,environment):
    process=subprocess.Popen(['/usr/bin/psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],stdin=subprocess.DEVNULL,
      stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=environment)
    state=dict(process=process,overflow=False,out=bytearray(),error=bytearray(),threads=[],drainErrors=[],eof=0);originals.append(state)
    def drain(stream,target):
        try:
            while True:
                chunk=stream.read(4096)
                if not chunk:state['eof']+=1;break
                remaining=max(0,65536-len(target));target.extend(chunk[:remaining])
                if len(chunk)>remaining:state['overflow']=True
        except BaseException as error:state['drainErrors'].append(type(error).__name__)
    for stream,target in [(process.stdout,state['out']),(process.stderr,state['error'])]:
        worker=threading.Thread(target=drain,args=(stream,target));state['threads'].append(worker);worker.start()
    process.wait()
    for worker in state['threads']:worker.join()
    require(process.returncode==0 and not state['overflow'] and not state['drainErrors'] and state['eof']==2);return json.loads(state['out'])

def run():
    global mutated
    require(os.getuid()==0 and os.umask(0o077)==0o077)
    directory=Path(os.environ.get('RECOVERY_COORDINATION_DIR','/app/recovery-coordination'))
    require(directory==Path('/app/recovery-coordination') and directory.resolve()==directory)
    spec=importlib.util.spec_from_file_location('original_legacy_owner',sys_path/'backend-runtime-owner.py');owner=importlib.util.module_from_spec(spec);spec.loader.exec_module(owner)
    owner.assert_control_lock(directory) # SAME inherited descriptor9 from the original protected shell.
    gate=directory/'deployment-write-admission.lock';descriptor=os.open(gate,os.O_RDWR|os.O_NOFOLLOW|os.O_NONBLOCK);locks.append(descriptor)
    st=os.fstat(descriptor);require(stat.S_ISREG(st.st_mode) and st.st_nlink==1 and st.st_uid==0 and st.st_size==0 and not st.st_mode&0o077
      and (st.st_dev,st.st_ino)==(gate.stat().st_dev,gate.stat().st_ino));fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
    for name in ['restart-inquiry','inquiry-stopped']:require(not os.path.lexists(directory/name))
    records=[]
    for name,kind in [('deployment-runtime-native.json','sabalan-runtime-native/v1'),('deployment-bootstrap-native.json','sabalan-bootstrap-native/v1')]:
        file=directory/name
        if not os.path.lexists(file):continue
        value,raw,identity=read(file);database=closed(value,kind)
        if kind=='sabalan-runtime-native/v1':owner.assert_closed(directory)
        records.append(dict(file=file,value=value,raw=raw,pin=identity,database=database))
    url=urlsplit(os.environ['DATABASE_URL']);require(url.scheme in ('postgres','postgresql') and url.hostname and url.username and not url.fragment)
    database=unquote(url.path[1:]);require(re.fullmatch(r'[A-Za-z0-9_]{1,63}',database))
    operation=hashlib.sha256(encoded({key:os.environ['DEPLOYMENT_'+suffix] for key,suffix in [('deploymentId','ID'),('releaseId','RELEASE_ID'),('leaseToken','LEASE_TOKEN')]})).hexdigest()
    environment=dict(os.environ,PGHOST=url.hostname,PGPORT=str(url.port or 5432),PGUSER=unquote(url.username),PGPASSWORD=unquote(url.password or ''),PGDATABASE=database,
      PGAPPNAME='sabalan-retire-'+operation[:32],PGCONNECT_TIMEOUT='5',PGOPTIONS='',PGSERVICE='',PGSERVICEFILE='/dev/null',PGPASSFILE='/dev/null')
    ids={key:os.environ['DEPLOYMENT_'+suffix] for key,suffix in [('id','ID'),('release','RELEASE_ID'),('lease','LEASE_TOKEN')]}
    require(all(re.fullmatch(r'[A-Za-z0-9_-]{1,256}',value) for value in ids.values()))
    namespaces=','.join("'"+record['value']['namespace']+"'" for record in records) or "''"
    sql="SELECT json_build_object('name',current_database(),'oid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),'system',(SELECT system_identifier::text FROM pg_control_system()),'visible',(rolsuper OR pg_has_role(current_user,'pg_read_all_stats','MEMBER')),'sessions',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name IN ("+namespaces+")),'prepared',(SELECT count(*) FROM pg_prepared_xacts WHERE database=current_database()),'onlineReleases',(SELECT count(*) FROM online_releases),'onlineEpochs',(SELECT count(*) FROM online_serving_epochs),'owned',EXISTS(SELECT 1 FROM deployment_operations WHERE id='"+ids['id']+"' AND \"releaseId\"='"+ids['release']+"' AND \"leaseToken\"='"+ids['lease']+"' AND \"activeKey\"='production' AND phase IN ('MIGRATIONS_APPLIED','RELEASE_STARTED') AND \"leaseExpiresAt\">clock_timestamp()+interval '20 seconds')) FROM pg_roles WHERE rolname=current_user"
    observed=query(sql,environment);require(observed['owned'] is True and observed['visible'] is True and observed['sessions']==observed['prepared']==observed['onlineReleases']==observed['onlineEpochs']==0)
    for record in records:require(record['database']==dict(database=observed['name'],oid=observed['oid'],system=observed['system']))
    owner.assert_control_lock(directory)
    if not records:return
    parent=directory/'protected-legacy-retirement'
    if not parent.exists():parent.mkdir(mode=0o700)
    require(parent.resolve()==parent and parent.stat().st_uid==0 and not parent.stat().st_mode&0o077)
    archive=parent/operation;archive.mkdir(mode=0o700);mutated=True
    for directory_entry in [directory,parent]:
        durable=os.open(directory_entry,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:os.fsync(durable)
        finally:os.close(durable)
    def publish(file,raw):
        fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
        try:
            with os.fdopen(fd,'wb',closefd=False) as stream:stream.write(raw);stream.flush();os.fsync(fd)
        finally:os.close(fd)
    for record in records:publish(archive/record['file'].name,record['raw'])
    audit=dict(format='sabalan-protected-legacy-record-retirement/v1',deploymentId=ids['id'],releaseId=ids['release'],
      originalNamespaceSql=observed,records=[dict(file=record['file'].name,sha256=hashlib.sha256(record['raw']).hexdigest(),nativeStatus=record['value']['nativeStatus']) for record in records],
      nativeOwnershipAdopted=False,applicationSignalled=False,acceptanceGranted=False)
    publish(archive/'retirement-intent.json',encoded(audit));archive_fd=os.open(archive,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(archive_fd)
    finally:os.close(archive_fd)
    require(query(sql,environment)==observed);owner.assert_control_lock(directory)
    for record in records:
        _value,raw,identity=read(record['file']);require(raw==record['raw'] and identity==record['pin']);os.unlink(record['file'])
    root_fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(root_fd)
    finally:os.close(root_fd)
    publish(archive/'retired.json',encoded(audit))
    durable=os.open(archive,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(durable)
    finally:os.close(durable)

if __name__=='__main__':
    def interrupted(number,frame):raise RuntimeError('PROTECTED_LEGACY_RETIREMENT_INTERRUPTED')
    for number in [signal.SIGTERM,signal.SIGINT,signal.SIGHUP]:signal.signal(number,interrupted)
    try:run()
    except BaseException:
        if mutated or any(row['process'].poll() is None for row in originals):
            for number in [signal.SIGTERM,signal.SIGINT,signal.SIGHUP,signal.SIGPIPE]:signal.signal(number,signal.SIG_IGN)
            while True:time.sleep(1)
        raise
    finally:
        if not mutated or all(row['process'].poll() is not None for row in originals):
            for descriptor in locks:os.close(descriptor)
