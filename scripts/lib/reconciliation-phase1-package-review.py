"""Offline packaging after an actual review; no lease, runner, DB or deploy.

The external review record is evidence of review scope, not human permission
to execute. Existing output files are never overwritten.
"""
import hashlib,json,os,re,sys,uuid,subprocess
from pathlib import Path

def publish_package(external,reviewBytes,indexBytes,manifestBytes,anchorBytes,priorFailureSha256):
    # A fresh, unique run directory is never reused or repaired after failure.
    package=external/('phase1-package-'+uuid.uuid4().hex)
    package.mkdir()
    outputs=[('phase1-reviewed-evidence.json',reviewBytes),('phase1-reviewed-source-index.json',indexBytes),('phase1-reviewed-manifest.json',manifestBytes),('phase1-reviewed-external-anchor.json',anchorBytes)]
    created=[]
    try:
        for name,raw in outputs:
            dest=package/name
            with dest.open('xb') as out:
                created.append(name);out.write(raw);out.flush();os.fsync(out.fileno())
            if dest.read_bytes()!=raw:raise RuntimeError('PACKAGE_READBACK_MISMATCH')
        complete={'format':'phase1-package-complete/v1','files':{name:hashlib.sha256(raw).hexdigest() for name,raw in outputs},'priorFailureSha256':priorFailureSha256,'directoryDurability':'UNKNOWN'}
        completeBytes=(json.dumps(complete,sort_keys=True,indent=2)+'\n').encode()
        with (package/'COMPLETE.json').open('xb') as out:out.write(completeBytes);out.flush();os.fsync(out.fileno())
        if (package/'COMPLETE.json').read_bytes()!=completeBytes:raise RuntimeError('COMPLETE_READBACK_MISMATCH')
    except Exception:
        print(json.dumps({'status':'UNKNOWN_PARTIAL_PRESERVE_NO_RETRY','package':str(package),'created':created,'directoryDurability':'UNKNOWN'}),file=sys.stderr)
        raise
    return package,completeBytes

def main():
    if os.name!='nt' or len(sys.argv) not in (3,5) or not re.fullmatch('[a-f0-9]{64}',sys.argv[2]) or (len(sys.argv)==5 and not ((sys.argv[3]=='--prior-failure-sha256' and re.fullmatch('[a-f0-9]{64}',sys.argv[4])) or (sys.argv[3]=='--fixture-run' and re.fullmatch('[a-f0-9]{32}',sys.argv[4])))):
        raise SystemExit('FIXED_REVIEW_RECORD_AND_DIGEST_REQUIRED')

    fixtureRun=sys.argv[4] if len(sys.argv)==5 and sys.argv[3]=='--fixture-run' else None
    snapshot=Path(sys.argv[1]).absolute()
    temp=Path(os.environ.get('TEMP','')).absolute()
    if snapshot.parent!=temp or not re.fullmatch(r'sabalan-phase1-review-source-[a-f0-9]{32}',snapshot.name):raise SystemExit('REVIEW_SNAPSHOT_REQUIRED')
    external=Path(r'C:\Users\mahan\AppData\Local\Temp\sabalan-419-held-window-20261102')
    if fixtureRun is not None:external=temp/('sabalan-phase1-package-root-'+fixtureRun)
    review=external/'phase1-reviewed-evidence.json';reviewBytes=review.read_bytes()
    if len(reviewBytes)>65536 or hashlib.sha256(reviewBytes).hexdigest()!=sys.argv[2]:raise RuntimeError('REVIEW_DIGEST_MISMATCH')
    record=json.loads(reviewBytes);indexBytes=(snapshot/'source-index.json').read_bytes();indexHash=hashlib.sha256(indexBytes).hexdigest();index=json.loads(indexBytes)
    effects=['METADATA_OPEN_FIXED_LEASE','EXCLUSIVE_OWN_LEASE','READ_TWO_FIXED_FILES','CREATE_OWN_AUDIT_RECORDS']
    if record.get('format')!='phase1-derived-review-transcription/v1' or record.get('sourceIndexSha256')!=indexHash or record.get('verdictScope')!='LIMITED_SOURCE_REVIEW' or record.get('liveExecutionAuthorized') is not False or record.get('allowedEffects')!=effects:raise RuntimeError('REVIEW_SCOPE_MISMATCH')
    if fixtureRun is not None and record.get('testOnly') is not True:raise RuntimeError('FIXTURE_REVIEW_REQUIRED')
    pins={item['path']:item['sha256'] for item in index['sources']}
    for name,want in pins.items():
        if Path(name).is_absolute() or '..' in Path(name).parts or hashlib.sha256((snapshot/name).read_bytes()).hexdigest()!=want:raise RuntimeError('SOURCE_INDEX_MISMATCH')
    template=json.loads((snapshot/'reconciliation-phase1-intent-TEMPLATE.json').read_bytes())
    if template.get('operation')!='a0d2baba08ec7e004d1458675799db6a' or template.get('action')!='READ_ONLY_AUDIT_NEW_OWN_LEASE':raise RuntimeError('MANIFEST_SCOPE')
    for item in template['sources']:
        if pins.get(item['path'])!=item['sha256']:raise RuntimeError('MANIFEST_SOURCE_MISMATCH')
    if fixtureRun is not None:
        root=temp/('sabalan-phase1-fixture-'+fixtureRun);evidence=temp/('sabalan-evidence-fixture-'+fixtureRun)
        scenario=record.get('testScenario')
        if scenario not in ('NORMAL','DELAY_RELEASE_12S'):raise RuntimeError('FIXTURE_SCENARIO_INVALID')
        template.update(operation='TEST_ONLY',action='FIXTURE_AUDIT',testOnly=True,runId=fixtureRun,testScenario=scenario,allowedTargets=[str(root/'fixture.lock'),str(evidence/'baseline.json'),str(evidence/'role-held.json')])
    template['reviewEvidenceSha256']=sys.argv[2]
    manifestBytes=(json.dumps(template,sort_keys=True,indent=2)+'\n').encode();manifestHash=hashlib.sha256(manifestBytes).hexdigest()
    names=['reconciliation-phase1-operational.mjs','reconciliation-phase1-core.mjs','reconciliation-readonly-phase1-cli.mjs','reconciliation-phase1-census.ps1','reconciliation-phase1-evidence.ps1','reconciliation-phase1-lock-identity.ps1','serial-physical/host-lease.mjs','serial-physical/host-lease.ps1','reconciliation-phase1-verify.mjs','reconciliation-phase1-source-proof.ps1','reconciliation-phase1-launcher.mjs','reconciliation-phase1-review-anchor.mjs']
    node=r'C:\Program Files\nodejs\node.exe';python=r'C:\Users\mahan\AppData\Local\Programs\Python\Python314\python.exe'
    def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
    anchor={'format':'phase1-external-review/v1','operation':template['operation'],'action':template['action'],'reviewEvidenceSha256':sys.argv[2],'sourceIndexSha256':indexHash,'manifestSha256':manifestHash,'sourcePins':{n:pins[n] for n in names},'nativeGuardSha256':pins['reconciliation-phase1-native-guard.py'],'nodeSha256':sha(node),'nodePath':node,'nodeVersion':subprocess.check_output([node,'--version'],text=True,timeout=10).strip(),'bootstrapPins':{'nativeLauncher':pins['reconciliation-phase1-native-launcher.py'],'nativeGuard':pins['reconciliation-phase1-native-guard.py'],'node':sha(node),'python':sha(python)}}
    if fixtureRun is not None:anchor['testOnly']=True
    anchorBytes=(json.dumps(anchor,indent=2)+'\n').encode()
    package,completeBytes=publish_package(external,reviewBytes,indexBytes,manifestBytes,anchorBytes,sys.argv[4] if len(sys.argv)==5 and sys.argv[3]=='--prior-failure-sha256' else None)
    print(json.dumps({'package':str(package),'completeSha256':hashlib.sha256(completeBytes).hexdigest(),'anchorSha256':hashlib.sha256(anchorBytes).hexdigest(),'manifestSha256':manifestHash,'sourceIndexSha256':indexHash,'liveApproval':False}))

if __name__ == '__main__':
    main()
