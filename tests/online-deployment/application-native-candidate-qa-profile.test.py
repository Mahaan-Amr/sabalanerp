"""Portable regression for captured post-UP resource evidence at controller startup.
No Docker, Windows host paths, original handles or native acceptance are implied.
"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('candidate_owner', Path(__file__).with_name('application-native-candidate-controller.fixture.py'))
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)
MIB = 1024 * 1024
SERVICES = ['backend-candidate', 'backend-retained']


def capsule_receipt():
    """Small typed resource receipt; the host authenticates its source baseline."""
    ref = {'file': 'C:/qa/capsule-baseline.json', 'sha256': 'b' * 64}
    budgets = {'backend-candidate': 2048*MIB, 'backend-retained': 768*MIB}
    limits = {service: {'MemorySwap': (2048 if service == SERVICES[0] else 1536)*MIB,
                        'NanoCpus': 1000000000} for service in SERVICES}
    samples = [{'platform': 'win32', 'availableBytes': 3072*MIB,
                'observedAt': '2026-10-24T10:00:0' + str(i) + '.000Z'} for i in [1, 2]]
    previous = {service: {'id': str(i)*64, 'image': 'sha256:' + 'a'*64,
                          'startedAt': '2026-10-24T09:00:00Z'} for i, service in enumerate(SERVICES, 1)}
    actual = {service: {'id': str(i+3)*64, 'memoryBytes': budgets[service],
                        'memorySwapBytes': limits[service]['MemorySwap']} for i, service in enumerate(SERVICES)}
    return {
        'format': 'sabalan-application-native-candidate/v1', 'pass': True,
        'phase': 'COMPLETE', 'productionAdmission': False,
        'up': {'code': 0, 'signal': None},
        'originalChildren': {'allOriginalChildrenClosed': True, 'interrupted': False},
        'originalLimitsUnchanged': True, 'inputs': {ref['file']: ref['sha256']},
        'postUpMemoryBaseline': copy.deepcopy(ref),
        'candidateQaMemoryPostUpRecovery': {
            'format': 'sabalan-post-up-negative-baseline-local-qa-memory-profile/v1',
            'baseline': ref, 'failedReportRemainsFailed': True, 'originalUpAdopted': False,
            'before': budgets, 'after': copy.deepcopy(budgets),
            'runtimeLimitsBefore': limits, 'runtimeLimitsAfter': copy.deepcopy(limits),
            'beforeUp': samples[0], 'afterUp': samples[1], 'afterUpSamples': samples,
            'nativeActorFloorBytes': 384*MIB, 'cacheCreditUsed': False},
        'previous': previous, 'actual': actual,
        'protectedBefore': [{'id': 'c'*64}], 'protectedAfter': [{'id': 'c'*64}],
        'finalProtected': [{'id': 'c'*64}],
        'reobservedBaseline': {
            'format': 'sabalan-reobserved-post-up-negative-slots/v1',
            'identities': previous, 'previousIdentities': copy.deepcopy(previous),
            'qualificationSucceeded': False, 'installedBytesVerified': True,
            'nativeAndSqlQuietVerified': True, 'currentEmptyNamespacesVerified': False,
            'currentAuthorityNamespacesVerified': True, 'currentInertAcceptanceVerified': True},
        'reobservedInstalled': {service: {'originalPid': 101+i, 'code': 0, 'signal': None}
                                for i, service in enumerate(SERVICES)},
        'reobservedNativeQuiet': {service: {'originalNativeProcesses': 0, 'adoptsOriginalPopen': False}
                                 for service in SERVICES},
        'postUpBaselineAuthorityVerified': {service: {'code': 0, 'signal': None,
            'result': {'format': 'sabalan-authority-cohort-directory/v1', 'empty': True,
                       'productionAdmission': False}} for service in SERVICES},
        'postUpBaselineAcceptanceVerified': {service: {'originalPid': 201+i, 'code': 0,
            'signal': None, 'stdoutEof': True, 'stderrEof': True,
            'result': {'format': 'sabalan-inert-owned-acceptance-history/v1',
                       'classification': 'INERT_OWNED_HISTORY_VIEW', 'physicalEmpty': False,
                       'productionAdmission': False}} for i, service in enumerate(SERVICES)},
        'reobservedSqlQuiet': {'visible': True, 'sessions': 0, 'prepared': 0}}


class CapturedPostUpProfileTests(unittest.TestCase):
    def configure(self, receipt):
        raw = json.dumps(receipt).encode()
        sha = hashlib.sha256(raw).hexdigest()
        configuration = {'roleQualification': {'sha256': sha}, 'qaMemoryProfile': {
            'format': 'sabalan-explicit-local-qa-memory-profile/v1',
            'candidateBytes': 2048*MIB, 'candidateSwapBytes': 2048*MIB,
            'replacementReceiptSha256': sha, 'receiptFile': 'qa-memory-replacement-receipt.json'}}
        owner.configure_qa_memory_profile(configuration, raw)

    def test_captured_capsule_profile_sets_enforced_resource_budget(self):
        self.configure(capsule_receipt())
        self.assertEqual(owner.EXPECTED_CANDIDATE_MEMORY_BYTES, 2048*MIB)

    def test_profile_requires_receipt_content_hash(self):
        configuration = {'roleQualification': {'sha256': '0'*64}, 'qaMemoryProfile': {
            'format': 'sabalan-explicit-local-qa-memory-profile/v1',
            'candidateBytes': 2048*MIB, 'candidateSwapBytes': 2048*MIB,
            'replacementReceiptSha256': '0'*64, 'receiptFile': 'qa-memory-replacement-receipt.json'}}
        with self.assertRaisesRegex(RuntimeError, 'CANDIDATE_QA_PROFILE_RECEIPT_CHANGED'):
            owner.configure_qa_memory_profile(configuration, json.dumps(capsule_receipt()).encode())

    def test_incomplete_or_ambiguous_recovery_evidence_cannot_set_budget(self):
        cases = [
            (['candidateQaMemoryRecovery'], {}),
            (['candidateQaMemoryTransition'], {}),
            (['candidateQaMemoryPostUpRecovery', 'originalUpAdopted'], True),
            (['candidateQaMemoryPostUpRecovery', 'failedReportRemainsFailed'], False),
            (['candidateQaMemoryPostUpRecovery', 'baseline', 'sha256'], '0'*64),
            (['reobservedBaseline', 'currentEmptyNamespacesVerified'], True),
            (['reobservedBaseline', 'currentInertAcceptanceVerified'], False),
            (['reobservedBaseline', 'currentAuthorityNamespacesVerified'], False),
            (['postUpBaselineAcceptanceVerified', 'backend-candidate', 'stdoutEof'], False),
            (['postUpBaselineAcceptanceVerified', 'backend-retained', 'originalPid'], 0),
            (['postUpBaselineAcceptanceVerified', 'backend-candidate', 'result', 'physicalEmpty'], True),
            (['postUpBaselineAuthorityVerified', 'backend-retained', 'code'], 1),
            (['reobservedNativeQuiet', 'backend-candidate', 'originalNativeProcesses'], 1),
            (['reobservedSqlQuiet', 'sessions'], 1),
            (['originalChildren', 'allOriginalChildrenClosed'], False),
            (['productionAdmission'], True), (['pass'], False),
            (['candidateQaMemoryPostUpRecovery', 'runtimeLimitsAfter', 'backend-candidate', 'MemorySwap'], 1536*MIB),
            (['candidateQaMemoryPostUpRecovery', 'afterUpSamples'], [])]
        for path, value in cases:
            with self.subTest(path=path):
                receipt = capsule_receipt()
                target = receipt
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = value
                owner.EXPECTED_CANDIDATE_MEMORY_BYTES = 1536*MIB
                with self.assertRaises((RuntimeError, KeyError, IndexError, TypeError)):
                    self.configure(receipt)
                self.assertEqual(owner.EXPECTED_CANDIDATE_MEMORY_BYTES, 1536*MIB)


if __name__ == '__main__':
    unittest.main()
