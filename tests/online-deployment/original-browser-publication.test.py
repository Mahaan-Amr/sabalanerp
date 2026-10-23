"""Linux real strict-reader regression tests; no runtime, DB or release authority."""
import importlib.util,json,os,sys,tempfile,threading,time,unittest
from unittest.mock import patch
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
if sys.platform == 'linux':
 api=load('strict_reader',ROOT/'deploy/scripts/readonly-transport-retirement.py')
 new=load('current_reader',ROOT/'tests/online-deployment/readonly-transport-retirement-native.fixture.py')
else:api=new=None

class Edge:
 pid=os.getpid()
 def poll(self):return None
@unittest.skipUnless(sys.platform=='linux','strict private-inode reader requires Linux')
class ReaderTests(unittest.TestCase):
 def fixture(self,subject,root):
  obj=object.__new__(subject.OriginalReadonlyTransportFixture);obj.root=root;obj.api=api;obj.edge=Edge();obj.business_ready=obj.business_ready_raw=None
  obj.owner=type('Owner',(),{'_enrollment':{'enrollmentId':'e'*64}})();return obj
 def value(self,root):return dict(format='sabalan-original-browser-business-stage/v1',operation=root.name,originalEdgePid=Edge.pid,enrollmentId='e'*64,businessStage={'actualBrowserFixture':True},productionAdmission=False)
 def publish_link_window(self,root):
  final=root/'browser-business-ready.json';temp=root/(final.name+'.publishing-'+str(Edge.pid)+'-'+'a'*32)
  temp.write_bytes(api.encode(self.value(root)));temp.chmod(0o600);os.link(temp,final);return final,temp
 def test_strict_reader_rejects_transient_two_link_complete_publication(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);final,temp=self.publish_link_window(root)
   with self.assertRaises(RuntimeError):api.read(final,maximum=8*1024*1024)
 def test_new_reader_retries_recognized_link_until_actual_strict_read(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);final,temp=self.publish_link_window(root);reader=self.fixture(new,root)
   thread=threading.Thread(target=lambda:(time.sleep(.05),temp.unlink()));thread.start()
   try:self.assertEqual(reader.wait_business_ready(seconds=1),{'actualBrowserFixture':True});self.assertEqual(final.stat().st_nlink,1);self.assertEqual(reader.business_ready_raw,api.read(final,maximum=8*1024*1024)[1])
   finally:thread.join()
 def test_unknown_second_link_and_invalid_complete_json_fail_closed(self):
  for mode in ['unknown-link','invalid-json','wrong-pid']:
   with self.subTest(mode=mode),tempfile.TemporaryDirectory() as d:
    root=Path(d);final,temp=self.publish_link_window(root)
    if mode=='unknown-link':temp.rename(root/'unknown')
    elif mode=='invalid-json':temp.unlink();final.write_bytes(b'{');final.chmod(0o600)
    else:temp.rename(root/(final.name+'.publishing-'+str(Edge.pid+1)+'-'+'a'*32))
    with self.assertRaises(json.JSONDecodeError if mode=='invalid-json' else RuntimeError):self.fixture(new,root).wait_business_ready(seconds=.1)
 def test_missing_to_link_race_retries_before_strict_reader(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);final=root/'browser-business-ready.json';reader=self.fixture(new,root)
   original_lstat=Path.lstat;injected=[False];threads=[]
   def race_lstat(file,*args,**kwargs):
    if file==final and not injected[0]:
     injected[0]=True
     final_file,temp=self.publish_link_window(root)
     thread=threading.Thread(target=lambda:(time.sleep(.05),temp.unlink()));threads.append(thread);thread.start()
     raise FileNotFoundError('deterministic missing observation immediately before publication')
    return original_lstat(file,*args,**kwargs)
   try:
    with patch.object(Path,'lstat',race_lstat):self.assertEqual(reader.wait_business_ready(seconds=1),{'actualBrowserFixture':True})
    self.assertTrue(injected[0]);self.assertEqual(final.stat().st_nlink,1)
   finally:
    for thread in threads:thread.join()
 def test_r2_missing_to_link_negative_control_reproduces_reader_failure(self):
  import types
  source=Path(new.__file__).read_text()
  vulnerable=source.replace('return True\n        if before.st_nlink', 'return False\n        if before.st_nlink',1)
  self.assertNotEqual(source,vulnerable)
  r2=types.ModuleType('missing_precheck_negative_control');r2.__file__=new.__file__
  exec(compile(vulnerable,new.__file__,'exec'),r2.__dict__)
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);final=root/'browser-business-ready.json';reader=self.fixture(r2,root)
   original_lstat=Path.lstat;injected=[False]
   def race_lstat(file,*args,**kwargs):
    if file==final and not injected[0]:
     injected[0]=True;self.publish_link_window(root)
     raise FileNotFoundError('deterministic missing observation immediately before publication')
    return original_lstat(file,*args,**kwargs)
   with patch.object(Path,'lstat',race_lstat):
    with self.assertRaises(RuntimeError):reader.wait_business_ready(seconds=.1)
 def test_original_negative_observation_has_finite_deadline_without_stage(self):
  with tempfile.TemporaryDirectory() as d:
   reader=self.fixture(new,Path(d));started=time.monotonic()
   with self.assertRaises(RuntimeError):reader.observe_business_ready_for_negative_abort(seconds=.03)
   self.assertLess(time.monotonic()-started,1)
   self.assertIsNone(reader.business_ready_raw)
 def test_stopped_stage_two_link_publication_uses_same_strict_retry(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);reader=self.fixture(new,root);reader.stage=reader.stage_raw=None
   # Reader-only fixture; these owner callbacks grant no reconciliation authority.
   class Owner:
    _enrollment={'enrollmentId':'e'*64,'instanceId':'f'*64}
    _owners=[{'child':Edge()}]
    _issued=False
    def observe_active(self,child):return None
    def reconcile(self,*args):raise RuntimeError('READONLY_TRANSPORT_ORIGINAL_OWNER_UNPROVEN')
   reader.owner=Owner()
   value=dict(format='sabalan-original-edge-readonly-retirement-stage/v1',productionAdmission=False,socketInstanceId='a'*64,journalInstanceId='f'*64,pendingEvidence=[],businessStage={'readerOnly':True},uiMutationPending=0,apiMutationPending=0,originalOperationOutcome='UNKNOWN',buildOrImageGcEligible=False,substitutedStoppedIntentRefused=True)
   final=root/'readonly-transport-stopped.json';temp=root/(final.name+'.publishing-'+str(Edge.pid)+'-'+'b'*32);temp.write_bytes(api.encode(value));temp.chmod(0o600);os.link(temp,final)
   thread=threading.Thread(target=lambda:(time.sleep(.05),temp.unlink()));thread.start()
   try:self.assertEqual(reader.wait_stopped_stage(seconds=1),{'readerOnly':True});self.assertEqual(reader.stage_raw,api.read(final,maximum=8*1024*1024)[1])
   finally:thread.join()
 def test_publication_retry_cannot_be_used_for_unreviewed_name(self):
  with tempfile.TemporaryDirectory() as d:
   with self.assertRaises(RuntimeError):self.fixture(new,Path(d))._original_private_publication_pending('unreviewed.json')
 def test_precapture_negative_observation_keeps_production_false(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);final=root/'browser-business-ready.json';final.write_bytes(api.encode(self.value(root)));final.chmod(0o600);reader=self.fixture(new,root)
   raw=reader.observe_business_ready_for_negative_abort(seconds=1);self.assertIs(json.loads(raw)['productionAdmission'],False);self.assertIsNone(getattr(reader,'captureSuccess',None))
if __name__=='__main__':unittest.main()
