"""Explicit Compose profile-selection model; no Docker execution."""
import pathlib,ast,runpy,unittest,copy
HERE=pathlib.Path(__file__).resolve().parent
class Tests(unittest.TestCase):
 def test_all_remote_guards_unchanged_except_hash_only_stream(self):
  prior=ast.parse((HERE.parent/'C30-source-a-fixed-existing-gzip-stream-source-r2-deployment-profile-20261025/remote-phase.py').read_bytes());current=ast.parse((HERE/'remote-phase.py').read_bytes())
  methods=lambda tree:{n.name:ast.dump(n)for n in tree.body if isinstance(n,ast.FunctionDef)}
  old,new=methods(prior),methods(current);self.assertEqual(set(old),set(new));self.assertEqual({k for k in old if old[k]!=new[k]},{'stream'})
  stream=next(n for n in current.body if isinstance(n,ast.FunctionDef)and n.name=='stream');body=ast.unparse(stream)
  self.assertLess(body.index('boundary(h); assert current_node() == node'),body.index("proof =")) if 'boundary(h); assert' in body else self.assertLess(body.rindex('boundary(h)'),body.index('proof ='))
  self.assertIn("row['stdoutBytes'] == 0",body)
 def test_default_profile_exclusion_and_explicit_selection(self):
  tree=ast.parse((HERE/'remote-phase.py').read_bytes());fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='parent_guard')
  command=next(ast.literal_eval(n.args[0])for n in ast.walk(fn)if isinstance(n,ast.Call)and isinstance(n.func,ast.Attribute)and n.func.attr=='run'and n.args and isinstance(n.args[0],ast.List)and any(isinstance(x,ast.Constant)and x.value=='compose'for x in n.args[0].elts))
  self.assertEqual(command[:5],['docker','compose','--profile','deployment','--env-file'])
  source={'services':{'backend':{},'deployment':{'profiles':['deployment'],'volumes':[{'type':'bind','source':'/opt/sabalanerp/deploy/secrets','target':'/run/deployment-secrets','read_only':True}]}}}
  def model(argv):
   enabled=[argv[i+1]for i,x in enumerate(argv[:-1])if x=='--profile'];return {'services':{k:v for k,v in source['services'].items()if not v.get('profiles')or any(x in enabled for x in v['profiles'])}}
  without=[x for x in command];index=without.index('--profile');del without[index:index+2]
  self.assertNotIn('deployment',model(without)['services']);self.assertIn('deployment',model(command)['services'])
  n=runpy.run_path(str(HERE/'remote-phase.py'));n['select_secret_root'].__globals__['pathlib']=pathlib
  spec={'expectedServiceConfiguration':{'backend':{'mounts':[{'type':'bind','source':'/opt/sabalanerp/deploy/secrets/partner-release-trust-public.der','destination':'/run/deployment-secrets/partner-release-trust-public.der','readWrite':False}]}}}
  with self.assertRaises(KeyError):n['select_secret_root'](model(without),spec)
  self.assertEqual(n['select_secret_root'](model(command),spec),'/opt/sabalanerp/deploy/secrets')
if __name__=='__main__':unittest.main()
