"""Fixed original-host private QA initialization/fence, never release admission."""
import base64
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from urllib.parse import urlsplit, unquote

assert not sys.flags.optimize
os.umask(0o077)
request=json.load(sys.stdin)
assert set(request)=={'root','mode','materials','bootstrapSha256'}
root=Path(request['root']);assert re.fullmatch(r'/app/online-runtime-acceptance/application-native-[a-f0-9]{32}',str(root)) and root.resolve(strict=True)==root
index=json.loads((root/'index.json').read_bytes());config=json.loads((root/'config.json').read_bytes());pair=index['privateQualification']
mode=request['mode'];assert mode in ['initialize','fence','close']
materials=request['materials'];grants=[pair['httpGrant'],pair['jobsGrant']]
canonical=lambda value:json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode('utf8')
sha=lambda raw:hashlib.sha256(raw).hexdigest()
spec=importlib.util.spec_from_file_location('fixed_original_qualification_verify',root/'original-host-controller-channel.py')
module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
enrollment=config['originalHostEnrollment'];channel=module.OriginalHostChannel(enrollment['publicKey'],enrollment['session'],'main')
key=Path('/run/sabalan-online/qualification-controller-public-key.pem');key_raw=key.read_bytes();key_stat=key.lstat()
assert stat.S_ISREG(key_stat.st_mode) and key_stat.st_nlink==1 and key_stat.st_uid==0 and key_stat.st_mode&0o777==0o444
assert base64.b64decode(b''.join(key_raw.splitlines()[1:-1]),validate=True)==base64.b64decode(enrollment['publicKey'],validate=True)
assert set(materials)=={grant['scope']['runtimeId'] for grant in grants}
owned=[];gate=None

def write(file,raw):
 descriptor=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
 try:
  offset=0
  while offset<len(raw):offset+=os.write(descriptor,raw[offset:])
  os.fsync(descriptor)
 finally:os.close(descriptor)
 parent=os.open(file.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(parent)
 finally:os.close(parent)

def sql(text):
 source=urlsplit(os.environ['DATABASE_URL']);assert source.hostname=='postgres' and source.path=='/sabalanerp'
 env=dict(os.environ,PGHOST='postgres',PGPORT=str(source.port or 5432),PGUSER=unquote(source.username),PGPASSWORD=unquote(source.password),
  PGDATABASE=index['restoredDatabase'],PGAPPNAME='private-qualification-original-initializer',PGCONNECT_TIMEOUT='5',
  PGOPTIONS='-c statement_timeout=240000 -c lock_timeout=240000')
 child=subprocess.Popen(['psql','-X','-A','-t','-v','ON_ERROR_STOP=1','-c',text],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE);owned.append(child)
 out,err=child.communicate();assert child.returncode==0 and len(out)<=65536 and len(err)<=65536
 return out.decode().strip()

try:
 decisions=[];artifacts=[]
 for grant in grants:
  material=materials[grant['scope']['runtimeId']];assert set(material)=={'decision','artifacts'}
  envelope=material['decision'];assert envelope['format']=='sabalan-signed-online-private-qualification/v1'
  decision=envelope['decision'];artifact=material['artifacts']
  assert channel._verify(b'sabalan-online-private-qualification/v1\n'+canonical(decision),base64.b64decode(envelope['signature'],validate=True))
  assert decision['scopeSha256']==grant['sha256'] and decision['runtimeId']==grant['scope']['runtimeId']
  assert decision['runtimePurpose']==grant['scope']['purpose'] and decision['qualificationId']==pair['qualificationId']
  assert decision['artifactsSha256']==sha(canonical(artifact)) and artifact['qualificationRoot']==pair['qualificationRoot']
  assert decision['database']==dict(name=index['restoredDatabase'],oid=str(index['restoredOid']),systemIdentifier=grant['scope']['database']['systemIdentifier'])
  decisions.append(decision);artifacts.append(artifact)
 channel.assert_observers_closed()
 targets=artifacts[0]['targets'];assert len(targets)==1 and artifacts[1]['targets']==targets
 target=targets[0];assert all(re.fullmatch(r'[a-f0-9]{64}',target[key]) for key in ['runtimeId','nonceSha256','scopeSha256'])
 assert re.fullmatch(r'[A-Za-z0-9_-]{8,128}',target['releaseId']) and re.fullmatch(r'sha256:[a-f0-9]{64}',target['imageIdentity'])
 targets_sha=artifacts[0]['targetsSha256'];assert targets_sha==artifacts[1]['targetsSha256']==sha(canonical(targets))
 cluster=grants[0]['scope']['database']['systemIdentifier'];assert re.fullmatch(r'[1-9][0-9]*',cluster)
 identity="SELECT current_database()||':'||(SELECT oid::text FROM pg_database WHERE datname=current_database())||':'||(SELECT system_identifier::text FROM pg_control_system())"
 assert sql(identity)==index['restoredDatabase']+':'+str(index['restoredOid'])+':'+cluster
 if mode=='initialize':
  for grant in grants:
   assert not (Path(grant['scope']['nativeDirectory'])/'deployment-runtime-native.json').exists()
   assert not (Path(grant['scope']['boundaryDirectory'])/'claim.json').exists()
  definition=grants[0]['scope']['gate'];gate=os.open(definition['file'],os.O_RDWR|os.O_NOFOLLOW)
  actual=os.fstat(gate);assert str(actual.st_dev)==definition['device'] and str(actual.st_ino)==definition['inode'] and actual.st_uid==definition['ownerUid']
  fcntl.flock(gate,fcntl.LOCK_EX|fcntl.LOCK_NB)
  assert sql("SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid())+(SELECT count(*) FROM pg_prepared_xacts WHERE database=current_database())")=='0'
  bootstrap=(root/'private-qualification-bootstrap.sql').read_bytes();assert sha(bootstrap)==request['bootstrapSha256']
  assert sql("SELECT to_regclass('public.private_qualification_runtime_targets') IS NULL")=='t'
  values=','.join("'"+str(value)+"'" for value in [pair['qualificationId'],target['runtimeId'],target['nonceSha256'],target['releaseId'],target['imageIdentity'],target['scopeSha256'],targets_sha,'ACTIVE'])
  sql('BEGIN;'+bootstrap.decode()+"INSERT INTO private_qualification_runtime_targets (\"qualificationId\",\"runtimeId\",\"nonceSha256\",\"releaseId\",\"imageIdentity\",\"scopeSha256\",\"targetsSha256\",phase) VALUES ("+values+");COMMIT;")
  restore=(root/'restored-file-baseline.json').read_bytes()
  for grant,decision,artifact in zip(grants,decisions,artifacts):
   assert sha(restore)==decision['restoreManifestSha256']
   directory=Path(grant['scope']['nativeDirectory'])/'private-qualification';directory.mkdir(mode=0o700)
   write(directory/'decision.json',canonical(materials[grant['scope']['runtimeId']]['decision']))
   write(directory/'artifacts.json',canonical(artifact));write(directory/'restore-input-manifest.json',restore)
 else:
  before,after=('ACTIVE','DRAINING') if mode=='fence' else ('DRAINING','CLOSED')
  where=' AND '.join('"'+key+'"=\''+value+'\'' for key,value in [('qualificationId',pair['qualificationId']),('runtimeId',target['runtimeId']),('nonceSha256',target['nonceSha256']),('scopeSha256',target['scopeSha256']),('targetsSha256',targets_sha)])
  # The same guarded target row is locked FOR SHARE by actual producer census.
  changed=sql("WITH changed AS (UPDATE private_qualification_runtime_targets SET phase='"+after+"' WHERE "+where+" AND phase='"+before+"' RETURNING 1) SELECT count(*) FROM changed")
  assert changed=='1'
 print(json.dumps(dict(format='sabalan-original-private-qualification-initializer/v1',mode=mode,qualificationId=pair['qualificationId'],
  databaseName=index['restoredDatabase'],databaseOid=str(index['restoredOid']),systemIdentifier=cluster,targetsSha256=targets_sha,
  targetCount=1,phase='ACTIVE' if mode=='initialize' else 'DRAINING' if mode=='fence' else 'CLOSED',
  originalSqlChildren=[dict(pid=child.pid,returncode=child.returncode,reaped=True) for child in owned],productionAdmission=False)))
finally:
 for child in owned:
  while child.poll() is None:
   try:child.communicate()
   except BaseException:continue
 channel.assert_observers_closed()
 if gate is not None:os.close(gate)
