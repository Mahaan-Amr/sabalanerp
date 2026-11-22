import hashlib,importlib.util,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('producer',ROOT/'deploy/scripts/online-checkpoint-producer.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ScopedOriginalClosure(unittest.TestCase):
 def test_three_real_original_handles_close_while_successor_remains_live(self):
  with tempfile.TemporaryDirectory(prefix='sabalan-point-children-') as directory:
   children=m.OriginalChildren(Path(directory).resolve(),lambda:None);owned=[];producer=m.Producer.__new__(m.Producer);producer.children=children;producer.ownership=lambda:None;producer.original_point_children={}
   for index,key in enumerate(('base_child','capture_child','receiver_child')):
    child=children.start('point-'+str(index),[sys.executable,'-I','-B','-c',"print('actual scoped original child')"]);children.finish(child);producer.original_point_children[key]=child;owned.append(child)
   successor=children.start('successor',[sys.executable,'-I','-B','-c',"import sys;sys.stdin.readline();print('normal successor closure')"],interactive=True)
   try:
    actual=producer.closed_original_point_children();self.assertEqual([row['originalPid'] for row in actual],[child.process.pid for child in owned]);self.assertTrue(all(row['returncode']==0 and row['signal'] is None for row in actual));self.assertFalse(children.closed());self.assertIsNone(successor.process.poll())
    self.assertEqual(actual[0]['stdoutSha256'],hashlib.sha256(owned[0].stdout.read_bytes()).hexdigest())
    # A live genuine successor cannot be substituted for a closed capture.
    producer.original_point_children['capture_child']=successor
    with self.assertRaisesRegex(RuntimeError,'ORIGINAL_POINT_CHILD_NOT_CLOSED'):producer.closed_original_point_children()
   finally:successor.process.stdin.write(b'CLOSE\n');successor.process.stdin.close();children.finish(successor)
   self.assertTrue(children.closed())
if __name__=='__main__':unittest.main()
