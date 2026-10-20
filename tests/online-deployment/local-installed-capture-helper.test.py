import hashlib,importlib.util,json,sys,unittest
from pathlib import Path

FILE=Path(__file__).resolve().parents[2]/'deploy/scripts/local-online-checkpoint-driver.py'
if sys.platform=='linux':
 spec=importlib.util.spec_from_file_location('local_installed_capture_driver',FILE);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

@unittest.skipUnless(sys.platform=='linux','fixed Linux native driver')
class InstalledCaptureTests(unittest.TestCase):
 def test_actual_source_byte_inventory_requires_every_installed_helper(self):
  names=('capture-coherent-components.py','capture-coordination-history.py','online-runtime-owner.py')
  expected={name:hashlib.sha256(FILE.with_name(name).read_bytes()).hexdigest()for name in names}
  self.assertEqual(module.validate_installed_capture_bytes(json.dumps(expected).encode(),expected),expected)
  for changed in({**expected,'capture-coordination-history.py':'a'*64},{key:value for key,value in expected.items()if key!='online-runtime-owner.py'},{**expected,'foreign.py':'b'*64}):
   with self.assertRaisesRegex(RuntimeError,'INSTALLED_CAPTURE_HELPER_BYTES_CHANGED'):module.validate_installed_capture_bytes(json.dumps(changed).encode(),expected)

if __name__=='__main__':unittest.main()
