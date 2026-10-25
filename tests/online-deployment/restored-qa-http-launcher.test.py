"""Pure fixed-launcher contract; no guardian, SQL, application or FD9 actions."""
import ast,hashlib,pathlib,types,unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]
SOURCE=ROOT/'deploy/scripts/restored-qa-http-launcher.py'
class LauncherTests(unittest.TestCase):
 def load(self):
  tree=ast.parse(SOURCE.read_bytes());body=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name in('need','child_environment')]
  scope={'Path':pathlib.Path};exec(compile(ast.Module(body=body,type_ignores=[]),str(SOURCE),'exec'),scope);return scope['child_environment']
 def test_only_child_environment_replaces_exact_three_native_vars_and_private_fd9(self):
  parent={'BACKEND_NATIVE_POSTGRES_APPLICATION_NAME':'parent-namespace','BACKEND_NATIVE_AUTHORITY_FILE':'/parent/claim','BACKEND_NATIVE_CLAIM_SHA256':'parenthash','BACKEND_CONTROL_LOCK_FILE':'/parent/control.lock','BACKEND_CONTROL_LOCK_FD':'9','DATABASE_URL':'postgresql://user@host/restored_b?connection_limit=2&pool_timeout=10','KEEP':'yes'};old=dict(parent)
  # The production entry is Linux-only; model its path vocabulary explicitly.
  result=self.load()(parent,pathlib.PurePosixPath('/private/b/current/coord'));self.assertEqual(parent,old);self.assertEqual(result['DATABASE_URL'],parent['DATABASE_URL']);self.assertEqual(result['KEEP'],'yes');self.assertEqual(result['BACKEND_CONTROL_LOCK_FILE'],'/private/b/current/coord/deployment-runtime-control.lock')
  self.assertFalse(any(k.startswith('BACKEND_NATIVE_')for k in result));self.assertEqual(parent['BACKEND_NATIVE_CLAIM_SHA256'],'parenthash')
 def test_missing_or_unreviewed_native_authority_cannot_be_silently_stripped(self):
  for parent in [{},{'BACKEND_NATIVE_UNREVIEWED':'value'}]:
   with self.assertRaises(AssertionError):self.load()(parent,pathlib.Path('/private'))
 def test_actual_guardian_remains_byte_exact_and_launcher_has_no_signal_or_generic_command(self):
  self.assertEqual(hashlib.sha256((ROOT/'deploy/scripts/backend-runtime-owner.py').read_bytes()).hexdigest(),'7812ebf703fd3c68f0fa7e3d595034a8b27166e16865718934d284ca626d8865')
  tree=ast.parse(SOURCE.read_bytes());calls=[n for n in ast.walk(tree)if isinstance(n,ast.Call)];self.assertFalse(any(isinstance(n.func,ast.Attribute)and n.func.attr in('kill','killpg','system','Popen')for n in calls));self.assertEqual(sum(isinstance(n.func,ast.Attribute)and n.func.attr=='execve'for n in calls),1)
if __name__=='__main__':unittest.main()
