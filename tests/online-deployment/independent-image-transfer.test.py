import hashlib,importlib.util,io,json,os,subprocess,sys,tempfile,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('transfer',HERE/'independent-image-transfer.fixture.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class OriginalTransfer(unittest.TestCase):
 def test_real_original_child_pipe_receives_bounded_binary_cipher_from_held_fd(self):
  raw=bytes(range(256))*8193+b'\x1a\r\n\x00';checksum=hashlib.sha256(raw).hexdigest()
  with tempfile.TemporaryDirectory(prefix='sabalan-cipher-stream-') as directory:
   file=Path(directory).resolve()/'backend.sabrec';file.write_bytes(raw);expected={'bytes':len(raw),'sha256':checksum};source=m.verify_source(file,expected)
   wanted=m.request('a'*32,'backend',0,'/root/private/staged-ciphers/backend.sabrec',len(raw),checksum)
   code="import hashlib,importlib.util,io,json,sys; s=importlib.util.spec_from_file_location('t',sys.argv[1]);t=importlib.util.module_from_spec(s);s.loader.exec_module(t);r=json.loads(sys.argv[2]);t.read_begin(sys.stdin.buffer,r);h=t.copy_exact(sys.stdin.buffer,io.BytesIO(),r['bytes']);print(json.dumps({'sha256':h,'bytes':r['bytes']}),flush=True)"
   child=subprocess.Popen([sys.executable,'-I','-B','-c',code,str(HERE/'independent-image-transfer.fixture.py'),json.dumps(wanted)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
   try:
    sent=m.send_owned(source,child.stdin,wanted);child.stdin.close();self.assertEqual(child.wait(timeout=15),0);result=json.loads(child.stdout.read());self.assertEqual(result,expected);self.assertEqual(sent['sha256'],checksum);self.assertTrue(sent['originalSourceFdRetained'])
   finally:os.close(source['fd']);child.stdout.close();child.stderr.close()
 def test_changed_owned_source_refuses_before_begin_header(self):
  with tempfile.TemporaryDirectory(prefix='sabalan-cipher-negative-') as directory:
   file=Path(directory).resolve()/'backend.sabrec';file.write_bytes(b'cipher');e={'bytes':6,'sha256':hashlib.sha256(b'cipher').hexdigest()};source=m.verify_source(file,e)
   try:
    file.write_bytes(b'change');out=io.BytesIO()
    with self.assertRaisesRegex(RuntimeError,'TRANSFER_SOURCE_CHANGED'):m.send_owned(source,out,m.request('a'*32,'backend',0,'/target',6,e['sha256']))
    self.assertEqual(out.getvalue(),b'')
   finally:os.close(source['fd'])
 def test_cipher_bounds_sequence_and_role_are_exact(self):
  for role,index in [('inquiry',0),('frontend',1),('backend',-1),('backend',3)]:
   with self.assertRaisesRegex(RuntimeError,'TRANSFER_ROLE_ORDER'):m.request('a'*32,role,index,'/target',1,'b'*64)
  self.assertEqual(m.ROLES,('backend','inquiry','frontend'))
 def test_truncated_binary_does_not_return_a_completed_hash(self):
  with self.assertRaisesRegex(RuntimeError,'TRANSFER_TRUNCATED'):m.copy_exact(io.BytesIO(b'half'),io.BytesIO(),8)
 def test_control_header_cannot_be_replayed_for_another_role_or_cipher(self):
  wanted=m.request('a'*32,'backend',0,'/target',123,'b'*64)
  wrong=m.frame({'event':'IMAGE_TRANSFER_BEGIN','requestSha256':'c'*64})
  with self.assertRaisesRegex(RuntimeError,'TRANSFER_BEGIN_BINDING'):m.read_begin(io.BytesIO(wrong),wanted)
 def test_control_header_bound_refuses_overlong_or_partial_frame(self):
  wanted=m.request('a'*32,'backend',0,'/target',123,'b'*64)
  for raw in [b'partial',b'x'*8193+b'\n']:
   with self.assertRaisesRegex(RuntimeError,'TRANSFER_BEGIN_BOUND'):m.read_begin(io.BytesIO(raw),wanted)
if __name__=='__main__':unittest.main()
