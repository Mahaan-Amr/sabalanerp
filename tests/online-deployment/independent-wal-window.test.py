import copy,hashlib,importlib.util,io,json,os,subprocess,sys,tempfile,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('window',HERE/'independent-wal-window-controller.fixture.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
spec=importlib.util.spec_from_file_location('transfer',HERE/'independent-image-transfer.fixture.py');t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t)
def request():return dict(format='sabalan-original-wal-window-verification-request/v1',sequence=1,challenge='a'*64,deploymentId='deployment_123',releaseId='release_123',windowSha256='b'*64,sourceIdentity=dict(systemIdentifier='1234567890',timeline=1),objects=[dict(name='capture.sabrec',bytes=123,sha256='c'*64)])
class WindowProtocol(unittest.TestCase):
 def test_exact_request_rejects_alias_duplicate_size_and_unknown_field(self):
  value=request();self.assertEqual(m.request(value),123)
  for mutate in [lambda v:v.update(unknown=True),lambda v:v['objects'][0].update(name='..'),lambda v:v['objects'].append(copy.deepcopy(v['objects'][0])),lambda v:v['objects'][0].update(bytes=64*1024**2+1),lambda v:v['sourceIdentity'].update(timeline=True)]:
   changed=request();mutate(changed)
   with self.assertRaises(AssertionError):m.request(changed)
 def test_same_original_pipe_keeps_two_window_binary_frames_then_certificate_boundary(self):
  raw=b'\x00\x1a\r\n'+bytes(range(256))*4097
  with tempfile.TemporaryDirectory(prefix='sabalan-window-transport-') as directory:
   file=Path(directory).resolve()/'capture.sabrec';file.write_bytes(raw);row={'name':file.name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()};source=t.verify_source(file,row)
   wanted=dict(event='WAL_WINDOW_CIPHER',role=row['name'],requestSha256='a'*64,path='/root/private/ciphertexts/'+row['name'],bytes=row['bytes'],sha256=row['sha256'])
   code="import hashlib,importlib.util,io,json,sys; s=importlib.util.spec_from_file_location('t',sys.argv[1]);t=importlib.util.module_from_spec(s);s.loader.exec_module(t);w=json.loads(sys.argv[2]);r=[]\nfor i in range(2):\n t.read_begin(sys.stdin.buffer,w);r.append(t.copy_exact(sys.stdin.buffer,io.BytesIO(),w['bytes']))\nprint(json.dumps({'hashes':r,'ack':json.loads(sys.stdin.buffer.readline())}),flush=True)"
   child=subprocess.Popen([sys.executable,'-I','-B','-c',code,str(HERE/'independent-image-transfer.fixture.py'),json.dumps(wanted)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
   try:
    t.send_owned(source,child.stdin,wanted);t.send_owned(source,child.stdin,wanted);child.stdin.write(t.frame(dict(event='WAL_WINDOW_CERTIFICATE_ACK',requestSha256='a'*64)));child.stdin.close()
    self.assertEqual(child.wait(timeout=15),0);observed=json.loads(child.stdout.read());self.assertEqual(observed['hashes'],[row['sha256']]*2);self.assertEqual(observed['ack']['event'],'WAL_WINDOW_CERTIFICATE_ACK')
   finally:os.close(source['fd']);child.stdout.close();child.stderr.close()
 def test_certificate_payload_is_immutable_separate_from_original_verification(self):
  # These real fresh exclusive writes cannot overwrite a failed or prior result.
  with tempfile.TemporaryDirectory(prefix='sabalan-window-append-only-') as directory:
   file=Path(directory)/'certificate.json';original=m.fsync_parent;m.fsync_parent=lambda _:None
   native_no_follow=hasattr(os,'O_NOFOLLOW')
   if not native_no_follow:os.O_NOFOLLOW=0  # Data-only Windows exclusive-create seam; Linux runtime still requires native nofollow.
   try:
    m.write(file,b'{"signature":"actual-raw-bytes"}');self.assertEqual(file.read_bytes(),b'{"signature":"actual-raw-bytes"}')
    with self.assertRaises(FileExistsError):m.write(file,b'{}')
    self.assertEqual(file.read_bytes(),b'{"signature":"actual-raw-bytes"}')
   finally:
    m.fsync_parent=original
    if not native_no_follow:del os.O_NOFOLLOW
if __name__=='__main__':unittest.main()
