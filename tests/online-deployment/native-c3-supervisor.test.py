"""Finite real child/pipes with explicitly injected log-finalization faults."""
import hashlib,json,os,pathlib,runpy,subprocess,sys,tempfile,threading,unittest
MODULE=runpy.run_path(str(pathlib.Path(__file__).resolve().parents[2]/'deploy/scripts/original-native-c3-master-supervisor.py'),run_name='supervisor_source_test')
class ReaderClosure(unittest.TestCase):
 def exercise(self,fault):
  child=subprocess.Popen([sys.executable,'-I','-B','-c','pass'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  state={'stdout':{},'stderr':{}};errors=[];condition=threading.Condition();fds=[]
  try:
   with tempfile.TemporaryDirectory(prefix='c3-reader-finalization-')as directory:
    for name in state:
     pipe=getattr(child,name);self.assertEqual(pipe.read(),b'');fd=MODULE['open_original_log'](pathlib.Path(directory)/(name+'.log'));fds.append(fd)
     class Io:
      def fsync(self,value):
       if name=='stdout'and fault=='fsync':raise OSError('unit-sync-fault')
       os.fsync(value)
      def close(self,value):
       if name=='stdout'and fault=='close':raise OSError('unit-close-fault')
       os.close(value);fds.remove(value)
     target=pipe
     if name=='stdout'and fault=='pipe':
      class FaultyPipe:
       def close(self):raise OSError('unit-pipe-close-fault')
      target=FaultyPipe()
     MODULE['finalize_original_reader'](name,target,fd,state,errors,condition,Io())
    self.assertEqual(child.wait(),0);child.stdin.close()
    self.assertEqual(MODULE['supervisor_exit_status'](0,False,errors,state),1 if fault else 0)
    self.assertEqual(len(errors),1 if fault else 0)
    if fault=='fsync':self.assertTrue(state['stdout']['pipeClosed']);self.assertTrue(state['stdout']['logClosed']);self.assertFalse(state['stdout']['logSynced'])
    if fault=='close':self.assertTrue(state['stdout']['pipeClosed']);self.assertTrue(state['stdout']['logSynced']);self.assertFalse(state['stdout']['logClosed'])
    if fault=='pipe':self.assertFalse(state['stdout']['pipeClosed']);self.assertTrue(state['stdout']['logSynced']);self.assertTrue(state['stdout']['logClosed'])
    for fd in fds[:]:os.close(fd);fds.remove(fd)
  finally:
   for fd in fds:os.close(fd)
   for pipe in [child.stdin,child.stdout,child.stderr]:pipe.close()
   self.assertEqual(child.poll(),0)
 def test_natural_zero_and_both_original_pipes_and_logs_close(self):self.exercise(None)
 def test_sync_fault_sticks_despite_natural_zero_and_other_close_success(self):self.exercise('fsync')
 def test_close_fault_sticks_despite_natural_zero_and_other_reader_success(self):self.exercise('close')
 def test_pipe_close_fault_still_syncs_and_closes_log_and_cannot_pass(self):self.exercise('pipe')
 def test_incomplete_unreported_reader_cannot_exit_zero(self):self.assertEqual(MODULE['supervisor_exit_status'](0,False,[],{'stdout':{'closed':True}}),1)
 def test_actual_binary_writer_preserves_lf_crlf_nul_and_byte_counts(self):
  with tempfile.TemporaryDirectory(prefix='c3-original-log-bytes-')as directory:
   file=pathlib.Path(directory)/'original.log';raw=b'first\nsecond\r\nthird\x00\xff\n';fd=MODULE['open_original_log'](file)
   try:MODULE['write_all'](fd,raw);os.fsync(fd)
   finally:os.close(fd)
   self.assertEqual(file.read_bytes(),raw);self.assertEqual(file.stat().st_size,len(raw))
class PrivatePreflightForwarding(unittest.TestCase):
 def event(self):return dict(format='sabalan-native-c3-private-preflight-request/v1',rootOperation='a'*32,sequence=1,challenge='b'*64,phase='PREPARING',remoteActorsStarted=False,productionAdmission=False)
 def test_actual_same_child_anonymous_frame_then_natural_eof(self):
  code="import hashlib,json,sys;v=json.loads(sys.stdin.buffer.readline());assert sys.stdin.buffer.read()==b'';v['credentialSha256']=hashlib.sha256(v.pop('credential').encode()).hexdigest();print(json.dumps(v))"
  child=subprocess.Popen([sys.executable,'-I','-B','-c',code],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  state=dict(rootOperation=None,sequence=0,challenges=set());password='fixture-private-preflight';event=self.event()
  MODULE['forward_private_preflight_request'](child,event,password,state,threading.Lock())
  # Reject replay on this SAME still-live pipe before another write.
  with self.assertRaises(AssertionError):MODULE['forward_private_preflight_request'](child,event,password,state,threading.Lock())
  child.stdin.close();child.stdin=None;out,error=child.communicate();self.assertEqual(child.returncode,0);self.assertEqual(error,b'');self.assertNotIn(password.encode(),out)
  value=json.loads(out);self.assertEqual(value['credentialSha256'],hashlib.sha256(password.encode()).hexdigest());self.assertEqual(value['rootOperation'],event['rootOperation']);self.assertEqual(state['sequence'],1)
 def test_wrong_root_sequence_or_admission_is_refused_before_write(self):
  for change in [dict(rootOperation='c'*32),dict(sequence=2),dict(remoteActorsStarted=True),dict(productionAdmission=True),dict(phase='HELD')]:
   class Unwritable:
    def write(self,*_args):raise RuntimeError('MUST_NOT_WRITE')
   class Child:stdin=Unwritable()
   with self.assertRaises(AssertionError):MODULE['forward_private_preflight_request'](Child(),{**self.event(),**change},'fixture-private',dict(rootOperation='a'*32,sequence=0,challenges=set()),threading.Lock())
if __name__=='__main__':unittest.main()
