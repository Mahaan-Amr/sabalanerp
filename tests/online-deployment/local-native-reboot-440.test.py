"""The second local reboot exception preserves the first receipt."""
import importlib.util
import hashlib
import json
import copy
from pathlib import Path
import unittest


SOURCE = Path(__file__).resolve().parents[2] / 'deploy/scripts/local-native-reboot-440.py'
spec = importlib.util.spec_from_file_location('local_native_reboot', SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
owner_source = Path(__file__).resolve().parents[2] / 'deploy/scripts/backend-runtime-owner.py'
owner_spec = importlib.util.spec_from_file_location('backend_runtime_owner', owner_source)
owner = importlib.util.module_from_spec(owner_spec)
owner_spec.loader.exec_module(owner)


class LocalNativeRebootPolicy(unittest.TestCase):
    def setUp(self):
        self.active = dict(format='sabalan-runtime-native/v1', phase='ACTIVE', role='standalone',
                           instanceId=module.INCIDENT['namespace'][11:], namespace=module.INCIDENT['namespace'],
                           clusterIdentifier='7703877635514671138',
                           previousSha256='a22e3874e7af624bc804ef91bb792026f13e49ce4d3247082c164848547b3a42',
                           localAbandonmentSha256=module.PRIOR_RECEIPT_SHA,
                           initialDatabase=dict(name='sabalanerp', oid='57567'),
                           guardian=dict(pid=1, bootId=module.INCIDENT['oldBootId'],
                                         pidNamespace=module.INCIDENT['pidNamespace'], startTicks='1829736'))
        self.observed = dict(project='sabalanerp-local', nodeEnv='development', role='standalone',
                             imageId='sha256:' + 'b' * 64, bootId=module.INCIDENT['newBootId'],
                             systemIdentifier='7703877635514671138', databaseOid='57567',
                             oldSessions=0, allTaggedSessions=0, prepared=0,
                             publicIngress=False, externalCredentials=False,
                             priorReceiptSha256=module.PRIOR_RECEIPT_SHA,
                             priorHostProofSha256=module.PRIOR_PROOF_SHA,
                             historicalActive=[dict(name='deployment-runtime-native.preserved-' + sha + '.json',
                                                    sha256=sha) for sha in module.PRESERVED],
                             historicalIncidentEvidence=[dict(name=name, sha256=sha)
                                                         for name, sha in module.INCIDENT_EVIDENCE])
        self.observed['hostProofSha256'] = 'e' * 64
        self.observed['hostProof'] = dict(format='sabalan-local-native-reboot-host-proof/v1',
                                         project='sabalanerp-local',
                                         backendContainerId=module.INCIDENT['oldContainerId'],
                                         oldImageId=module.INCIDENT['oldImageId'],
                                         retainedOldImageTag='sabalanerp-local-backend:pre-reboot-20261114',
                                         priorReceiptSha256=module.PRIOR_RECEIPT_SHA,
                                         priorHostProofSha256=module.PRIOR_PROOF_SHA,
                                         priorCheckpointManifestSha256=module.PRIOR_MANIFEST_SHA,
                                         activeSha256=module.INCIDENT['activeSha256'],
                                         candidateImageId=self.observed['imageId'],
                                         bootId=self.observed['bootId'], publicIngress=False,
                                         historicalActive=self.observed['historicalActive'],
                                         historicalIncidentEvidence=self.observed['historicalIncidentEvidence'],
                                         database=dict(system=module.INCIDENT['systemIdentifier'],
                                                       oid=module.INCIDENT['databaseOid'],
                                                       oldSessions=0, allTagged=0, prepared=0),
                                         checkpoint=dict(manifestSha256='f' * 64,
                                                         independentManifestSha256='f' * 64,
                                                         primaryPath='C:/checkpoint',
                                                         independentPath='D:/checkpoint',
                                                         primaryReadbackVerified=True,
                                                         independentReadbackVerified=True,
                                                         manifest=dict(format='sabalan-local-native-reboot-checkpoint/v1',
                                                                       activeSha256=module.INCIDENT['activeSha256'],
                                                                       postgresSystemIdentifier=module.INCIDENT['systemIdentifier'],
                                                                       databaseOid=module.INCIDENT['databaseOid'],
                                                                       inquiryDatabase='consistent-sqlite-backup',
                                                                       redis='consistent-rdb-snapshot',
                                                                       clamavSignatures='regenerable-service-untouched',
                                                                       volumeArchives='file-copy-only',
                                                                       absentBeforeReconciliation=[],
                                                                       entries=[dict(name=name, sha256='f' * 64, bytes=1024)
                                                                                for name in ['backend-old-container-inspect.json',
                                                                                             'backend-old-rootfs.tar',
                                                                                             'postgres-sabalanerp.dump',
                                                                                             'inquiry-consistent.db',
                                                                                             'redis-consistent.rdb'] +
                                                                                ['volume-' + name + '.tar'
                                                                                 for name in module.VOLUMES]])))
        manifest = self.observed['hostProof']['checkpoint']['manifest']
        sha = hashlib.sha256((json.dumps(manifest, separators=(',', ':')) + '\n').encode()).hexdigest()
        self.observed['hostProof']['checkpoint']['manifestSha256'] = sha
        self.observed['hostProof']['checkpoint']['independentManifestSha256'] = sha

    def test_exact_local_reboot_produces_truthful_exception(self):
        receipt = module.reconcile(self.active, module.INCIDENT['activeSha256'], self.observed)
        self.assertEqual(receipt['phase'], 'ABANDONED_ON_VM_REBOOT')
        self.assertIs(receipt['nativeReaped'], False)
        self.assertIs(receipt['externalEffectsCompleted'], False)
        self.assertIs(receipt['productionAdmission'], False)
        self.assertEqual(receipt['activeSha256'], module.INCIDENT['activeSha256'])
        self.assertTrue(module.valid_receipt(self.active, module.INCIDENT['activeSha256'], receipt, self.observed))

    def test_owner_routes_only_second_sha_to_new_append_only_files(self):
        selected, proof, receipt = owner.local_reboot_policy(module.INCIDENT['activeSha256'])
        self.assertEqual(selected.INCIDENT['activeSha256'], module.INCIDENT['activeSha256'])
        self.assertEqual(proof, 'deployment-runtime-recovery-host-proof-440.json')
        self.assertEqual(receipt, 'deployment-runtime-abandonment-440.json')
        with self.assertRaises(RuntimeError):
            owner.local_reboot_policy('0' * 64)

    def test_changed_or_unproven_facts_fail_closed(self):
        for key, value in [('project', 'sabalanerp'), ('nodeEnv', 'production'), ('role', 'control'),
                           ('imageId', 'sha256:' + 'e' * 64), ('bootId', module.INCIDENT['oldBootId']),
                           ('systemIdentifier', '1'), ('databaseOid', '1'), ('oldSessions', 1),
                           ('allTaggedSessions', 1), ('prepared', 1), ('publicIngress', True),
                           ('externalCredentials', True), ('historicalActive', []),
                           ('priorReceiptSha256', '0' * 64),
                           ('priorHostProofSha256', '0' * 64),
                           ('historicalIncidentEvidence', []), ('hostProofSha256', '')]:
            with self.subTest(key=key):
                changed = dict(self.observed, **{key: value})
                if key == 'imageId':
                    receipt = module.reconcile(self.active, module.INCIDENT['activeSha256'], self.observed)
                    self.assertFalse(module.valid_receipt(self.active, module.INCIDENT['activeSha256'], receipt, changed))
                else:
                    with self.assertRaises(RuntimeError):
                        module.reconcile(self.active, module.INCIDENT['activeSha256'], changed)

    def test_receipt_cannot_be_upgraded_to_normal_closure(self):
        receipt = module.reconcile(self.active, module.INCIDENT['activeSha256'], self.observed)
        for key, value in [('phase', 'QUIESCENT'), ('nativeReaped', True),
                           ('externalEffectsCompleted', True), ('productionAdmission', True),
                           ('activeSha256', 'e' * 64)]:
            with self.subTest(key=key):
                self.assertFalse(module.valid_receipt(self.active, module.INCIDENT['activeSha256'],
                                 dict(receipt, **{key: value}), self.observed))

    def test_host_and_checkpoint_proof_are_required_before_archive(self):
        for mutation in [
            lambda value: value['hostProof'].update(publicIngress=True),
            lambda value: value['hostProof'].update(oldImageId='sha256:' + '0' * 64),
            lambda value: value['hostProof'].update(priorReceiptSha256='0' * 64),
            lambda value: value['hostProof'].update(priorCheckpointManifestSha256='0' * 64),
            lambda value: value['hostProof']['database'].update(prepared=1),
            lambda value: value['hostProof']['checkpoint'].update(independentReadbackVerified=False),
            lambda value: value['hostProof']['checkpoint']['manifest']['entries'].pop(),
            lambda value: value['hostProof']['checkpoint'].update(manifestSha256='0' * 64),
            lambda value: value['historicalActive'].pop(),
        ]:
            observed = copy.deepcopy(self.observed)
            mutation(observed)
            with self.assertRaises(RuntimeError):
                module.reconcile(self.active, module.INCIDENT['activeSha256'], observed)

    def test_incident_does_not_apply_to_other_active_record(self):
        for change in [dict(namespace='sabalan-rt-' + '0' * 48),
                       dict(guardian=dict(self.active['guardian'], startTicks='83033'))]:
            with self.assertRaises(RuntimeError):
                module.reconcile(dict(self.active, **change), module.INCIDENT['activeSha256'], self.observed)


if __name__ == '__main__':
    unittest.main()
