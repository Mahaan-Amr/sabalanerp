"""Actual typed-proof/producer/pipe method regression; consumer is a regression fixture.
Not canonical spawn_edge/native-business qualification or release admission.
"""
import hashlib,importlib.util,json,os,secrets,shutil,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];DRAFT=ROOT
if sys.platform!='linux':
 print('SKIP actual original typed abort pipe requires Linux')
 sys.exit(0)
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,file);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m
api=load('negative_abort_actual_api',ROOT/'deploy/scripts/readonly-transport-retirement.py')
cap=load('application_native_coherent_join',DRAFT/'tests/online-deployment/application-native-capture.fixture.py')
with tempfile.TemporaryDirectory(prefix='sabalan-original-negative-') as temporary:
 root=Path(temporary).resolve()
 for name in ['readonly-transport-retirement.py','online-runtime-owner.py','backend-runtime-owner.py','online-runtime-scope.py','online-backend-boundary.py','online-capture-admission.py']:
  shutil.copyfile(ROOT/'deploy/scripts'/name,root/name)
 # These inert files bind only the regression constructor, never a qualified runtime.
 for name in ['application-worker.cjs','application-routing.mjs']:(root/name).write_text('throw new Error("REGRESSION_INERT_NOT_A_RUNTIME");\n')
 protocol=dict(format='sabalan-reviewed-diagnostic-readonly-socket-protocol/v1',bundleSha256=api.digest((root/'application-worker.cjs').read_bytes()),sources=api.APPROVED_PROTOCOL_SOURCES,productionAdmission=False)
 (root/'readonly-socket-protocol.json').write_bytes(api.encode(protocol));(root/'readonly-socket-protocol.json').chmod(0o400)
 owner=api.OriginalReadonlyTransportController(root) # Real constructor and _owned checks; no __new__/stub proof.
 def forbidden_sql(query):raise AssertionError('No SQL is authorized by this regression')
 cap.initialize_original_capture_context(root,forbidden_sql)
 proof=cap.original_capture_failure_proof();facts=cap.read_original_capture_failure_proof(proof)
 assert facts['originalPass'] is False and facts['captureNeverStarted'] is True
 enrollment=secrets.token_hex(32);read_fd,write_fd=os.pipe();owner._writer=write_fd;owner._enrollment={'enrollmentId':enrollment}
 child_code=r"""import os,sys,json,hashlib
fd=int(sys.argv[1]);root=sys.argv[2];enrollment=sys.argv[3];raw=b''
while b'\n' not in raw:
 chunk=os.read(fd,4096-len(raw));assert chunk;raw+=chunk;assert len(raw)<=4096
v=json.loads(raw);assert v['decision']=='CAPTURE_ABORT' and v['productionAdmission'] is False
assert v['enrollmentId']==enrollment and v['operation']==os.path.basename(root)
f=v['captureFailure'];assert f['root']==root and f['originalPass'] is False and f['captureNeverStarted'] is True
assert f['originalCapturePid'] is None and f['originalCaptureReturncode'] is None
print(json.dumps({'negativeFrameVerified':True,'captureNeverStarted':True,'productionAdmission':False}))
sys.exit(75)
"""
 child=subprocess.Popen([sys.executable,'-I','-B','-c',child_code,str(read_fd),str(root),enrollment],pass_fds=(read_fd,),stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 owner._edge=child;os.close(read_fd) # THIS Popen is retained from its initial creation; never adopted.
 ready=api.encode(dict(originalEdgePid=child.pid,enrollmentId=enrollment))
 try:
  try:owner.abort_capture(object(),ready)
  except RuntimeError:pass
  else:raise AssertionError('Forged proof accepted')
  owner.abort_capture(proof,ready)
  stdout,stderr=child.communicate() # Same original handle and both EOFs; no signals or replacement owner.
  assert child.returncode==75 and stderr==b'' and json.loads(stdout)['negativeFrameVerified'] is True
  assert not any(root.glob('browser-finish.json'))
  print(json.dumps(dict(test='actual-typed-proof-and-inherited-negative-pipe-method',methodTestPassed=True,originalChildPid=child.pid,code=child.returncode,pipesClosed=True,signalSent=False,productionAdmission=False,canonicalEdgeQualified=False,consumer='regression-fixture')))
 finally:
  os.close(write_fd)
  if child.poll() is None:child.communicate() # Retain ownership on failure, never kill to manufacture closure.
