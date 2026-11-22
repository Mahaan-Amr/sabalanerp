import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch,Mock
if sys.platform != "linux":sys.modules["fcntl"]=Mock()

file=Path(__file__).resolve().parents[2]/'deploy/scripts/retire-protected-online-legacy-records.py'
spec=importlib.util.spec_from_file_location('retirement',file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class RetirementTests(unittest.TestCase):
 def test_requires_actual_closed_record_and_exact_database_identity(self):
  record=dict(format='sabalan-bootstrap-native/v1',phase='QUIESCENT',nativeReaped=True,databaseQuiet=True,nativeStatus=1,namespace='sabalan-bootstrap-a',identity=dict(database='qa',oid='123',system='456'))
  self.assertEqual(module.closed(record,record['format']),record['identity'])
  for field,value in [('phase','ACTIVE'),('nativeReaped',False),('databaseQuiet',False),('nativeStatus',True),('namespace',"foreign' OR true")]:
   with self.subTest(field=field),self.assertRaises(RuntimeError):module.closed(dict(record,**{field:value}),record['format'])
 def launch_query(self,script):
  real=subprocess.Popen
  def spawn(argv,**kwargs):
   self.assertEqual(argv[0],'/usr/bin/psql');self.assertIs(kwargs['stdin'],subprocess.DEVNULL)
   kwargs.pop('env',None)
   return real([sys.executable,'-I','-c',script],**kwargs)
  with patch.object(module.subprocess,'Popen',side_effect=spawn):return module.query('SELECT observed',{})
 def test_original_child_and_both_streams_actually_close(self):
  self.assertEqual(self.launch_query("import sys;sys.stderr.write('diagnostic');print('{\"actual\":true}')"),{'actual':True})
  row=module.originals[-1];self.assertEqual(row['process'].returncode,0);self.assertEqual(row['eof'],2)
  self.assertTrue(all(not thread.is_alive() for thread in row['threads']))
 def test_overflow_fails_after_original_child_is_reaped(self):
  with self.assertRaises(RuntimeError):self.launch_query("import sys;sys.stdout.write('x'*70000)")
  self.assertEqual(module.originals[-1]['process'].returncode,0);self.assertEqual(module.originals[-1]['eof'],2)

if __name__=='__main__':unittest.main()
