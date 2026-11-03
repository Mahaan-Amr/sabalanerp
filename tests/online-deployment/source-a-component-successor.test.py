"""Bounded publisher-input tests against retained public Inquiry receipts.

These tests read receipt JSON, never payloads, keys, SSH or Docker. Mutants are
explicit data models; they cannot create a published component.
"""
import copy
import hashlib
import json
import pathlib
import runpy
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
API = runpy.run_path(str(ROOT / 'scripts/lib/source-a-component-successor.py'))
Q = pathlib.Path('D:/sabalanerp-online-qa')
PINS = {
    'encryption': ('C30-source-a-existing-inquiry-encrypt-existing-0832191af9264aff8e8dd96b453f456e/phase-complete.json', 'a693fc4e8cd5dfc3a6a746a30dda4a66fdd797422bd08eb52ff1fb057c5a6ddf'),
    'local': ('C30-source-a-existing-inquiry-local-decrypt-d6464b3d2cd24f988a99a8705966d26b/phase-complete.json', '421c693a89049303fabf8f8afbd156a8fd9265e86a3be7dad46708d57ee74a8a'),
    'independent': ('C30-source-a-existing-independent-runtime-inquiry-c9e4d833db654dc8832d84bbdb927407/verification-complete.json', 'a926f703eb4663409c0d08e791627d428a53bdacb772f52f9d2ee66267976e30'),
}


def inputs():
    values, refs = {}, {}
    for key, (name, digest) in PINS.items():
        path = Q / name
        raw = path.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == digest
        values[key] = json.loads(raw)
        refs[key] = {'file': str(path), 'sha256': digest}
    return values, refs


class SuccessorTests(unittest.TestCase):
    def test_optimized_python_refuses_publication_before_reading_inputs(self):
        module = str(ROOT / 'scripts/lib/source-a-component-successor.py')
        code = 'import runpy; api=runpy.run_path(' + repr(module) + "); api['publish_component']({}, 'NO_OUTPUT_MAY_BE_CREATED')"
        child = subprocess.run([sys.executable, '-I', '-B', '-O', '-c', code], capture_output=True)
        self.assertNotEqual(child.returncode, 0)
        self.assertIn(b'OPTIMIZED_PYTHON_CANNOT_PUBLISH_SOURCE_A_COMPONENTS', child.stderr)
        self.assertEqual(child.stdout, b'')

    def test_inquiry_three_legs_join_without_repeating_crypto(self):
        values, refs = inputs()
        plan = API['compile_publication_plan'](values, refs)
        self.assertEqual(plan['service'], 'inquiry')
        self.assertEqual(plan['retrieval']['gzip']['bytes'], 379560615)
        self.assertEqual(plan['retrieval']['rawTar']['bytes'], 381032960)
        self.assertEqual(plan['staging']['allHeldBytes'], 1140155330)
        self.assertEqual(plan['requiredBeforePublication'], 'held-file-sha256-readback')
        for key in ['productionAdmission', 'healthyApplicationPoint', 'publicOnlineAdmission', 'published']:
            self.assertIs(plan[key], False)

    def test_wrong_join_or_unclosed_original_refuses(self):
        mutants = [
            lambda v: v['independent'].update(localPhase={'file': 'foreign', 'sha256': '0' * 64}),
            lambda v: v['independent']['verifyOriginal'].update(stdoutEof=False),
            lambda v: v['independent']['remoteOriginalClosure']['children'][0].update(code=1),
            lambda v: v['independent']['native'].update(privateRsaExported=True),
            lambda v: v['independent']['native'].update(header={}),
            lambda v: v['local']['canonicalLocalArchiveValidation']['raw'].update(sha256='0' * 64),
            lambda v: v['local']['canonicalLocalArchiveValidation']['archiveGraph'].update(config='sha256:' + '0' * 64),
            lambda v: v['local']['remote']['native']['result'].update(gcmAuthenticated=False),
            lambda v: v['encryption'].update(productionAdmission=True),
            lambda v: v['local'].update(regzipped=True),
        ]
        for mutate in mutants:
            values, refs = inputs()
            mutate(values)
            with self.subTest(mutation=mutants.index(mutate)):
                with self.assertRaises((AssertionError, ValueError)):
                    API['compile_publication_plan'](values, refs)

    def test_actual_material_and_saved_original_joins(self):
        _, refs = inputs()
        plan = API['prepare_publication_plan'](refs)
        self.assertIs(plan['sourceMaterialOriginalJoinsVerified'], True)
        self.assertEqual(set(plan['materialReferences']), {'encryption', 'local', 'independent'})
        self.assertIs(plan['published'], False)

    def test_publication_cannot_overwrite_preserved_backend_component(self):
        _, refs = inputs()
        with self.assertRaises(AssertionError):
            API['publish_component'](refs, Q / 'C30-source-a-image-component-fb363c57d1aa4a38ac62a13dce5f48b3')

    def test_actual_frontend_local_proof_passes_existing_rsa_projection(self):
        encryption = {'file': str(Q / 'C30-source-a-frontend-encryption-component-c0739bb539e448e38400c4ab405b9e8c/component.json'),
                      'sha256': 'f4e29e91de9f73ece3de1468fb6bba90feddb3d3a9dce5bffbdd9b016b93334d'}
        local = {'file': str(Q / 'C30-source-a-existing-frontend-local-decrypt-12e5b79197d94648a550c43cf8d287a1/phase-complete.json'),
                 'sha256': 'be663dc1cf9f014e79d9a3513434570504d6e51cdfd78b848d3aad6a51ccd427'}
        component = API['fixed_module']('components.py')['select']('frontend')
        expected, cipher = API['fixed_module']('prepare-independent.py')['validated_inputs'](encryption, local, 'frontend', component)
        self.assertEqual(expected['plainBytes'], 269927919)
        self.assertEqual(cipher['sha256'], '3ebbeafe68d57788847b10fc5d75176235f3ee48324ea9fd67b4a138517b93d3')

    def test_frontend_model_keeps_failed_parent_negative(self):
        # Future local/RSA bodies below are EXPLICIT DATA MODELS, never saved
        # native receipts. Only the published encryption component is actual.
        values, refs = inputs()
        front = API['read_receipt']({
            'file': str(Q / 'C30-source-a-frontend-encryption-component-c0739bb539e448e38400c4ab405b9e8c/component.json'),
            'sha256': 'f4e29e91de9f73ece3de1468fb6bba90feddb3d3a9dce5bffbdd9b016b93334d',
        })
        values['encryption'] = front
        refs = {name: {'file': 'EXPLICIT_DATA_MODEL_' + name, 'sha256': '0' * 64}
                for name in ['encryption', 'local', 'independent']}
        local = values['local']
        local.update(service='frontend', component=copy.deepcopy(front['component']), encryptionPhase=refs['encryption'])
        local['reusedPlaintextRef'] = front['component']['gzip']
        local['remote'].update(image=front['component']['image'], rootfsDiffIds=front['component']['rootfsDiffIds'])
        local['remote']['native']['result'] = {**front['native']['result'], 'gcmAuthenticated': True}
        local['canonicalLocalArchiveValidation'].update(compressed=front['component']['gzip'], raw=front['component']['raw'], archiveGraph=front['component']['archiveGraph'])
        independent = values['independent']
        independent.update(service='frontend', component=copy.deepcopy(front['component']), encryptionPhase=refs['encryption'], localPhase=refs['local'])
        independent['native'].update(front['native']['result'])
        independent['native']['image'] = front['component']['image']
        plan = API['compile_publication_plan'](values, refs)
        self.assertEqual(plan['service'], 'frontend')
        self.assertIs(plan['negativeParentQualified'], False)
        self.assertIs(plan['published'], False)
        front['fullOuterPhaseSucceeded'] = True
        with self.assertRaises(AssertionError):
            API['compile_publication_plan'](values, refs)


if __name__ == '__main__':
    unittest.main()
