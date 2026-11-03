"""Finite real historical receipt joins and rendered source only; no actor/freshness claim."""
import pathlib,json,hashlib,runpy,unittest,ast
H=pathlib.Path(__file__).resolve().parent;P=H.parent/'C30-source-a-no-workspace-stream-owner-source-r4-ssh-and-negative-drain-20261025';C=runpy.run_path(str(H/'components.py'));B=runpy.run_path(str(H/'build-phase.py'));A=H.parent/'C30-source-a-backend-export-material-c913f3b2a87a42489bfe53c2c4d9d030'
def funcs(text):return{n.name:ast.dump(n,include_attributes=False)for n in ast.parse(text).body if isinstance(n,ast.FunctionDef)}
class Tests(unittest.TestCase):
 def test_exact_two_authentic_successes(self):
  for role in ['frontend','inquiry']:
   c=C['select'](role);self.assertEqual(c['service'],role);self.assertEqual(c['raw']['sha256'],c['archiveGraph']['archiveSha256']);self.assertTrue(pathlib.Path(c['gzip']['file']).is_file());self.assertEqual(pathlib.Path(c['gzip']['file']).stat().st_size,c['gzip']['bytes'])
  for foreign in ['backend','unknown',None,{'service':'frontend'}]:
   with self.assertRaises((AssertionError,TypeError)):C['select'](foreign)
 def test_four_full_rendered_phase_guards_and_same_custody(self):
  raw=(A/'remote.py').read_bytes();packet=json.loads((A/'source-review.json').read_bytes());self.assertEqual(hashlib.sha256(raw).hexdigest(),packet['files']['remote.py']['sha256']);spec=json.loads((A/'runtime-spec.json').read_bytes())
  for role in ['frontend','inquiry']:
   c=C['select'](role)
   for phase,cipher in [('encrypt-existing',None),('local-decrypt',{'bytes':c['gzip']['bytes']+1024,'sha256':'1'*64})]:
    v=B['compile_phase'](raw,'1'*32,phase,cipher,spec,c);compile(v['stageSource'],'render-stage','exec');compile(v['runtimeSource'],'render-runtime','exec');self.assertLess(len(v['remoteCommand']),32700);self.assertLess(len(v['runtimeSource']),2*1024**2)
    t=v['runtimeSource'].decode();base=raw.decode().split('def observe(h):')[0];f=funcs(t);old=funcs(base)
    for n in ['boundary','current_node','identity','sync','digest','sha','canonical','original_service_configuration','validate_current_configuration']:self.assertEqual(f[n],old[n],n)
    self.assertIn('stdin=sys.stdin.buffer',t);self.assertIn("result['plainSha256']==COMPONENT['gzip']['sha256']",t);self.assertIn('CANONICAL_CODE_ONLY_WORKSPACE_CAPACITY_REFUSED',t)
  self.assertEqual((H/'stream-native.py').read_bytes(),(P/'stream-native.py').read_bytes());self.assertEqual((H/'build-original.py').read_bytes(),(P/'build-original.py').read_bytes());selector_parent=H.parent/'C30-source-a-no-workspace-stream-owner-source-r7-deployment-profile-20261025/remote-phase.py';self.assertEqual(hashlib.sha256(selector_parent.read_bytes()).hexdigest(),'a7186a31bffcdc955fa5072fe7a7b9ba340a07b6d8e77aca6b084e4e80332080');newguards=funcs(selector_parent.read_text());self.assertEqual(funcs((H/'remote-phase.py').read_text())['parent_guard'],newguards['parent_guard']);self.assertEqual(funcs((H/'remote-phase.py').read_text())['select_secret_root'],newguards['select_secret_root'])
 def test_no_export_regzip_or_new_raw_write_in_live_functions(self):
  pipeline=(H/'pipeline.cjs').read_text();self.assertNotIn('child_process',pipeline);self.assertNotIn('createGzip',pipeline);self.assertNotIn('image\',\'save',pipeline);self.assertIn('FIXED_EXISTING_GZIP',pipeline)
  verify=(H/'validate-gzip.cjs').read_text();self.assertNotIn('O_WRONLY',verify);self.assertNotIn('createWriteStream',verify);self.assertIn('inspectPrivateDockerArchive(rawFile,COMPONENT.image)',verify);self.assertIn('newRawArchiveCreated:false',verify)
 def test_all_python_compile_and_required_input_before_binary(self):
  for p in H.glob('*.py'):compile(p.read_bytes(),str(p),'exec')
  owner=(H/'windows-owner.template.py').read_text();self.assertLess(owner.index("check_input(b['component']['gzip'])"),owner.index("binary=pinned_ssh"));self.assertIn("ad['validate_spec'](spec);preflight['validate'](b['preflight'])",owner)
 def test_current_observed_restart_renderer_and_admission_source_pins(self):
  q=H.parent;renderer=q/'C30-production81-source-preparer-r3-observed-backend-restart-20261025/backend_export.py';self.assertEqual(hashlib.sha256(renderer.read_bytes()).hexdigest(),'47ddc1e8bafc766f9edb50b8563e0b4653adac312875d157f6ced646806756a4')
  ad=q/'C30-observed-second-backend-restart-current-admission-source-r2-20261025/admission.py';self.assertEqual(hashlib.sha256(ad.read_bytes()).hexdigest(),'8c7dc32fd6ad614f2931865141ee46f63c83c19506176730de7383ccdc38003b')
  source=(H/'prepare-phase.py').read_text();self.assertIn(str(ad).replace('\\','/').split('/')[-2],source);self.assertIn('8c7dc32fd6ad614f2931865141ee46f63c83c19506176730de7383ccdc38003b',source)
  saved=(A/'remote.py').read_text();tree=ast.parse(saved);preflight=next(ast.literal_eval(n.value)for n in tree.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='PREFLIGHT'for t in n.targets));spec=json.loads((A/'runtime-spec.json').read_bytes());out=H/'NEVER_CREATED_SOURCE_ONLY';self.assertFalse(out.exists());render=runpy.run_path(str(renderer))['render'](spec,'3'*32,out,preflight);self.assertFalse(out.exists())
  for role in ['frontend','inquiry']:
   c=C['select'](role);v=B['compile_phase'](render['remote.py'],'4'*32,'encrypt-existing',None,spec,c);compile(v['runtimeSource'],'current-renderer-specialization','exec');self.assertFalse(out.exists())
 def test_modelled_source_preparation_has_all_fixed_generated_files_no_io_or_actors(self):
  # Explicit SOURCE SHAPE model only: no current freshness, ACL, receipt or runtime claim.
  import unittest.mock
  ns=runpy.run_path(str(H/'prepare-phase.py'));fn=ns['prepare'];g=fn.__globals__;real=runpy.run_path;spec=json.loads((A/'runtime-spec.json').read_bytes());captured={};private_calls=[]
  def private(root):private_calls.append(root);return {'MODEL_ONLY_NOT_ACL':True}
  def write(file,raw):captured[str(file)]=raw;return {'file':str(file),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
  def model(file,*args,**kwargs):
   name=str(file)
   if name==str(g['AD']):return {'current_spec':lambda ref:spec,'validate_spec':lambda value:self.assertEqual(value,spec)}
   if name==str(g['PRIVATE']):return {'private_output':private,'write':write,'NODE':{'file':'C:/Program Files/nodejs/node.exe','sha256':'MODEL_ONLY'}}
   if name.endswith('/source-a-preflight.py')or name.endswith('\\source-a-preflight.py'):return {'validate':lambda ref:{'observedAt':'2025-01-01T00:00:00Z'}}
   return real(file,*args,**kwargs)
  with unittest.mock.patch.object(runpy,'run_path',side_effect=model):
   result=fn({'file':'MODEL_ONLY_NO_BASELINE','sha256':'0'*64},{'file':'MODEL_ONLY_NO_PREFLIGHT','sha256':'0'*64},'encrypt-existing','f'*32,service='frontend')
  self.assertEqual(len(private_calls),1);self.assertFalse(private_calls[0].exists());material=json.loads(captured[result['file']]);self.assertFalse(material['runtimeExecuted']);self.assertFalse(material['productionAdmission'])
  for name,row in material['files'].items():self.assertEqual(hashlib.sha256(captured[row['file']]).hexdigest(),row['sha256'])
  owner=captured[material['files']['owner.py']['file']].decode();tree=ast.parse(owner);binding=next(ast.literal_eval(n.value)for n in tree.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='BOUND'for t in n.targets));self.assertEqual(binding['component'],C['select']('frontend'));self.assertIn('components.py',binding['sourceFiles']);self.assertIn('validate-gzip.cjs',binding['sourceFiles'])
 def test_backup_finite_builder_same_old_verifier_and_collectors(self):
  m=runpy.run_path(str(H/'build-independent.py'))
  for role in ['frontend','inquiry']:
   c=C['select'](role);expected={'image':c['image'],'plainBytes':c['gzip']['bytes'],'plainSha256':c['gzip']['sha256'],'cipherBytes':c['gzip']['bytes']+1024,'cipherSha256':'2'*64};v=m['build']('2'*32,expected,role);compile(v['runtimeSource'],'backup','exec');self.assertIn(c['image'],v['runtimeSource'].decode());self.assertLess(len(v['verifyCommand']),24000)
   with self.assertRaises(AssertionError):m['build']('2'*32,{**expected,'plainSha256':'3'*64},role)
  old=H.parent/'C30-source-a-independent-image-stream-source-r1-20261025';self.assertEqual((H/'verify-independent.cjs').read_bytes(),(old/'verify.cjs').read_bytes());self.assertEqual((H/'remote-independent.py').read_bytes(),(old/'remote.py').read_bytes());new_owner=(H/'owner-independent.template.py').read_text();self.assertIn("b['encryptionPhase']",new_owner);self.assertIn("scope['module'](b['files']['components.py'],'fixed_two_components')['select'](b['service'])",new_owner)
if __name__=='__main__':unittest.main()
