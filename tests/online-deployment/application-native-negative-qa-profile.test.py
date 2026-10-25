"""Captured typed negative resource receipt; no native custody or runtime qualification."""
import copy,importlib.util,json
from pathlib import Path
import unittest

s=importlib.util.spec_from_file_location('post_up_resource_tests',Path(__file__).with_name('application-native-candidate-qa-profile.test.py'))
base=importlib.util.module_from_spec(s);s.loader.exec_module(base)

def receipt():
    value=base.capsule_receipt();p=value.pop('candidateQaMemoryPostUpRecovery');p.pop('baseline');p.pop('failedReportRemainsFailed');p.pop('originalUpAdopted')
    p.update(format='sabalan-negative-baseline-local-qa-memory-profile/v1',historicalPhysicalIdentityClaimed=False,resourceProfileHistoryOnly=True,
             handoff={'file':'C:/qa/negative-handoff.json','sha256':'6543f4851d2076af49aaf20ee4238a2935cb615fa143e45bc7a0593ae3f12edd'},
             history={'file':'C:/qa/historical-material-profile.json','sha256':'80e2d47c2f59f492df124109499393dbdc6b4c88efbfef954b048b0815dcfe67'},
             transition={'file':'C:/qa/historical-transition.json','sha256':'c'*64})
    value.pop('postUpMemoryBaseline');value['candidateQaMemoryNegativeRecovery']=p;value['negativeRecoveryHandoff']=copy.deepcopy(p['handoff'])
    value['inputs']={r['file']:r['sha256']for r in [p['handoff'],p['history'],p['transition']]}
    b=value['reobservedBaseline'];b.update(format='sabalan-reobserved-negative-unqualified-slots/v1',historicalPhysicalIdentityClaimed=False,acceptancePhysicalEmpty=False)
    value['negativeBaselineAuthorityVerified']=value.pop('postUpBaselineAuthorityVerified')
    value['negativeBaselineAcceptanceVerified']=value.pop('postUpBaselineAcceptanceVerified')
    for v in value['negativeBaselineAcceptanceVerified'].values():v['result']={'format':'sabalan-C29-current-two-readonly-capsule-acceptance/v1','physicalEmpty':False,'actorEntries':[],'productionAdmission':False}
    return value

class TypedNegativeProfileTests(base.CapturedPostUpProfileTests):
    def test_typed_nonempty_negative_profile_uses_real_budget(self):
        self.configure(receipt());self.assertEqual(base.owner.EXPECTED_CANDIDATE_MEMORY_BYTES,2048*base.MIB)

    def test_changed_negative_proof_cannot_set_budget(self):
        mutations=[
            lambda v:v['candidateQaMemoryNegativeRecovery']['handoff'].update(sha256='d'*64),
            lambda v:v['candidateQaMemoryNegativeRecovery']['history'].update(sha256='d'*64),
            lambda v:v['candidateQaMemoryNegativeRecovery'].update(historicalPhysicalIdentityClaimed=True),
            lambda v:v['candidateQaMemoryNegativeRecovery'].update(resourceProfileHistoryOnly=False),
            lambda v:v.update(previousReplacement={'file':'C:/qa/old.json','sha256':'a'*64}),
            lambda v:v['inputs'].clear(),
            lambda v:v['reobservedBaseline'].update(currentEmptyNamespacesVerified=True),
            lambda v:v['reobservedBaseline'].update(currentAuthorityNamespacesVerified=False),
            lambda v:v['reobservedBaseline'].update(currentInertAcceptanceVerified=False),
            lambda v:v['reobservedBaseline'].update(acceptancePhysicalEmpty=True),
            lambda v:v['reobservedBaseline'].update(historicalPhysicalIdentityClaimed=True),
            lambda v:v['candidateQaMemoryNegativeRecovery']['afterUpSamples'].clear(),
            lambda v:v['protectedAfter'].clear(),
            lambda v:v['reobservedSqlQuiet'].update(sessions=1),
            lambda v:v['negativeBaselineAcceptanceVerified']['backend-candidate'].update(stdoutEof=False),
            lambda v:v['negativeBaselineAcceptanceVerified']['backend-candidate'].update(code=False),
            lambda v:v['negativeBaselineAcceptanceVerified']['backend-candidate']['result'].update(actorEntries=['unexpected']),
            lambda v:v['negativeBaselineAuthorityVerified']['backend-retained']['result'].update(empty=False),
            lambda v:v['reobservedNativeQuiet']['backend-candidate'].update(adoptsOriginalPopen=True),
            lambda v:v.update(candidateQaMemoryProfile={})]
        for i,mutate in enumerate(mutations):
            with self.subTest(i=i):
                value=receipt();mutate(value);base.owner.EXPECTED_CANDIDATE_MEMORY_BYTES=1536*base.MIB
                with self.assertRaises((RuntimeError,KeyError,TypeError)):self.configure(value)
                self.assertEqual(base.owner.EXPECTED_CANDIDATE_MEMORY_BYTES,1536*base.MIB)

if __name__=='__main__':unittest.main()
