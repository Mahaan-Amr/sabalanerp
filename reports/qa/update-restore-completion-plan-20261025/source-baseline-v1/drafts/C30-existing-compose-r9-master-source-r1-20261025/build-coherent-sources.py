"""Pure finite RESTORED_QA specializations; no runtime/helper execution."""
from pathlib import Path
import hashlib, ast
R=Path('C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp')
D=Path(__file__).parent
ROOT=r'/app/runtime-authority/application-native-[a-f0-9]{32}/restored-complete-app/coherent-private'
def read(name):return (R/'tests/online-deployment'/name).read_text()
def replace(s,a,b):
 assert s.count(a)==1,(a,s.count(a));return s.replace(a,b)
def build():
 output={}
 baseline=read('independent-restored-baseline.worker.cjs')
 a=baseline.index("  if(input.captureSource==='independent-physical-v3'){");b=baseline.index('  const required=',a)
 baseline=baseline[:a]+'''  assert.equal(input.captureSource,'live-verified-complete-restored-qa');
  const lineage=input.restoredQaLineage;
  assert.equal(lineage.format,'sabalan-live-restored-qa-private-lineage/v1');
  assert.equal(lineage.cleanupPending,true);assert.equal(lineage.independentPointHealthy,false);assert.equal(lineage.productionAdmission,false);
  assert.equal(hash(restoreRaw),lineage.completeManifestSha256);assert.equal(JSON.stringify(restore),restoreRaw.toString('utf8'));
  assert.equal(restore.format,'sabalan-recovery');assert.equal(restore.packageType,'COMPLETE');
  assert.deepEqual(lineage.targetDatabase,input.database);assert.notEqual(lineage.sourceDatabase.systemIdentifier,input.database.systemIdentifier);
  assert.equal(input.originalRestoreOutput.sha256,lineage.completeManifestSha256);
'''+baseline[b:]
 baseline=replace(baseline,"captureSource:input.captureSource==='independent-physical-v3'?'independent-physical-v3':'canonical-complete-package',", "captureSource:'live-verified-complete-restored-qa',restoredQaLineage:input.restoredQaLineage,")
 output['independent-restored-baseline.worker.cjs']=baseline
 observer=read('independent-private-qualification-observer.fixture.py').replace('/app/online-runtime-acceptance/application-native-[a-f0-9]{32}',ROOT)
 a=observer.index("    assert re.fullmatch(r'qa_application_native_");b=observer.index('    source_native = {}',a)
 observer=observer[:a]+'''    lineage=index['restoredQaLineage']
    assert lineage['format']=='sabalan-live-restored-qa-private-lineage/v1'and lineage['cleanupPending']is True and lineage['independentPointHealthy']is False and lineage['productionAdmission']is False
    assert lineage['targetDatabase']==database and lineage['sourceDatabase']['systemIdentifier']!=database['systemIdentifier']
    assert manifest['restoredQaLineage']==lineage and index['sourceDatabaseRole']=='VERIFIED_COMPLETE_RESTORED_QA'
    assert index['database']==lineage['sourceDatabase']['name']and str(index['oid'])==lineage['sourceDatabase']['oid']
'''+observer[b:]
 observer=replace(observer,'sourceSql=source_sql, sourceNative=source_native,','restoredQaLineage=lineage, sourceNative=source_native,')
 output['private-qualification-observer.py']=observer
 runtime=read('independent-private-runtime.fixture.py').replace('/app/online-runtime-acceptance/application-native-[a-f0-9]{32}',ROOT)
 runtime=replace(runtime,"    env.pop('NODE_OPTIONS', None); env.pop('NODE_PATH', None)","    for name in list(env):\n        if name.startswith(('BACKEND_CONTROL_','BACKEND_CAPTURE_','BACKEND_NATIVE_','BACKEND_ONLINE_','BACKEND_WORKER_','INQUIRY_NATIVE_')):env.pop(name)\n    env.update(BACKEND_RUNTIME_ROLE=grant['scope']['role'],BACKEND_ONLINE_SCOPE_FILE=grant['file'],BACKEND_ONLINE_SCOPE_SHA256=grant['sha256'])\n    env.pop('NODE_OPTIONS', None); env.pop('NODE_PATH', None)")
 runtime=runtime.replace("subprocess.Popen(['/usr/bin/python3',", "subprocess.Popen(['/usr/bin/python3.11',")
 output['independent-private-runtime.py']=runtime
 output['private-qualification-materialize.py']=read('independent-private-qualification-materialize.fixture.py').replace('/app/online-runtime-acceptance/application-native-[a-f0-9]{32}',ROOT)
 for name in ['original-host-controller-channel.fixture.py']:
  output['original-host-controller-channel.py'if name.endswith('.fixture.py')else name]=read(name)
 for name,source in output.items():
  if name.endswith('.py'):ast.parse(source)
  (D/name).write_text(source,newline='\n')
 return output
if __name__=='__main__':
 for name,source in build().items():print(name,hashlib.sha256(source.encode()).hexdigest())
