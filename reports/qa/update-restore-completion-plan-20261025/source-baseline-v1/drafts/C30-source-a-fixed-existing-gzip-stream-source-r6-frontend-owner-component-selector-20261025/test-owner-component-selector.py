import pathlib,runpy,unittest,json,copy,hashlib,ast
from unittest.mock import patch
HERE=pathlib.Path(__file__).resolve().parent
N=runpy.run_path(str(HERE/'windows-owner.template.py'));M=runpy.run_path(str(HERE/'frontend-cipher-component.py'))
class Tests(unittest.TestCase):
 def test_actual_owner_selector_accepts_exact_typed_component(self):
  v=M['metadata']();ref={'file':'EXPLICIT_MODEL_REFERENCE_NO_WRITE','sha256':'a'*64};p=HERE/'frontend-cipher-component.py';hr={'file':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()};b={'encryptionPhase':ref,'sourceFiles':{'frontend-cipher-component.py':hr},'service':'frontend','component':v['component'],'cipherInput':v['cipher']};fun=N['select_local_cipher'];g=fun.__globals__;reader=g['read']
  # Source helper runs its actual fixed closed-native metadata authenticator.
  # Only nonexistent component JSON reference is supplied in memory.
  def read(r,*args):return json.dumps(v).encode()if r==ref else reader(r,*args)
  loader=g['module']
  def module(r,name):
   value=loader(r,name);original=value['authenticate'];original.__globals__['read']=lambda r:v if r==ref else M['read'](r);return value
  with patch.dict(g,{'read':read,'module':module}):
   self.assertEqual(fun(b),v['cipher'])
   bad=copy.deepcopy(b);bad['cipherInput']['sha256']='0'*64
   with self.assertRaises(AssertionError):fun(bad)
   bad=copy.deepcopy(b);bad['service']='inquiry'
   with self.assertRaises(AssertionError):fun(bad)
 def test_existing_whole_phase_path_preserved(self):
  cipher={'file':'fixed','sha256':'1'*64,'bytes':1};v={'format':'sabalan-source-a-original-closed-stream-phase/v1','phase':'encrypt-existing','allOriginalChildrenClosed':True,'streamOutput':cipher};fun=N['select_local_cipher'];g=fun.__globals__
  with patch.dict(g,{'read':lambda r:json.dumps(v).encode()}):self.assertEqual(fun({'encryptionPhase':{},'cipherInput':cipher}),cipher)
 def test_prepare_copies_pinned_helper_and_main_uses_selector(self):
  s=(HERE/'prepare-phase.py').read_text();self.assertIn("('frontend-cipher-component.py',(HERE/'frontend-cipher-component.py').read_bytes())",s);tree=ast.parse((HERE/'windows-owner.template.py').read_text());main=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='main');self.assertIn('select_local_cipher(b)',ast.unparse(main));compile(s,'actual-prepare','exec')
if __name__=='__main__':unittest.main()
