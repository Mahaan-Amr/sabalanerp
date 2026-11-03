"""Finite protocol peer for original-child custody tests; no SSH or admission."""
import hashlib,io,json,pathlib,runpy,sys
root=pathlib.Path(sys.argv[1]);images=json.loads(pathlib.Path(sys.argv[2]).read_bytes());mode=sys.argv[3]
channel=runpy.run_path(str(root/'deploy/scripts/original-image-repository-channel.py'))
transfer=runpy.run_path(str(root/'tests/online-deployment/independent-image-transfer.fixture.py'))
operation='a'*32;point='/root/sabalan-recovery-private/image-repository-'+operation
assert sys.stdin.buffer.read(7)==b'SOURCE\n'
stored=[];retrieved=[];data={}
try:
 for index,role in enumerate(('backend','inquiry','frontend')):
  wanted=transfer['request'](operation,role,index,point+'/'+role+'.sabrec',images[role]['cipher']['bytes'],images[role]['cipher']['sha256'])
  channel['write_frame'](sys.stdout.buffer,wanted);transfer['read_begin'](sys.stdin.buffer,wanted)
  sink=io.BytesIO();digest=transfer['copy_exact'](sys.stdin.buffer,sink,wanted['bytes']);assert digest==wanted['sha256'];data[role]=sink.getvalue()
  stored.append(dict(role=role,path=wanted['path'],bytes=wanted['bytes'],sha256=digest,fsyncFileAndDirectory=True,fullReadbackVerified=True))
  if mode=='cut' and index==0:sys.exit(7)
 if mode in ['closed-negative','unknown-negative']:
  channel['write_frame'](sys.stdout.buffer,dict(event='IMAGE_REPOSITORY_NEGATIVE',operation=operation,fullOperation='b'*32,failureType='FixtureFailure',partialPointPreserved=True,originalChildren=[],interrupted=False,allOriginalChildrenClosed=mode=='closed-negative',productionAdmission=False))
  assert sys.stdin.buffer.read(1)==b'';sys.exit(1)
 for index,role in enumerate(('backend','inquiry','frontend')):
  wanted=transfer['request'](operation,role,index,point+'/'+role+'.sabrec',images[role]['cipher']['bytes'],images[role]['cipher']['sha256'])
  retrieved.append(channel['send_retrieval'](io.BytesIO(data[role]),sys.stdout.buffer,sys.stdin.buffer,wanted,lambda:None))
 backend=images['backend'];proof=dict(format='sabalan-source-a-independent-image-stream-gcm/v1',image=backend['image'],gcmAuthenticated=True,cipherBytes=backend['cipher']['bytes'],cipherSha256=backend['cipher']['sha256'],plainBytes=backend['gzip']['bytes'],plainSha256=backend['gzip']['sha256'],independentPublicKeySha256='455e5a7ba5990866ca6992c0fd177fa0df5b22b5d3e985c41ee306e3a779b8af',privateRsaExported=False,plaintextPersisted=False,productionAdmission=False)
 result=dict(format='sabalan-c3-image-repository-original/v1',operation=operation,fullOperation='b'*32,point=point,images=images,stored=stored,retrieved=retrieved,independentBackend=proof,originalChildren=[dict(code=0,pipesClosed=True,stdoutEof=True,stderrEof=True,observationFault=None)],allOriginalChildrenClosed=True,canonicalReserveBytes=1,floorBytes=1+512*1024**2,allocatedContentEstimateBytes=1,retrievalQualified=True,incidentHoldPreserved=True,imageImported=False,productionAdmission=False)
 if mode=='wrong-proof':result['independentBackend']['gcmAuthenticated']=False
 channel['write_frame'](sys.stdout.buffer,dict(event='IMAGE_REPOSITORY_RESULT',result=result));assert sys.stdin.buffer.read(1)==b''
except Exception:
 while sys.stdin.buffer.read(262144):pass
 sys.exit(8)
