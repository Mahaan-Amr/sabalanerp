import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch


ACTIVE_SHA = '334255f21ce1dc1eed916c26e47cc70c535cb81654552b760743e0e1cec997fd'
OLD_BOOT = 'ecdfd6df-b536-4161-9bef-a97e7a69f788'
BOOT = 'e758296d-c127-49c1-94d4-636136f61d1b'
SYSTEM = '7703877635514671138'
BACKEND = 'sha256:86899cc48ba087f22ee2385c20b6ca7cf2f568ff15d51fd44f1b6e57f021d4af'
CONTAINER = '054134c71149589d36eeaec7d80b9f0932e92a675a2f5e91147fbd47748e1cbf'
INQUIRY = 'sha256:861da55794e7dac1e98c972c3f8f3bbb2ec3b3289df10d27e1556d246b2c32c8'
PREVIOUS_ACTIVE = '2cfea161077b52a2313177be2e2ce0ee9cb15682b7dd2d83c0df6539e30898a9'
PREVIOUS_RECEIPT = '109bc44da8d00b93e99266c759c134c3570b67330c0b8fb1ddb6125cb16e5235'
CANDIDATE = 'sha256:' + '8' * 64
FILES = ['backend_recovery.tar', 'backend_storage_accounting_contracts.tar',
         'backend_storage_contracts.tar', 'backend_storage_dispatch_documents.tar',
         'backend_storage_hr_hiring.tar', 'backend_storage_sepidar_backups.tar',
         'backend_storage_support_tickets.tar', 'backend_uploads.tar', 'inquiry_data.tar',
         'redis_data.tar', 'recovery_coordination.tar', 'postgres.dump', 'backend-image.tar',
         'inquiry-image.tar', 'inquiry-consistent.db', 'redis-consistent.rdb']


class LocalRebootIncident(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('incident', Path(__file__).resolve().parents[2] /
                                                      'deploy/scripts/local-native-reboot-20261117.py')
        self.policy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.policy)
        instance = 'a21c30608612fd8d9a6c0b41f799c542c9391a8203d6ba5e'
        self.active = dict(format='sabalan-runtime-native/v1', phase='ACTIVE', role='standalone',
                           instanceId=instance, namespace='sabalan-rt-' + instance, clusterIdentifier=SYSTEM,
                           initialDatabase=dict(name='sabalanerp', oid='57567'),
                           guardian=dict(bootId=OLD_BOOT, pid=1, pidNamespace='pid:[4026532757]', startTicks='2758265'),
                           previousSha256=PREVIOUS_ACTIVE, localAbandonmentSha256=PREVIOUS_RECEIPT)
        self.manifest = dict(format='sabalan-local-dual-checkpoint/v1', sourceProject='sabalanerp-local',
                             backendImage=BACKEND, inquiryImage=INQUIRY, activeSha256=ACTIVE_SHA,
                             backendContainerId=CONTAINER, observedBootId=BOOT, clusterIdentifier=SYSTEM,
                             databaseOid='57567', captureStartedAt='2026-11-17T12:34:56.789Z',
                             entries=[dict(name=name, bytes=42, sha256='9' * 64) for name in FILES])
        self.proof = dict(format='sabalan-local-native-reboot-host-proof/v1', project='sabalanerp-local',
                          backendContainerId=CONTAINER, oldImageId=BACKEND, inquiryImageId=INQUIRY,
                          candidateImageId=CANDIDATE, activeSha256=ACTIVE_SHA, bootId=BOOT,
                          publicIngress=False, previousReceiptSha256=PREVIOUS_RECEIPT, previousActiveSha256=PREVIOUS_ACTIVE,
                          database=dict(system=SYSTEM, oid='57567', oldSessions=0, allTagged=0, prepared=0))
        self.observed = dict(project='sabalanerp-local', nodeEnv='development', role='standalone', imageId=CANDIDATE,
                             bootId=BOOT, systemIdentifier=SYSTEM, databaseOid='57567', oldSessions=0,
                             allTaggedSessions=0, prepared=0, publicIngress=False, externalCredentials=False,
                             previousReceiptSha256=PREVIOUS_RECEIPT, previousActiveSha256=PREVIOUS_ACTIVE,
                             hostProof=self.proof, hostProofSha256='3' * 64)

    def checkpoint(self, use_fixture_digest=True):
        raw = json.dumps(self.manifest).encode()
        digest = hashlib.sha256(raw).hexdigest()
        if use_fixture_digest:
            # Synthetic checkpoint contents stay separate from the machine's incident data.
            fixture = patch.object(self.policy, 'MANIFEST_SHA', digest)
            fixture.start()
            self.addCleanup(fixture.stop)
        self.proof['checkpoint'] = dict(primaryPath=r'D:\sabalanerp-local-recovery-20261117', independentPath=r'C:\Users\PC\Documents\Codex\sabalanerp-local-recovery-20261117',
                                        manifestSha256=digest, independentManifestSha256=digest,
                                        primaryReadbackVerified=True, independentReadbackVerified=True,
                                        manifestRawBase64=base64.b64encode(raw).decode())

    def test_exact_reboot_admits_local_abandonment_with_truthful_receipt(self):
        self.checkpoint()
        receipt = self.policy.reconcile(self.active, ACTIVE_SHA, self.observed)
        self.assertEqual(receipt['phase'], 'ABANDONED_ON_VM_REBOOT')
        self.assertIs(receipt['nativeReaped'], False)
        self.assertIs(receipt['externalEffectsCompleted'], False)
        self.assertIs(receipt['productionAdmission'], False)
        self.assertTrue(self.policy.valid_receipt(self.active, ACTIVE_SHA, receipt, self.observed))

    def test_missing_consistent_backup_prevents_abandonment(self):
        self.manifest['entries'].pop()
        self.checkpoint()
        with self.assertRaises(RuntimeError):
            self.policy.reconcile(self.active, ACTIVE_SHA, self.observed)

    def test_unverified_second_disk_prevents_abandonment(self):
        self.checkpoint()
        self.proof['checkpoint']['independentReadbackVerified'] = False
        with self.assertRaises(RuntimeError):
            self.policy.reconcile(self.active, ACTIVE_SHA, self.observed)

    def test_changed_sql_observation_prevents_abandonment(self):
        self.checkpoint()
        self.observed['allTaggedSessions'] = 1
        with self.assertRaises(RuntimeError):
            self.policy.reconcile(self.active, ACTIVE_SHA, self.observed)

    def test_substituted_manifest_prevents_abandonment_even_if_self_consistent(self):
        self.checkpoint(use_fixture_digest=False)
        with self.assertRaises(RuntimeError):
            self.policy.reconcile(self.active, ACTIVE_SHA, self.observed)

    def test_prior_checkpoint_prevents_abandonment_even_if_fully_read(self):
        self.manifest['captureStartedAt'] = '2026-11-16T12:34:56.789Z'
        self.checkpoint()
        with self.assertRaises(RuntimeError):
            self.policy.reconcile(self.active, ACTIVE_SHA, self.observed)


if __name__ == '__main__':
    unittest.main()
