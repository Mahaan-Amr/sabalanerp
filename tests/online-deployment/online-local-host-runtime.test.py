import hashlib,importlib.util,json,os,sys,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('actual_producer',Path(sys.argv[1]));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
runtime_spec=importlib.util.spec_from_file_location('actual_host',Path(sys.argv[1]).with_name('online-local-host-runtime.py'));h=importlib.util.module_from_spec(runtime_spec);runtime_spec.loader.exec_module(h)
descriptor=json.loads(sys.argv[2]);sys.argv=sys.argv[:1]
class LocalRuntime(unittest.TestCase):
 def test_production_defaults_remain_fixed(self):
  self.assertEqual(p.host_runtime({'project':'sabalanerp'})['python'],['/usr/bin/python3','-I','-B']);self.assertEqual(p.host_runtime({'project':'sabalanerp'})['docker'],['/usr/bin/docker'])
 def test_production_refuses_local_descriptor(self):
  with self.assertRaisesRegex(RuntimeError,'LOCAL_RUNTIME_PROJECT_REQUIRED'):p.validate_host_runtime({'project':'sabalanerp','localHostRuntime':descriptor})
 def test_json_private_authority_or_unvalidated_local_is_refused(self):
  with self.assertRaisesRegex(RuntimeError,'LOCAL_RUNTIME_NOT_VALIDATED'):p.host_runtime({'project':'sabalanerp-local','localHostRuntime':descriptor,'_localRuntimeAuthority':True})
  with self.assertRaisesRegex(RuntimeError,'LOCAL_RUNTIME_PRIVATE_INPUT'):p.validate_host_runtime({'project':'sabalanerp-local','_localRuntimeCommands':{}})
 def test_actual_source_bound_runtime_not_caller_argv(self):
  file=Path(spec.origin)
  helper=file.with_name('online-local-host-runtime.py');config={'project':'sabalanerp-local','localHostRuntime':descriptor,'helpers':{'localRuntime':{'file':str(helper),'sha256':hashlib.sha256(helper.read_bytes()).hexdigest()}}};p.validate_host_runtime(config);runtime=p.host_runtime(config)
  self.assertEqual(runtime['python'][-2:],['-I','-B']);self.assertEqual(runtime['docker'][-2:],['--host','unix:///run/docker.sock']);self.assertTrue(runtime['python'][0].startswith(descriptor['root']+'/sysroot/'))
  with self.assertRaisesRegex(RuntimeError,'DESCRIPTOR'):h.validate(dict(descriptor,python=['/bin/sh']))
 def test_local_runtime_census_requires_full_ten_healthy_rows(self):
  ids=[str(i).zfill(64)for i in range(10)];rows=[{'ID':x,'Project':'sabalanerp-local','State':'running','Health':'healthy'}for x in ids];p.validate_census(rows,ids,'sabalanerp-local')
  with self.assertRaisesRegex(RuntimeError,'LOCAL_CANONICAL_SERVICES_UNHEALTHY'):p.validate_census([{**x,'Health':'starting'}for x in rows],ids,'sabalanerp-local')
  with self.assertRaisesRegex(RuntimeError,'CENSUS_CHANGED'):p.validate_census([{**x,'ID':x['ID'][:12]}for x in rows],ids,'sabalanerp-local')
 def test_actual_uninventoried_file_refuses(self):
  file=Path(descriptor['root'])/'sysroot/extra-uninventoried-test';fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o400);os.write(fd,b'x');os.fsync(fd);os.close(fd)
  try:
   with self.assertRaisesRegex(RuntimeError,'EXTRA_RUNTIME_FILE'):h.validate(descriptor)
  finally:file.unlink()
 def test_extra_empty_or_symlink_directory_is_not_silently_ignored(self):
  directory=Path(descriptor['root'])/'sysroot/extra-empty-test';directory.mkdir(mode=0o700)
  try:
   with self.assertRaisesRegex(RuntimeError,'EXTRA_RUNTIME_FILE'):h.validate(descriptor)
  finally:directory.rmdir()
 def test_zero_byte_hash_is_real_and_supported(self):
  with tempfile.TemporaryDirectory(prefix='sabalan-runtime-zero-')as root:
   file=Path(root)/'zero';file.write_bytes(b'');file.chmod(0o400);self.assertEqual(h.digest(file),(hashlib.sha256(b'').hexdigest(),0));self.assertEqual(p.source_sha(file,allow_empty=True),hashlib.sha256(b'').hexdigest())
   with self.assertRaisesRegex(RuntimeError,'FIXED_SOURCE_UNSAFE'):p.source_sha(file)
if __name__=='__main__':unittest.main()