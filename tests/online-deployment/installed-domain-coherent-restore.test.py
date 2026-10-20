"""Refusal tests; no Docker/SQL/application and no fabricated successful restore."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('domain_restore',Path(__file__).with_name('installed-domain-coherent-restore.fixture.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class DomainRestore(unittest.TestCase):
 def definition(self):
  def grant(identity,purpose='http',database='qa_application_restored_'+'a'*32):return dict(scope=dict(runtimeId=identity*64,nonce=identity*64,purpose=purpose,database=dict(name=database)))
  old=grant('a');capture=grant('b','capture');baseline=grant('c','jobs','qa_application_native_'+'b'*32)
  return dict(database='qa_application_native_'+'a'*32,restoredDatabase='qa_application_restored_'+'a'*32,grants=[old],restoredGrant=grant('d'),restoredBaselineGrant=grant('e','jobs'),privateQualification=dict(httpGrants=[grant('f'),grant('1')],oldJobsGrant=grant('2','jobs'),jobsGrant=grant('3','jobs'),domainRestore=dict(captureGrant=capture,baselineGrant=baseline,root='/private/domain-restore',database='qa_application_native_'+'b'*32,databaseOid='42')))
 def refuse(self,index,code):
  module.OWNER=None
  def check(ok,message):
   if not ok:raise RuntimeError(message)
  def forbidden(*args):raise AssertionError('SQL_OR_MUTATION_BEFORE_ADMISSION')
  with self.assertRaisesRegex(RuntimeError,code):module.run(Path('/private'),index,{},None,forbidden,forbidden,forbidden,check,None,dict(format='sabalan-installed-domain-writers/v1'),{})
  self.assertIsNone(module.OWNER)
 def test_reused_capture_nonce_refused_before_sql_or_files(self):
  index=self.definition();index['privateQualification']['domainRestore']['captureGrant']['scope']['nonce']='a'*64
  self.refuse(index,'DOMAIN_RESTORE_CAPTURE_GRANT_REUSED')
 def test_reused_baseline_nonce_refused_before_sql_or_files(self):
  index=self.definition();index['privateQualification']['domainRestore']['baselineGrant']['scope']['nonce']='a'*64
  self.refuse(index,'DOMAIN_RESTORE_BASELINE_GRANT_REUSED')
 def test_target_database_must_be_distinct(self):
  index=self.definition();index['privateQualification']['domainRestore']['database']=index['database']
  self.refuse(index,'DOMAIN_RESTORE_DATABASE_NOT_DISTINCT')
 @unittest.skipUnless(sys.platform=='linux','actual O_NOFOLLOW/uid/fsync semantics require Linux')
 def test_stream_copy_is_exact_immutable_and_never_overwrites(self):
  import os
  with tempfile.TemporaryDirectory() as temporary:
   source=Path(temporary)/'source';source.write_bytes(b'original-parent-sqlite'*100000);target=Path(temporary)/'copy'
   expected,pin=module.immutable_copy(source,target,4*1024**2)
   self.assertEqual(expected,module.stable_digest(target,4*1024**2)[0]);self.assertEqual(target.stat().st_mode&0o777,0o400);self.assertEqual(pin,module.pin(source.stat()))
   with self.assertRaises(FileExistsError):module.immutable_copy(source,target,4*1024**2)
   os.chmod(target,0o600)
 @unittest.skipUnless(sys.platform=='linux','actual O_NOFOLLOW/uid/fsync semantics require Linux')
 def test_symlink_and_bound_refused(self):
  with tempfile.TemporaryDirectory() as temporary:
   source=Path(temporary)/'source';source.write_bytes(b'actual-original');link=Path(temporary)/'alias';link.symlink_to(source)
   with self.assertRaisesRegex(RuntimeError,'PATH_UNSAFE'):module.stable_digest(link,100)
   with self.assertRaisesRegex(RuntimeError,'FILE_UNSAFE'):module.stable_digest(source,2)
if __name__=='__main__':unittest.main()
