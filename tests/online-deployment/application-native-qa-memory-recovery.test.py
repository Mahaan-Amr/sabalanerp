"""Pure native recovery-resource schema tests, without Docker or qualification."""
import copy,importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location('old_profile_test',pathlib.Path(__file__).with_name('application-native-qa-memory-2048.test.py'));old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
def fixture():
 v=old.fixture();p=v.pop('candidateQaMemoryTransition');v['originalLimitsUnchanged']=True;p['format']='sabalan-recovered-local-qa-candidate-memory-profile/v1';p['before']['backend-candidate']=2048*old.MIB;p['runtimeLimitsBefore']['backend-candidate']['MemorySwap']=2048*old.MIB;p['predecessor']['sha256']='5c6ffedf131d47d280651f55130ffa25f5798cbbe462ae185f66c577b56229fd';v['inputs'][p['predecessor']['file']]=p['predecessor']['sha256'];p.update(originalTransitionQualified=False,failedReportRemainsFailed=True,negativeOwnerObservationNotAdoption=True,failed=dict(file='D:/fixture/negative.json',sha256='1cccc94373dd98846b5aa8082fa9d76d3edc7a2a3e14e467e8e3e57677dc568d'));v['inputs'][p['failed']['file']]=p['failed']['sha256'];v['candidateQaMemoryRecovery']=p;return v
class RecoveryTests(unittest.TestCase):
 def tearDown(self):old.m.configure_qa_memory_profile({},b'')
 def test_distinct_fresh_recovery_selects2048_without_old_success(self):
  old.invoke(fixture());self.assertEqual(old.m.EXPECTED_CANDIDATE_MEMORY_BYTES,2048*old.MIB)
 def test_relabel_changed_negative_floor_and_ancestor_refuse(self):
  for change in [lambda p:p.__setitem__('originalTransitionQualified',True),lambda p:p['failed'].__setitem__('sha256','a'*64),lambda p:p['predecessor'].__setitem__('sha256','a'*64),lambda p:p['afterUp'].__setitem__('availableBytes',2048*old.MIB-1),lambda p:p['runtimeLimitsAfter']['backend-retained'].__setitem__('MemorySwap',1)]:
   v=fixture();change(v['candidateQaMemoryRecovery'])
   with self.assertRaises((RuntimeError,KeyError)):old.invoke(v)
if __name__=='__main__':unittest.main()
