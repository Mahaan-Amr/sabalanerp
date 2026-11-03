"""Actual finite originals of the packaged no-delete owner; no SSH/runtime."""
import ast,hashlib,json,os,pathlib,runpy,signal,subprocess,sys,tempfile,textwrap,threading,unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]
source=runpy.run_path(str(ROOT/'deploy/scripts/original-c3-backend-stream-source.py'))
builder=runpy.run_path(str(ROOT/'deploy/scripts/original-readonly-storage-source.py'))
owner_module=runpy.run_path(str(ROOT/'deploy/scripts/original-readonly-storage-preflight.py'))
retained_executable=owner_module['retained_backup_executable']
core=source['execute_source'](builder['original_windows_owner'](source),'same-readonly-original.py','readonly_original_test')

class ReadOnlyOriginals(unittest.TestCase):
 def test_actual_finite_metadata_child_refuses_active_or_malformed_recovery(self):
  module=runpy.run_path(str(ROOT/'deploy/scripts/original-readonly-storage-source-remote.py'));readiness=runpy.run_path(str(ROOT/'deploy/scripts/original-source-runtime-diagnostics.py'),run_name='fixed_metadata_definitions');probe=module['source_recovery_readiness'];backend='1'*64
  for mode in ['normal','active','malformed']:
   with self.subTest(mode=mode):
    payload=dict(transactionReadOnly=True,contentsReturned=False,state=dict(mode='NORMAL',operationPresent=False),markers={name:False for name in ['pending-restore.json','deployment-maintenance.json','restart-inquiry','inquiry-stopped']},activeCounts=dict(CREATING=0,VALIDATING=0,RESTORING=1 if mode=='active'else 0))
    if mode=='malformed':payload['activeCounts']['RESTORING']='0'
    class Host:
     def __init__(self):self.children=[]
     def run(host,argv,maximum):
      self.assertEqual(argv[:6],['docker','exec',backend,'node','--max-old-space-size=128','-e']);self.assertEqual(argv[6],readiness['RECOVERY_METADATA_PROBE']);self.assertEqual(maximum,256*1024)
      # Real owned Node/EOF; SQL/Linux authority are modeled, never runtime admission.
      child=subprocess.Popen(['C:/Program Files/nodejs/node.exe','-e','process.stdout.write('+json.dumps(json.dumps(payload))+'+"\\n")'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
      out,err=child.communicate();self.assertEqual(child.returncode,0);self.assertEqual(err,b'');self.assertTrue(child.stdout.closed and child.stderr.closed);host.children.append(dict(code=child.returncode,pipesClosed=True,stdoutSha256=hashlib.sha256(out).hexdigest()));return out
    host=Host();samples=[];probe.__globals__.update(SPEC=dict(expectedEight=[dict(id=backend,project='sabalanerp',service='backend')]),json=json,datetime=__import__('datetime'),RECOVERY_METADATA_PROBE=readiness['RECOVERY_METADATA_PROBE'],recovery_boundary_clear=readiness['recovery_boundary_clear'])
    if mode=='normal':self.assertTrue(probe(host,samples)['clear']);self.assertEqual(len(samples),1)
    else:
     with self.assertRaises(AssertionError):probe(host,samples)
     if mode=='active':self.assertFalse(samples[0]['metadata']['clear'])
    self.assertEqual(len(host.children),1)
 def test_actual_source_path_closes_real_semantic_nonzero_but_never_qualifies(self):
  # Same captured NativeHost.run and source finally; Linux FD inheritance alone
  # is modeled on Windows. No remote host, service, lock or SQL is touched.
  q=pathlib.Path('D:/sabalanerp-online-qa');inputs=json.loads((q/'419-safe-rollback-36b9f5bf09bf2a9fcf2c30644de47ee5/fresh-pre-up-production-inputs.json').read_bytes());spec=json.loads(pathlib.Path(inputs['runtime']['file']).read_bytes())
  remote=source['render_guard_artifacts'](spec,'c'*32,q/'source-not-created',None)['remote.py'];kernel=None
  for node in ast.parse(remote).body:
   if isinstance(node,ast.Assign) and isinstance(node.value,ast.Constant) and isinstance(node.value.value,(str,bytes)):
    value=node.value.value.decode() if isinstance(node.value.value,bytes) else node.value.value
    if 'class NativeHost' in value:kernel=value
  self.assertIsNotNone(kernel)
  host_class=next(n for n in ast.parse(kernel).body if isinstance(n,ast.ClassDef) and n.name=='NativeHost');run_node=next(n for n in host_class.body if isinstance(n,ast.FunctionDef) and n.name=='run')
  class Subprocess:
   DEVNULL=subprocess.DEVNULL;PIPE=subprocess.PIPE
   @staticmethod
   def Popen(argv,**kwargs):
    if sys.platform=='win32':kwargs.pop('pass_fds')
    # The actual command is an owned finite fixture, deliberately exit7.
    return subprocess.Popen([sys.executable,'-I','-B','-c',"import sys;sys.stderr.write('semantic refusal');sys.exit(7)"],**kwargs)
  scope=dict(subprocess=Subprocess,threading=threading,sha=lambda raw:hashlib.sha256(raw).hexdigest())
  exec(compile(textwrap.dedent(ast.get_source_segment(kernel,run_node)),'same-native-host-run','exec'),scope)
  class Host:
   def __init__(self):self.children=[];self.interrupted=False;self.closed=False
   def lock_guard(self):pass
   def acquire(self):pass
   def git(self,*_args):return b'a'*40
   def close(self):self.closed=True
   run=scope['run']
  host=Host();module=runpy.run_path(str(ROOT/'deploy/scripts/original-readonly-storage-source-remote.py'));execute=module['run_source_preflight'];events=[]
  def unexpected_retainer():raise RuntimeError('UNEXPECTED_FIXTURE_HELD_NO_NATIVE_OWNER')
  cwd_entered=[]
  execute.__globals__.update(k={'NativeHost':lambda *_args:host},SPEC=dict(expectedEight=[dict(id='1'*64,project='sabalanerp',service='backend')]),SPEC_SHA='a'*64,pathlib=pathlib,CAPACITY='/model/scripts/deployment-capacity.mjs',boundary=lambda _host:self.assertEqual(cwd_entered,[True]),current_node=lambda:dict(fixtureOnly=True),json=json,datetime=__import__('datetime'),RECOVERY_METADATA_PROBE='fixed-private-fixture-probe',storage_emit=lambda value:events.append(value),STORAGE_OPERATION='c'*32,retain_unknown_source_owner=unexpected_retainer,enter_source_working_directory=lambda:cwd_entered.append(True))
  self.assertEqual(execute(),0);self.assertTrue(host.closed);self.assertEqual(len(events),1);self.assertEqual(events[0]['format'],'sabalan-source-readonly-storage-closed/v1');self.assertFalse(events[0]['preflightSucceeded']);self.assertEqual(events[0]['failureStage'],'CURRENT_SYSTEM_RECOVERY');self.assertEqual(host.children[0]['code'],7);self.assertTrue(host.children[0]['pipesClosed'])
  check=execute.__globals__['source_originals_known_closed'];self.assertTrue(check(host))
  for change in [('interrupted',True),('readonly_original_pending',True)]:
   name,value=change;old=getattr(host,name);setattr(host,name,value);self.assertFalse(check(host));setattr(host,name,old)
  row=host.children[0]
  for key,value in [('code',-15),('pipesClosed',False),('observationFault','READ_FAILURE'),('pid',None)]:
   old=row[key];row[key]=value;self.assertFalse(check(host));row[key]=old
 def test_staging_requires_exact_same_full_retirement_paths_and_root(self):
  module=runpy.run_path(str(ROOT/'deploy/scripts/original-readonly-storage-backup-remote.py'));check=module['validate_storage_retirement']
  def need(value):
   if not value:raise AssertionError('RETIREMENT_REFUSED')
  parent=pathlib.Path('/root/sabalan-recovery-private');operation='d'*32;root='e'*32
  check.__globals__.update(need=need,PARENT=parent,STORAGE_CONFIGURATION=dict(rootOperation=root))
  valid=dict(format='sabalan-same-root-complete-retirement/v1',operation=operation,rootOperation=root,originalOwnerClosed=True,localJobRetired=True,backupTransferRetired=True,productionAdmission=False,backupAbsent=[str(parent/('transfer-material-'+operation)),str(parent/('transfer-'+operation))])
  check(valid)
  for change in [dict(backupAbsent=[]),dict(backupAbsent=[str(parent/'unrelated'),str(parent/'different')]),dict(rootOperation='f'*32),dict(operation='c'*32),dict(localJobRetired=False),dict(originalOwnerClosed=False),dict(productionAdmission=True)]:
   with self.assertRaises(AssertionError):check({**valid,**change})
 def test_same_source_pipe_stays_open_through_actual_backup_then_ack_and_eof(self):
  with tempfile.TemporaryDirectory(prefix='sabalan-readonly-originals-') as directory:
   owner=core['SourceStreamOwner'](directory);order=[]
   try:
    def exchange(child):
     self.assertEqual(child.stdout.readline().strip(),b'HELD');order.append('source-held')
     executable=pathlib.Path(sys.executable).resolve();digest=hashlib.sha256(executable.read_bytes()).hexdigest()
     with retained_executable(executable,digest):
      row=owner.run_original([str(executable),'-I','-B','-c',"import sys;assert len(sys.stdin.buffer.read())==5;print('BACKUP-CLOSED')"],'backupPreflight',secret_input=b'input')
     self.assertEqual(row['code'],0);self.assertTrue(row['stdoutEof'] and row['stderrEof']);order.append('backup-closed')
     child.stdin.write(b'ACK\n');child.stdin.flush();child.stdin.close();child.stdin=None
     self.assertEqual(child.stdout.readline().strip(),b'CLOSED');order.append('source-closed');return{'fixtureOnly':True}
    row=owner.run_original([sys.executable,'-I','-B','-c',"import sys;print('HELD',flush=True);assert sys.stdin.buffer.readline()==b'ACK\\n';assert sys.stdin.buffer.read()==b'';print('CLOSED',flush=True)"],'sourcePreflight',interactive=exchange)
    self.assertTrue(row['stdoutEof'] and row['stderrEof']);self.assertEqual(row['observationFaultTotal'],0)
    self.assertEqual(order,['source-held','backup-closed','source-closed']);self.assertEqual(len(owner.children),2)
   finally:owner.close()

 def test_actual_windows_path_and_descriptor_views_keep_separate_metadata(self):
  executable=pathlib.Path(sys.executable).resolve();named=executable.stat()
  with executable.open('rb') as descriptor:
   opened=os.fstat(descriptor.fileno())
   if sys.platform=='win32':
    # Reproduce the predecessor's exact refusal on the real pinned carrier.
    self.assertNotEqual(named.st_mode,opened.st_mode)
   self.assertEqual((named.st_dev,named.st_ino),(opened.st_dev,opened.st_ino))
  with retained_executable(executable,hashlib.sha256(executable.read_bytes()).hexdigest()):pass
  with self.assertRaisesRegex(AssertionError,'SHA_MISMATCH'):
   with retained_executable(executable,'0'*64):self.fail('wrong hash admitted')

 def test_actual_executable_change_during_work_is_refused(self):
  with tempfile.TemporaryDirectory(prefix='readonly-executable-') as directory:
   file=pathlib.Path(directory)/'carrier.exe';file.write_bytes(b'owned-fixture-carrier');digest=hashlib.sha256(file.read_bytes()).hexdigest()
   with self.assertRaisesRegex(AssertionError,'CHANGED_DURING_WORK'):
    with retained_executable(file,digest):
     with file.open('ab') as writer:writer.write(b'changed');writer.flush();os.fsync(writer.fileno())

 def test_callback_fault_drains_same_child_and_stays_negative(self):
  with tempfile.TemporaryDirectory(prefix='sabalan-readonly-callback-') as directory:
   owner=core['SourceStreamOwner'](directory)
   try:
    def exchange(child):
     self.assertEqual(child.stdout.readline().strip(),b'HELD');raise RuntimeError('fixture-callback-fault')
    with self.assertRaises(AssertionError):owner.run_original([sys.executable,'-I','-B','-c',"import sys;print('HELD',flush=True);sys.stdin.buffer.read();print('drained')"],'sourcePreflight',interactive=exchange)
    row=json.loads(pathlib.Path(owner.children[0]['file']).read_bytes());self.assertEqual(row['code'],0);self.assertTrue(row['stdoutEof'] and row['stderrEof']);self.assertGreater(row['observationFaultTotal'],0)
   finally:owner.close()

 def test_split_password_echo_is_redacted_in_actual_files_and_refused(self):
  with tempfile.TemporaryDirectory(prefix='sabalan-readonly-redaction-') as directory:
   owner=core['SourceStreamOwner'](directory);secret=b'fixture-private-password'
   # Split the echoed credential across the collector's 65536 byte reads.
   child="import os,sys;s=bytes.fromhex(sys.argv[1]);os.write(1,b'x'*(65536-7)+s);os.write(2,b'y'*(65536-11)+s)"
   try:
    with self.assertRaises(AssertionError):owner.run_original([sys.executable,'-I','-B','-c',child,secret.hex()],'backupPreflight',redact_password=secret,maximum_stdout=131072)
    row=json.loads(pathlib.Path(owner.children[0]['file']).read_bytes());self.assertTrue(row['stdoutEof'] and row['stderrEof']);self.assertTrue(row['passwordOutputRedacted']);self.assertGreater(row['observationFaultTotal'],0)
    for file in pathlib.Path(directory).iterdir():self.assertNotIn(secret,file.read_bytes())
   finally:owner.close()

 def test_source_reader_start_fault_preserves_original_eof_and_negative(self):
  with tempfile.TemporaryDirectory(prefix='sabalan-readonly-start-') as directory:
   owner=core['SourceStreamOwner'](directory);old=threading.Thread.start;count=0
   def start(thread):
    nonlocal count
    count+=1
    if count==1:raise RuntimeError('fixture-reader-start')
    return old(thread)
   try:
    threading.Thread.start=start
    with self.assertRaises(AssertionError):owner.run_original([sys.executable,'-I','-B','-c',"import sys;sys.stdin.buffer.read();print('EOF')"],'sourcePreflight',interactive=lambda child:None)
    row=json.loads(pathlib.Path(owner.children[0]['file']).read_bytes());self.assertTrue(row['stdoutEof'] and row['stderrEof']);self.assertGreater(row['observationFaultTotal'],0)
   finally:threading.Thread.start=old;owner.close()

if __name__=='__main__':unittest.main()
