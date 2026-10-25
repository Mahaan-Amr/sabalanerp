"""Actual read-only proof plus in-memory semantic negatives; no runtime actions."""
import base64
import copy
import hashlib
import importlib.util
import json
import pathlib
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
FILE = ROOT / 'scripts/lib/application-native-negative-capsule-baseline.policy.py'
loader = importlib.util.spec_from_file_location('negative_capsule_policy_test', FILE)
module = importlib.util.module_from_spec(loader)
loader.loader.exec_module(module)
policy = module._bootstrap_policy()


def read(ref):
    raw = pathlib.Path(ref['file']).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == ref['sha256']
    return json.loads(raw)


HANDOFF = read({'file': str(module.ACTUAL / 'handoff.json'), 'sha256': module.HANDOFF_SHA})
BASELINE, RESTORATION = read(HANDOFF['baselineRef']), read(HANDOFF['restorationRef'])
CONTEXT = read(HANDOFF['contextRef'])


class MutantReader(policy.Reader):
    """Test-only semantic mutation after real hash-checked reads, never evidence."""
    def __init__(self, selected, mutate):
        super().__init__()
        self.selected, self.mutate = selected, mutate

    def json(self, ref):
        value = copy.deepcopy(super().json(ref))
        if ref == self.selected:
            self.mutate(value)
        return value


class TypedProofTests(unittest.TestCase):
    def test_actual_full_graph_keeps_both_failures_negative(self):
        result = module.validate_handoff(str(module.ACTUAL / 'handoff.json'), module.HANDOFF_SHA)
        self.assertEqual(result['format'], module.FORMAT)
        self.assertFalse(result['qualificationSucceeded'])
        self.assertFalse(result['productionAdmission'])
        self.assertFalse(result['adoptsOriginalPopen'])
        self.assertFalse(result['acceptance']['physicalEmpty'])
        self.assertEqual(result['acceptance']['actorEntries'], [])
        self.assertEqual(result['acceptance']['subpath'], module.SUBPATH)
        self.assertEqual(len(result['streamingInputs']), 4)
        self.assertLess(len(json.dumps(result).encode()), 2 * 1024**2)
        self.assertEqual(len(result['protectedEight']), 8)

    def test_unknown_handoff_digest_has_no_authority(self):
        with self.assertRaises(AssertionError):
            module.validate_handoff(str(module.ACTUAL / 'handoff.json'), '0' * 64)

    def test_optimized_python_refuses_before_any_evidence_read(self):
        program = """import importlib.util,sys
loader=importlib.util.spec_from_file_location('optimized_typed_policy',sys.argv[1])
module=importlib.util.module_from_spec(loader);loader.loader.exec_module(module)
try:module.validate_handoff('NOT_AN_EVIDENCE_PATH','0'*64)
except RuntimeError as error:assert str(error)=='NONOPTIMIZED_TYPED_VERIFIER_REQUIRED'
else:raise RuntimeError('OPTIMIZED_VERIFIER_WAS_ACCEPTED')
"""
        result = subprocess.run([sys.executable, '-I', '-B', '-O', '-c', program, str(FILE)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_actual_eighty_closed_originals(self):
        rows = module._inventories(policy, policy.Reader(), BASELINE, RESTORATION)
        self.assertEqual(len(rows), 80)
        self.assertEqual(len({row[3]['originalPid'] for row in rows}), 80)

    def test_current_child_semantic_mutations_refuse(self):
        inventory = read(BASELINE['originalChildrenRef'])
        ref = inventory['children'][0]['ref']
        mutations = {
            'failed': lambda value: value.update(code=1),
            'false-code': lambda value: value.update(code=False),
            'stdout-open': lambda value: value.update(stdoutEof=False),
            'stderr-missing': lambda value: value.pop('stderrEof'),
            'fault': lambda value: value.update(observationFault='KeyboardInterrupt'),
            'interrupted': lambda value: value.update(interrupted=True),
            'foreign-argv': lambda value: value['argv'].__setitem__(0, 'foreign-command'),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name), self.assertRaises((AssertionError, KeyError)):
                module._inventories(policy, MutantReader(ref, mutate), BASELINE, RESTORATION)

    def test_inventory_missing_or_duplicated_child_refuses(self):
        for mutate in (lambda value: value['children'].pop(),
                       lambda value: value['children'].__setitem__(1, value['children'][0])):
            with self.assertRaises(AssertionError):
                module._inventories(policy, MutantReader(BASELINE['originalChildrenRef'], mutate), BASELINE, RESTORATION)

    def test_acceptance_metadata_cannot_launder_empty_or_unknown_entries(self):
        module._acceptance_header(policy, BASELINE['acceptance'])
        mutations = {
            'fake-empty': lambda value: value.update(physicalEmpty=True),
            'actor-entry': lambda value: value.update(actorEntries=['foreign']),
            'wrong-subpath': lambda value: value.update(subpath='c16-recovery-' + module.NONCE),
            'missing-capsule-role': lambda value: value['canonicalCapsuleRefs'].pop('backend-retained'),
            'missing-current-role': lambda value: value['currentViewRefs'].pop('backend-candidate'),
            'legacy-empty-field': lambda value: value.update(empty=True),
        }
        for name, mutate in mutations.items():
            value = copy.deepcopy(BASELINE['acceptance'])
            mutate(value)
            with self.subTest(name=name), self.assertRaises(AssertionError):
                module._acceptance_header(policy, value)

    def test_full_actual_capsule_and_semantic_mutations(self):
        ref = BASELINE['acceptance']['canonicalCapsuleRefs']['backend-candidate']
        row = read(ref)
        payload = json.loads(base64.b64decode(row['inputBase64']))
        source, spec = base64.b64decode(payload['sourceBase64']), payload['spec']
        cid = BASELINE['freshConfigurations']['backend-candidate']['id']
        result = module._capsule(policy, policy.Reader(), ref, source, spec, cid)
        self.assertEqual(len(result['lockIdentities']), 3)
        mutations = {
            'writable': lambda value: value.update(readOnly=False),
            'one-capsule': lambda value: value.update(capsulesVerified=1),
            'database': lambda value: value.update(databaseExecuted=True),
            'native-actor': lambda value: value.update(nativeActorStarted=True),
            'admission': lambda value: value.update(productionAdmission=True),
            'prisma-inventory': lambda value: value['prisma'].update(files=-1),
            'inquiry-inventory': lambda value: value['inquiry'].update(entries=-1),
            'missing-lock': lambda value: value['lockIdentities'].pop(),
            'lock-alias': lambda value: value['lockIdentities'][0]['identity'].__setitem__(7, 2),
            'lock-owner': lambda value: value['lockIdentities'][0]['identity'].__setitem__(6, 1),
            'inventory-failed': lambda value: value['inventoryChild'].update(code=1),
            'inventory-stdout-open': lambda value: value['inventoryChild'].update(stdoutEof=False),
            'inventory-stderr-missing': lambda value: value['inventoryChild'].pop('stderrEof'),
        }
        for name, mutate in mutations.items():
            def mutate_output(value):
                output = json.loads(base64.b64decode(value['stdoutBase64']))
                mutate(output)
                raw = json.dumps(output).encode()
                value['stdoutBase64'] = base64.b64encode(raw).decode()
                value['stdoutSha256'] = hashlib.sha256(raw).hexdigest()
            with self.subTest(name=name), self.assertRaises((AssertionError, KeyError)):
                module._capsule(policy, MutantReader(ref, mutate_output), ref, source, spec, cid)

    def test_environment_and_bind_order_only_is_not_a_configuration_waiver(self):
        cancellation = read(HANDOFF['cancellationRef'])
        old, _ = policy.inspect_child(policy.Reader(), cancellation['evidenceRefs']['initialInspection'])
        fresh, _ = policy.inspect_child(policy.Reader(), read(HANDOFF['historicalFailedPrefixRef'])['freshInspectionRef'])
        choose = lambda values: {value['Config']['Labels']['com.docker.compose.service']: value
                                 for value in values if value['Config']['Labels']['com.docker.compose.service'] in policy.ROLES}
        before, after = choose(old), choose(fresh)
        module._fresh_engine(policy, before, after)
        mutations = {
            'env-value': lambda value: value['Config']['Env'].__setitem__(0, 'SYNTHETIC_FOREIGN_KEY=1'),
            'duplicate-env': lambda value: value['Config']['Env'].append(value['Config']['Env'][0]),
            'missing-bind': lambda value: value['HostConfig']['Binds'].pop(),
            'duplicate-bind': lambda value: value['HostConfig']['Binds'].append(value['HostConfig']['Binds'][0]),
            'memory-change': lambda value: value['HostConfig'].update(Memory=1),
            'image-change': lambda value: value.update(Image='sha256:' + '0' * 64),
        }
        for name, mutate in mutations.items():
            value = copy.deepcopy(after)
            mutate(value['backend-candidate'])
            with self.subTest(name=name), self.assertRaises(AssertionError):
                module._fresh_engine(policy, before, value)


if __name__ == '__main__':
    unittest.main()
