"""Real retained originals for the exceptional verifier-drain seam."""
import pathlib,runpy,signal,subprocess,sys,threading,types,unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]
m=runpy.run_path(str(ROOT/'deploy/scripts/original-image-repository-remote.py'))
channel=runpy.run_path(str(ROOT/'deploy/scripts/original-image-repository-channel.py'))
class VerifierDrain(unittest.TestCase):
 def test_actual_same_child_and_both_full_pipes_drain_after_collector_setup_failure(self):
  for code in [0,7]:
   child=subprocess.Popen([sys.executable,'-I','-B','-c',"import sys;sys.stdout.buffer.write(b'x'*262144);sys.stderr.buffer.write(b'y'*131072);sys.exit("+str(code)+")"],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
   h=types.SimpleNamespace(active_verifier=[child],verifier_intent=True,verifier_eof=[{}],children=[])
   self.assertTrue(m['drain_verifier_after_fault'](h))
   row=h.children[0];self.assertEqual(row['pid'],child.pid);self.assertEqual(row['code'],code)
   self.assertTrue(row['stdoutEof'] and row['stderrEof'] and row['pipesClosed'])
   self.assertEqual(row['observationFault'],['VERIFIER_COLLECTOR_EXCEPTION_DRAINED'])
   self.assertTrue(child.stdout.closed and child.stderr.closed)
 def test_intent_without_original_is_unknown_and_never_infers_closure(self):
  h=types.SimpleNamespace(active_verifier=[None],verifier_intent=True,verifier_eof=[None],children=[])
  self.assertFalse(m['drain_verifier_after_fault'](h));self.assertEqual(h.children,[])
  h.verifier_intent=False;self.assertTrue(m['drain_verifier_after_fault'](h))
 def test_signal_during_actual_drain_cannot_grant_known_negative(self):
  child=subprocess.Popen([sys.executable,'-I','-B','-c',"import time;time.sleep(.2);print('bounded')"],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  h=types.SimpleNamespace(active_verifier=[child],verifier_intent=True,verifier_eof=[{}],children=[],interrupted=False,lock_guard=lambda:None)
  previous=signal.signal(signal.SIGTERM,lambda *_:setattr(h,'interrupted',True));timer=threading.Timer(.05,lambda:signal.raise_signal(signal.SIGTERM));timer.start()
  try:self.assertFalse(m['resolve_negative_verifier_custody'](h,channel));self.assertTrue(h.interrupted);self.assertEqual(child.poll(),0)
  finally:timer.join();signal.signal(signal.SIGTERM,previous);child.stdout.close();child.stderr.close()
 def test_drain_exception_is_unknown_and_does_not_close_the_owners_handles(self):
  namespace=m['resolve_negative_verifier_custody'].__globals__;original=namespace['drain_verifier_after_fault']
  h=types.SimpleNamespace(interrupted=False,children=[],lock_guard=lambda:None)
  def broken(_):raise MemoryError('fixture drain allocation failure')
  try:
   namespace['drain_verifier_after_fault']=broken
   self.assertFalse(m['resolve_negative_verifier_custody'](h,channel))
  finally:namespace['drain_verifier_after_fault']=original
if __name__=='__main__':unittest.main()
