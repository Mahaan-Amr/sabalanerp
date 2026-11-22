"""Real bytes/immutable binding regression; does not mint runtime authority."""
import hashlib,importlib.util,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch

FILE=Path(__file__).with_name('independent-wal-window-controller.fixture.py')
spec=importlib.util.spec_from_file_location('prepoint_binding_fixture',FILE)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

@unittest.skipUnless(sys.platform=='linux','actual Linux private publication semantics')
class BindingTests(unittest.TestCase):
 def fixture(self,root):
  checksum='a'*64;window=root/checksum;window.mkdir();cipher=window/'wal.sabrec';cipher.write_bytes(b'authenticated-source-cipher');cert=window/'certificate.json';cert.write_bytes(b'original-verified-certificate')
  owner=dict(sourceOriginalPid=123,sourceRuntimeId='b'*64)
  dependency=dict(format='sabalan-independent-certified-wal-prepoint-dependency/v1',basePoint=None,sourceOwner=owner,requestSha256=checksum,certificateFile=str(cert),certificateSha256=hashlib.sha256(cert.read_bytes()).hexdigest(),objects=[dict(path=str(cipher),bytes=cipher.stat().st_size,sha256=hashlib.sha256(cipher.read_bytes()).hexdigest())])
  file=window/'dependency.json';file.write_bytes(module.frame(dependency));sealed=root/'sealed.json';sealed.write_text(json.dumps(dict(objects=[dict(name='base',cipherBytes=7,cipherSha256='e'*64)])))
  source=dict(**owner,initialWindows=[dict(requestSha256=checksum,dependencyFile=str(file),dependencySha256=hashlib.sha256(file.read_bytes()).hexdigest(),certificateSha256=dependency['certificateSha256'])])
  point=dict(sealedFile=str(sealed),sealedSha256=hashlib.sha256(sealed.read_bytes()).hexdigest(),manifestSha256='f'*64,root=str(root/'actual-point'))
  def read(path,wanted,maximum=2*1024**2):
   body=path.read_bytes();assert len(body)<=maximum and hashlib.sha256(body).hexdigest()==wanted;return body
  def mapped(value):return root if str(value)=='/root/sabalan-recovery-private/native-qa/wal-windows' else Path(value)
  return source,point,read,mapped,window,cipher,file
 def test_real_point_binding_preserves_prepoint_bytes_and_is_not_replaceable(self):
  with tempfile.TemporaryDirectory()as directory:
   source,point,read,mapped,window,_,file=self.fixture(Path(directory));original=file.read_bytes()
   with patch.object(module,'Path',mapped):module.bind_original_prepoint_windows(source,point,read)
   self.assertEqual(file.read_bytes(),original);binding=json.loads((window/'point-binding.json').read_bytes());self.assertEqual(binding['basePoint']['sealedManifestSha256'],point['sealedSha256']);self.assertIsNone(json.loads(original)['basePoint'])
   with patch.object(module,'Path',mapped),self.assertRaises(FileExistsError):module.bind_original_prepoint_windows(source,point,read)
 def test_changed_original_owner_or_cipher_refuses_before_binding(self):
  for kind in('owner','cipher'):
   with tempfile.TemporaryDirectory()as directory:
    source,point,read,mapped,window,cipher,_=self.fixture(Path(directory))
    if kind=='owner':source['sourceRuntimeId']='c'*64
    else:cipher.write_bytes(b'changed-cipher')
    with patch.object(module,'Path',mapped),self.assertRaises(AssertionError):module.bind_original_prepoint_windows(source,point,read)
    self.assertFalse((window/'point-binding.json').exists())

if __name__=='__main__':unittest.main()
