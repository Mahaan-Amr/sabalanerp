"""The local reboot exception never asserts graceful native completion."""
import importlib.util
from pathlib import Path
import unittest


SOURCE = Path(__file__).resolve().parents[2] / 'deploy/scripts/local-native-reboot.py'
spec = importlib.util.spec_from_file_location('local_native_reboot', SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LocalNativeRebootPolicy(unittest.TestCase):
    def setUp(self):
        self.active = dict(format='sabalan-runtime-native/v1', phase='ACTIVE', role='standalone',
                           instanceId=module.INCIDENT['namespace'][11:], namespace=module.INCIDENT['namespace'],
                           clusterIdentifier='7703877635514671138',
                           initialDatabase=dict(name='sabalanerp', oid='57567'),
                           guardian=dict(pid=1, bootId=module.INCIDENT['oldBootId'],
                                         pidNamespace=module.INCIDENT['pidNamespace'], startTicks='83032'))
        self.observed = dict(project='sabalanerp-local', nodeEnv='development', role='standalone',
                             imageId='sha256:' + 'b' * 64, bootId=module.INCIDENT['newBootId'],
                             systemIdentifier='7703877635514671138', databaseOid='57567',
                             oldSessions=0, allTaggedSessions=0, prepared=0,
                             publicIngress=False, externalCredentials=False,
                             historicalActive=[dict(name='deployment-runtime-native.preserved-' + format(i, '064x') + '.json',
                                                    sha256=format(i, '064x')) for i in range(1, 8)],
                             historicalIncidentEvidence=[
                                 dict(name='local-forced-recovery-incident-a.json', sha256='a' * 64),
                                 dict(name='local-reboot-incident-b.json', sha256='b' * 64)])

    def test_exact_local_reboot_produces_truthful_exception(self):
        receipt = module.reconcile(self.active, module.INCIDENT['activeSha256'], self.observed)
        self.assertEqual(receipt['phase'], 'ABANDONED_ON_VM_REBOOT')
        self.assertIs(receipt['nativeReaped'], False)
        self.assertIs(receipt['externalEffectsCompleted'], False)
        self.assertIs(receipt['productionAdmission'], False)
        self.assertEqual(receipt['activeSha256'], module.INCIDENT['activeSha256'])
        self.assertTrue(module.valid_receipt(self.active, module.INCIDENT['activeSha256'], receipt, self.observed))

    def test_changed_or_unproven_facts_fail_closed(self):
        for key, value in [('project', 'sabalanerp'), ('nodeEnv', 'production'), ('role', 'control'),
                           ('imageId', 'sha256:' + 'e' * 64), ('bootId', module.INCIDENT['oldBootId']),
                           ('systemIdentifier', '1'), ('databaseOid', '1'), ('oldSessions', 1),
                           ('allTaggedSessions', 1), ('prepared', 1), ('publicIngress', True),
                           ('externalCredentials', True), ('historicalActive', []),
                           ('historicalIncidentEvidence', [])]:
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


if __name__ == '__main__':
    unittest.main()
