"""Actual owned pipe lifecycle; peer crypto/storage claims remain modeled."""
import hashlib,json,pathlib,runpy,signal,sys,tempfile,threading,unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]
transport=runpy.run_path(str(ROOT/'deploy/scripts/original-image-repository-transport.py'))
transfer=runpy.run_path(str(ROOT/'tests/online-deployment/independent-image-transfer.fixture.py'))
channel=runpy.run_path(str(ROOT/'deploy/scripts/original-image-repository-channel.py'))
class Custody:
 def assert_current(self):pass
class OwnedTransport(unittest.TestCase):
 def execute(self,mode,setup_fault=False,post_start=False,join_fault=False,interrupt=None):
  with tempfile.TemporaryDirectory(prefix='sabalan-owned-image-') as directory:
   images={};sources={};base=pathlib.Path(directory).resolve()
   for role in ('backend','inquiry','frontend'):
    raw=(role.encode()*20000)+b'\x00\x1a';file=base/(role+'.cipher');file.write_bytes(raw)
    row=dict(file=str(file),bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
    images[role]=dict(cipher=row,image='sha256:'+'c'*64,gzip=dict(bytes=1,sha256='d'*64),archiveGraph={})
    sources[role]=transfer['verify_source'](file,row)
   config=base/'images.json';config.write_text(json.dumps(images))
   argv=[sys.executable,'-I','-B',str(ROOT/'tests/online-deployment/fixtures/image-repository-channel-peer.fixture.py'),str(ROOT),str(config),mode]
   old=threading.Thread.start;old_join=threading.Thread.join;faulted=False;joined=False
   def start(thread):
    nonlocal faulted
    if setup_fault and not faulted:
     faulted=True
     if post_start:old(thread)
     raise RuntimeError('fixture reader startup failure')
    return old(thread)
   def join(thread,*args,**kwargs):
    nonlocal joined
    if join_fault and not joined:joined=True;raise KeyboardInterrupt('fixture join interrupted')
    return old_join(thread,*args,**kwargs)
   class CheckedCustody:
    calls=0
    def assert_current(self):
     self.calls+=1
     if interrupt is not None and self.calls==2:signal.raise_signal(interrupt)
   try:
    threading.Thread.start=start
    threading.Thread.join=join
    return transport['collect_channel'](argv,dict(source=b'SOURCE\n',fullOperation='b'*32),images,'a'*32,sources,transfer,channel,CheckedCustody(),'nonsecret-fixture-password')
   finally:
    threading.Thread.start=old
    threading.Thread.join=old_join
    for source in sources.values():__import__('os').close(source['fd'])
 def test_three_actual_upload_and_retrieval_streams_close_naturally(self):
  row=self.execute('success');self.assertTrue(row['retrievalQualified']);self.assertEqual(len(row['retrieved']),3)
  self.assertTrue(row['original']['actualOriginalClosed']);self.assertEqual(row['original']['code'],0)
 def test_cut_child_and_invalid_crypto_proof_remain_closed_negative(self):
  for mode in ['cut','wrong-proof']:
   row=self.execute(mode);self.assertFalse(row['retrievalQualified']);self.assertTrue(row['original']['actualOriginalClosed'])
   self.assertTrue(row['original']['stdoutEof'] and row['original']['stderrEof']);self.assertIsNone(row['remote'])
 def test_reader_setup_fault_is_sticky_after_actual_drain(self):
  row=self.execute('success',True);self.assertFalse(row['retrievalQualified']);self.assertTrue(row['original']['actualOriginalClosed'])
  self.assertIn('RuntimeError',row['original']['observationFaults'])
 def test_post_start_exception_retains_same_reader_and_drains(self):
  row=self.execute('success',True,True);self.assertFalse(row['retrievalQualified']);self.assertTrue(row['original']['actualOriginalClosed'])
  self.assertIn('RuntimeError',row['original']['observationFaults'])
 def test_actual_sigint_sigterm_are_sticky_until_same_child_eof(self):
  for number in [signal.SIGINT,signal.SIGTERM]:
   previous=signal.getsignal(number);row=self.execute('success',interrupt=number)
   self.assertFalse(row['retrievalQualified']);self.assertTrue(row['original']['interrupted']);self.assertTrue(row['original']['actualOriginalClosed'])
   self.assertEqual(signal.getsignal(number),previous)
 def test_join_interruption_is_sticky_and_actual_reader_is_still_joined(self):
  row=self.execute('success',join_fault=True);self.assertFalse(row['retrievalQualified']);self.assertTrue(row['original']['actualOriginalClosed'])
  self.assertEqual(row['original']['code'],0);self.assertIn('KeyboardInterrupt',row['original']['observationFaults'])
 def test_same_channel_closed_negative_is_distinct_from_unknown_remote_custody(self):
  for mode,closed in [('closed-negative',True),('unknown-negative',False)]:
   row=self.execute(mode);self.assertFalse(row['retrievalQualified']);self.assertTrue(row['original']['actualOriginalClosed']);self.assertEqual(row['original']['code'],1)
   self.assertEqual(row['remoteOriginalsClosed'],closed);self.assertEqual(row['remoteNegative'] is not None,closed)
if __name__=='__main__':unittest.main()
