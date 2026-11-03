import importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location('source12_private_pair',pathlib.Path(__file__).with_name('application-native-private-pair.fixture.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
def check(value,code):
 if not value:raise AssertionError(code)
class Role:
 def __init__(self,valid=True):self.calls=[];self.valid=valid
 def request(self,command,*args,**kwargs):
  self.calls.append(command)
  if command=='START_ONLINE_POINT_INQUIRY':return dict(actorId='actual-model-actor')
  if command=='RUN_ORIGINAL_ONLINE_CHECKPOINT':return dict(result=dict(originalPointOnlyClosed=self.valid,continuousWalQualified=False,finalIntervalCompletion=False))
  assert kwargs['actor_id']=='actual-model-actor';return dict(closed=True)
class LocalScope(unittest.TestCase):
 def test_protected_complete_never_starts_physical_or_inquiry_point(self):
  role=Role();self.assertEqual(module.qualify_original_local_checkpoint('PROTECTED_COMPLETE',role,check),(None,None));self.assertEqual(role.calls,[])
 def test_point_scope_still_requires_same_original_inquiry_and_point_closure(self):
  role=Role();point,closed=module.qualify_original_local_checkpoint('ONLINE_POINT',role,check)
  self.assertEqual(role.calls,['START_ONLINE_POINT_INQUIRY','RUN_ORIGINAL_ONLINE_CHECKPOINT','FINISH_ONLINE_POINT_INQUIRY']);self.assertTrue(closed['closed'])
 def test_closed_scope_does_not_invent_success_for_failed_point(self):
  with self.assertRaisesRegex(AssertionError,'PRIVATE_POINT_ONLY_CLOSURE_UNPROVEN'):module.qualify_original_local_checkpoint('ONLINE_POINT',Role(False),check)
 def test_unknown_scope_cannot_skip_required_work(self):
  role=Role()
  with self.assertRaisesRegex(AssertionError,'UNKNOWN_LOCAL_QUALIFICATION_SCOPE'):module.qualify_original_local_checkpoint('skip',role,check)
  self.assertEqual(role.calls,[])
if __name__=='__main__':unittest.main()
