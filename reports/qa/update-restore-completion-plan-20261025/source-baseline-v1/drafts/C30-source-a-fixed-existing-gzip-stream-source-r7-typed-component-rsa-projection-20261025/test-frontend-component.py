import pathlib,runpy,unittest,copy,ast,json
from unittest.mock import patch
HERE=pathlib.Path(__file__).resolve().parent;N=runpy.run_path(str(HERE/'frontend-cipher-component.py'))
class Tests(unittest.TestCase):
 def test_actual_closed_native_preimage_bounded_header_only(self):
  v=N['metadata']();self.assertEqual(v['nativeMetadataPreimage'],{'bytes':1661,'sha256':'c435f13e67a57955a7585447726704840e699f26ec652e32c32fb12ec3f8a8cf'});self.assertFalse(v['negativeParentQualified']);self.assertFalse(v['fullOuterPhaseSucceeded']);self.assertEqual(v['cipher']['bytes'],269929059)
 def test_foreign_or_promoted_typed_component_refuses(self):
  v=N['metadata']();fun=N['authenticate'];g=fun.__globals__;ref={'file':'MODEL_ONLY','sha256':'a'*64}
  for key,value in [('negativeParentQualified',True),('fullOuterPhaseSucceeded',True),('productionAdmission',True),('nativeMetadataPreimage',{'bytes':1,'sha256':'0'*64})]:
   bad=copy.deepcopy(v);bad[key]=value
   with patch.dict(g,{'read':lambda r,bad=bad:bad,'metadata':lambda:v}):
    with self.assertRaises(AssertionError):fun(ref,'frontend',v['component'])
  with patch.dict(g,{'read':lambda r:v,'metadata':lambda:v}):
   self.assertEqual(fun(ref,'frontend',v['component']),v['cipher'])
   with self.assertRaises(AssertionError):fun(ref,'inquiry',v['component'])
 def test_only_local_prepare_branch_changed_and_parent16_bytes_preserved(self):
  parent=HERE.parent/'C30-source-a-fixed-existing-gzip-stream-source-r5-frontend-closed-cipher-component-20261025';a=ast.parse((parent/'prepare-phase.py').read_text());b=ast.parse((HERE/'prepare-phase.py').read_text());nodes=lambda t:{n.name:ast.dump(n,include_attributes=False)for n in t.body if isinstance(n,ast.FunctionDef)and n.name!='prepare'};self.assertEqual(nodes(a),nodes(b))
  for p in parent.iterdir():
   if p.is_file()and p.name not in ['source-review.json','prepare-phase.py','windows-owner.template.py','test-frontend-component.py']:self.assertEqual(p.read_bytes(),(HERE/p.name).read_bytes(),p.name)
  s=(HERE/'prepare-phase.py').read_text();self.assertIn('C30-observed-second-backend-restart-current-admission-source-r2',s);self.assertIn('8c7dc32fd6ad614f2931865141ee46f63c83c19506176730de7383ccdc38003b',s)
if __name__=='__main__':unittest.main()
