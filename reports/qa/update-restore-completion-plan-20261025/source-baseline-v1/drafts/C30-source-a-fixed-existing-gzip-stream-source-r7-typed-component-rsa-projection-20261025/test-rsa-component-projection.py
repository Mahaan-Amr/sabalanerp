"""Small public receipts only. Frontend local branch is explicit DATA MODEL until root's actual local original closes."""
import pathlib,runpy,json,copy,unittest,hashlib
from unittest.mock import patch
HERE=pathlib.Path(__file__).resolve().parent;Q=HERE.parent;N=runpy.run_path(str(HERE/'prepare-independent.py'));M=runpy.run_path(str(HERE/'frontend-cipher-component.py'))
def ref(p):return {'file':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
ENCRYPT=ref(Q/'C30-source-a-existing-inquiry-encrypt-existing-0832191af9264aff8e8dd96b453f456e/phase-complete.json');LOCAL=ref(Q/'C30-source-a-existing-inquiry-local-decrypt-d6464b3d2cd24f988a99a8705966d26b/phase-complete.json')
class Tests(unittest.TestCase):
 def test_actual_inquiry_closed_legs_still_accepted(self):
  c=runpy.run_path(str(HERE/'components.py'))['select']('inquiry');expected,cipher=N['validated_inputs'](ENCRYPT,LOCAL,'inquiry',c);self.assertEqual(expected['plainSha256'],c['gzip']['sha256']);self.assertEqual(expected['cipherSha256'],cipher['sha256'])
 def frontend(self):
  a=M['metadata']();b=json.loads(pathlib.Path(LOCAL['file']).read_bytes());r={'file':'EXPLICIT_FRONTEND_COMPONENT_DATA_MODEL','sha256':'a'*64};l={'file':'EXPLICIT_FRONTEND_LOCAL_DATA_MODEL','sha256':'b'*64};b.update(service='frontend',component=a['component'],encryptionPhase=r,reusedPlaintextRef=a['component']['gzip']);remote=b['remote'];remote.update(image=a['component']['image'],rootfsDiffIds=a['component']['rootfsDiffIds']);remote['native']['result']={**a['native']['result'],'gcmAuthenticated':True};decoded=b['canonicalLocalArchiveValidation'];decoded.update(compressed=a['component']['gzip'],raw=a['component']['raw'],archiveGraph=a['component']['archiveGraph']);return a,b,r,l
 def call_frontend(self,a,b,r,l):
  fun=N['validated_inputs'];g=fun.__globals__;oldread=g['read'];loader=g['runpy'].run_path
  def read(x):return a if x==r else b if x==l else b['remote']if x==b['hashProofPacket']else oldread(x)
  def load(p,*args,**kwargs):
   if pathlib.Path(p)==HERE/'frontend-cipher-component.py':
    scope=loader(p,*args,**kwargs);scope['authenticate'].__globals__['read']=lambda x:a if x==r else M['read'](x);return scope
   return loader(p,*args,**kwargs)
  with patch.dict(g,{'read':read}),patch.object(g['runpy'],'run_path',load):return fun(r,l,'frontend',a['component'])
 def test_typed_frontend_model_uses_exact_actual_native_component(self):
  a,b,r,l=self.frontend();expected,cipher=self.call_frontend(a,b,r,l);self.assertEqual(cipher,a['cipher']);self.assertEqual(expected['plainSha256'],a['component']['gzip']['sha256'])
 def test_changed_or_unfinished_frontend_local_refuses(self):
  for mutate in [lambda a,b:b.update(allOriginalChildrenClosed=False),lambda a,b:b['binaryOriginal'].update(code=1),lambda a,b:b['remote']['native']['result'].update(gcmAuthenticated=False),lambda a,b:b['remote']['native']['result'].update(cipherSha256='0'*64),lambda a,b:b['remote']['native']['result'].update(header={}),lambda a,b:b.update(encryptionPhase={'file':'foreign','sha256':'0'*64}),lambda a,b:b['remote'].update(plaintextReturned=True)]:
   a,b,r,l=self.frontend();mutate(a,b)
   with self.assertRaises(AssertionError):self.call_frontend(a,b,r,l)
if __name__=='__main__':unittest.main()
