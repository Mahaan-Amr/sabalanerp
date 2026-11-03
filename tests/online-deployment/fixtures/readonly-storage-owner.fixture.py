"""Finite protocol peer; remote storage/health are explicitly modeled."""
import hashlib,json,pathlib,subprocess,sys
reference,digest,mode=sys.argv[1:];raw=pathlib.Path(reference).read_bytes();assert hashlib.sha256(raw).hexdigest()==digest
config=json.loads(raw);operation=config['operation'];audit=pathlib.Path(config['auditDirectory'])
print(json.dumps(dict(format='sabalan-r9-master-private-credential-ready/v1',operation=operation,credentialsRead=False,productionAdmission=False)),flush=True)
frame=sys.stdin.buffer.readline();credential=json.loads(frame);assert credential['operation']==operation;assert sys.stdin.buffer.read()==b''
child=subprocess.Popen([sys.executable,'-I','-B','-c',"print('finite-owned-fixture')"],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
out,error=child.communicate();assert child.returncode==0 and not error and out.strip()==b'finite-owned-fixture'
passed=mode in ['success','missing-recovery'];gate=lambda project:dict(ok=passed,project=project,mode='plan',removed=[],requiredBytes=1,availableBytes=1024**3)
result=dict(format='sabalan-readonly-storage-preflight-owner/v1',operation=operation,rootOperation=config['rootOperation'],runtimeSpecSha256=config['runtime']['sha256'],originalCustodyKnown=mode!='unknown',preflightSucceeded=passed,remoteActorsStarted=True,deletionApplied=False,storagePolicyChanged=False,productionAdmission=False,
 source=dict(operation=operation,preflightSucceeded=passed,allOriginalChildrenClosed=True,deletionApplied=False,source=gate('sabalanerp'),productionCommitBefore='a'*40,productionCommitAfter='a'*40),
 backup=dict(operation=operation,preflightSucceeded=passed,allOriginalChildrenClosed=True,deletionApplied=False,FD9AndFD10HeldThroughPreflight=True,backup=gate('sabalanerp-backup'),budget=dict(fixtureOnly=True),filesystem=dict(fixtureOnly=True)),fixtureOnly=True)
snapshot=dict(observedAt='2026-11-01T12:00:00Z',metadata=dict(clear=True,transactionReadOnly=True,contentsReturned=False,state=dict(mode='NORMAL',operationPresent=False),markers={name:False for name in ['pending-restore.json','deployment-maintenance.json','restart-inquiry','inquiry-stopped']},activeCounts=dict(CREATING=0,VALIDATING=0,RESTORING=0)))
result['source']['recoveryReadiness']=[]if mode=='missing-recovery'else[snapshot,snapshot,snapshot]
body=(json.dumps(result)+'\n').encode();file=audit/'owner-result.json'
with file.open('xb') as stream:stream.write(body);stream.flush();__import__('os').fsync(stream.fileno())
print(json.dumps(dict(format='sabalan-readonly-storage-preflight-owner-result/v1',operation=operation,file=str(file),sha256=hashlib.sha256(body).hexdigest(),preflightSucceeded=passed,outerOriginalClosurePending=True,productionAdmission=False)),flush=True)
