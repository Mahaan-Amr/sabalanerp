"""SOURCE ONLY: one test-owned source guard + separate output publication.

Do not execute until independent review. No live lease, SQL, Docker or runner.
"""
import os,sys,json,uuid,tempfile,hashlib,importlib.util
from pathlib import Path
if os.name!='nt' or len(sys.argv)!=1:raise SystemExit('FIXED_TEST_ONLY')
source=Path(__file__).with_name('reconciliation-successor-supervisor.test-only.py').absolute()
expected='9ddf08d0409430d91a6fa763e8ffbbbb7a7618a4bf3eedb0ccb7b6d9c8544edc'
if hashlib.sha256(source.read_bytes()).hexdigest()!=expected:raise RuntimeError('SUPERVISOR_SOURCE_PIN')
sys.argv=[str(source),'successor']
spec=importlib.util.spec_from_file_location('fixture_supervisor',source);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

def main():
    module.PINS.update({
      'scripts/lib/reconciliation-phase1-operational.mjs':'61b21c50f55eca413bb7def157cef658aee72347ba3aa434e6516923de35012e',
      'scripts/lib/reconciliation-phase1-evidence.ps1':'7ca63dd78bb04c801a2fc98299e7cd816e8f0cc6db84474bcb5c5395b0ae765f',
      'scripts/lib/reconciliation-phase1-review-anchor.mjs':'3bbf1688630001f8f8250acfc8c92ba02e70b1606250666fc2c1ccda3a413450',
    })
    m,srcRoot,srcId,_=module.prepare_fixture()
    temp=Path(tempfile.gettempdir()).absolute();m.no_reparse(temp)
    outRoot=temp/('sabalan-source-guard-output-'+uuid.uuid4().hex);m.create_private(outRoot);outId=m.root_identity(outRoot)
    if srcRoot==outRoot:raise RuntimeError('ROOTS_NOT_SEPARATE')
    guards=None;close='UNKNOWN';events=[];result={'fixtureOnly':True,'status':'UNKNOWN','semanticOutcome':'NOT_EVALUATED','crashDurability':'UNKNOWN','sourceRace':'UNPROVEN','nativeOpenEvents':events}
    try:
        node=Path(r'C:\Program Files\nodejs\node.exe');m.no_reparse(node)
        nodeHash=hashlib.sha256(node.read_bytes()).hexdigest()
        if nodeHash!='364dbc8442f8d5c04fd4226bcfcf8e60d3268627eb1d7be214a91bb7d74cdbb9':raise RuntimeError('NODE_RUNTIME_PIN')
        result['nodeRuntimeSha256']=nodeHash;result['nodeRuntimeIdentity']='PATH_SNAPSHOT_ONLY';result['nodeRuntimeVersion']='UNVERIFIED_IN_THIS_TEST'
        candidate=Path(r'C:\Users\mahan\AppData\Local\Temp\sabalan-419-held-window-20261102\phase1-candidate-source-manifest-evidence-v2.json')
        manifest=candidate.read_bytes();manifestHash=hashlib.sha256(manifest).hexdigest()
        if manifestHash!='0108017801b22b40953a391c2558b7df32a77617984b23f659df1fe581fe6dfb':raise RuntimeError('MANIFEST_PIN')
        m.write_bytes(srcRoot/'candidate-manifest.json',manifest)
        extras={name:hashlib.sha256((srcRoot/name).read_bytes()).hexdigest() for name in ('fixture-manifest.json','fixture-anchor.json','candidate-manifest.json')}
        guards,ids=module.guard_staged_sources(srcRoot,m,extras,events)
        result['sourceGuardCount']=len(guards);result['sourceHandleIdentities']=ids
        # Native flags and results are captured; no bytes are written even if
        # a write/delete-capable open unexpectedly succeeds.
        probe=srcRoot/'scripts/lib/reconciliation-phase1-core.mjs'
        def probe_open(name,access):
            h=module.K.CreateFileW(str(probe),access,7,None,3,0x00200000,None)
            if h==module.C.c_void_p(-1).value:
                code=module.C.get_last_error();events.append({'operation':name,'access':access,'share':7,'disposition':3,'flags':0x00200000,'win32':code,'close':'NOT_OPENED'});return code
            closed=bool(module.K.CloseHandle(h));events.append({'operation':name,'access':access,'share':7,'disposition':3,'flags':0x00200000,'win32':0,'close':'CLOSED' if closed else 'UNKNOWN'})
            if not closed:raise RuntimeError('PROBE_CLOSE_UNKNOWN')
            return 0
        if probe_open('LOADER_READ',0x80000000)!=0:raise RuntimeError('LOADER_READ_UNPROVEN')
        if probe_open('WRITE_OPEN',0x40000000)!=32:raise RuntimeError('SOURCE_WRITE_NOT_DENIED')
        if probe_open('DELETE_OPEN',0x00010000)!=32:raise RuntimeError('SOURCE_DELETE_NOT_DENIED')
        if m.root_identity(outRoot)!=outId:raise RuntimeError('OUTPUT_ROOT_CHANGED')
        stage=outRoot/'receipt.staging';final=outRoot/'receipt.json'
        raw=json.dumps({'fixtureOnly':True,'event':'GUARD_OUTPUT_TEST','directoryDurability':'UNKNOWN'}).encode()
        m.write_bytes(stage,raw);os.link(stage,final)
        if final.read_bytes()!=raw:raise RuntimeError('OUTPUT_READBACK_MISMATCH')
        result['outputPublishedNoReplace']=True;result['outputSha256']=hashlib.sha256(raw).hexdigest()
        result['status']='OBSERVED_TEST_FACTS'
    except BaseException as error:
        result['status']='UNKNOWN';result['failureType']=type(error).__name__ if type(error).__name__ in ('OSError','RuntimeError','ValueError') else 'OTHER'
    finally:
        if guards is not None:
            close='CLOSED'
            for handle in reversed(guards):
                if not module.K.CloseHandle(handle):close='UNKNOWN'
        result['guardClose']=close
        if close!='CLOSED':result['status']='UNKNOWN'
        try:
            if m.root_identity(outRoot)!=outId:raise RuntimeError('OUTPUT_ROOT_CHANGED')
            m.write_bytes(outRoot/'observation.json',json.dumps(result,sort_keys=True).encode())
        except BaseException:result['status']='UNKNOWN';result['receipt']='UNAVAILABLE'
        print(json.dumps({'sourceRoot':str(srcRoot),'outputRoot':str(outRoot),**result},sort_keys=True),flush=True)

if __name__=='__main__':main()
