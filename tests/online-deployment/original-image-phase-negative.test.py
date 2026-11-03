"""Real reviewed SourceStreamOwner faults; never a native completion token."""
import pathlib,runpy,signal,sys,tempfile,threading,unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]
source=runpy.run_path(str(ROOT/'deploy/scripts/original-c3-backend-stream-source.py'))
owner_api=runpy.run_path(str(ROOT/'deploy/scripts/original-image-repository-owner.py'))
captured=source['captured_sources'](source['REVIEW'],source['REVIEW_SHA'])
collector_raw=source['execute_source'](captured['build-original.py'],source['REVIEW']/'build-original.py','finite_negative_source')['build']()
core=source['execute_source'](collector_raw,'reviewed-original.py','finite_negative_collector')
class PhaseNegative(unittest.TestCase):
 def actual(self,mode):
  with tempfile.TemporaryDirectory(prefix='sabalan-phase-negative-') as directory:
   original=core['SourceStreamOwner'](directory);old=threading.Thread.start;faulted=False
   def start(thread):
    nonlocal faulted
    if not faulted:
     faulted=True
     if mode=='start-fault':raise RuntimeError('owned-reader-start-fixture')
     if mode=='interrupt':signal.raise_signal(signal.SIGTERM)
    return old(thread)
   try:
    threading.Thread.start=start
    code="import sys;sys.stdout.write('x'*1024);sys.exit(1)" if mode=='semantic' else "import sys;sys.stdout.write('x'*1024)"
    with self.assertRaises(AssertionError):original.run_original([sys.executable,'-I','-B','-c',code],'validateArchive',maximum_stdout=16 if mode=='overflow' else 2048)
    row=__import__('json').loads(owner_api['read'](original.children[0]));self.assertTrue(row['stdoutEof'] and row['stderrEof']);self.assertIsInstance(row['code'],int)
    value=dict(format='sabalan-c3-backend-stream-phase-negative/v1',interrupted=original.interrupted,originalClosures=original.children)
    return owner_api['phase_negative_closed'](value,directory),row
   finally:threading.Thread.start=old;original.close()
 def test_clean_semantic_failure_is_closed_but_never_a_pass(self):
  closed,row=self.actual('semantic');self.assertTrue(closed);self.assertEqual(row['code'],1)
 def test_real_setup_interrupt_and_overflow_faults_never_become_known_negative(self):
  for mode in ['start-fault','interrupt','overflow']:
   closed,row=self.actual(mode);self.assertFalse(closed);self.assertTrue(row['stdoutEof'])
if __name__=='__main__':unittest.main()
