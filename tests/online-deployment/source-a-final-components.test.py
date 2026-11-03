"""Acceptance over the actual final component and finite native receipts.

Reads bounded public evidence only. Successful crypto and payload readbacks are
not repeated. These tests are not release or healthy-point admission.
"""
import hashlib
import json
import pathlib
import runpy
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
Q = pathlib.Path('D:/sabalanerp-online-qa')
API = runpy.run_path(str(ROOT / 'scripts/lib/source-a-component-successor.py'))
COMPONENTS = {
    'inquiry': ('C30-source-a-image-component-45d688378778428f8e5b823f83ce7e2b/component.json',
                '64eea77f6820ab385c4fca9122a9ceb669ae45bac37226922574b335da1ffa7f'),
    'frontend': ('C30-source-a-image-component-5d9006d6129f4c7b9a0095ac7d36080f/component.json',
                 '81f322d0986716fccf3b880f1ec047d5dbe10df6c7cb01985bb2798c47b39bcf'),
}


class Tests(unittest.TestCase):
    def test_actual_final_components_join_all_three_native_legs(self):
        for service, (name, digest) in COMPONENTS.items():
            with self.subTest(service=service):
                value = API['read_receipt']({'file': str(Q / name), 'sha256': digest})
                self.assertEqual(value['format'], 'sabalan-source-a-closed-stream-image-component/v1')
                self.assertEqual(value['service'], service)
                plan = API['prepare_publication_plan'](value['closedPhaseReferences'])
                self.assertEqual(value['archiveGraph'], plan['archiveGraph'])
                self.assertEqual(value['materialReferences'], plan['materialReferences'])
                self.assertEqual(value['cipher'], plan['retrieval']['ciphertext'])
                self.assertEqual(value['compressedArchive'], plan['retrieval']['gzip'])
                self.assertEqual(value['rawArchive'], plan['retrieval']['rawTar'])
                for key in ['published', 'localDecryptVerified', 'independentDecryptVerified',
                            'allOriginalChildrenClosed', 'temporaryCredentialRetired']:
                    self.assertIs(value[key], True)
                for key in ['negativeParentQualified', 'healthyApplicationPoint',
                            'publicOnlineAdmission', 'productionAdmission']:
                    self.assertIs(value[key], False)
                for kind, expected in plan['retrieval'].items():
                    held = value['heldFileReadbacks'][kind]
                    self.assertEqual({k: held[k] for k in ['file', 'bytes', 'sha256']}, expected)
                    self.assertIs(held['fullSha256Verified'], True)
                    self.assertEqual(held['heldDescriptorIdentity'][1], expected['bytes'])
                self.assertEqual(API['read_receipt'](value['rawArchiveReceipt']), value['archiveGraph'])

    def test_successful_backend_and_failed_frontend_parent_remain_unchanged(self):
        backend = Q / 'C30-source-a-image-component-fb363c57d1aa4a38ac62a13dce5f48b3/component.json'
        self.assertEqual(hashlib.sha256(backend.read_bytes()).hexdigest(),
                         '7fb723d1e34c72ac849ade73a89506e61acf5a8716513a50952328ab4f69c26b')
        encryption = API['read_receipt']({
            'file': str(Q / 'C30-source-a-frontend-encryption-component-c0739bb539e448e38400c4ab405b9e8c/component.json'),
            'sha256': 'f4e29e91de9f73ece3de1468fb6bba90feddb3d3a9dce5bffbdd9b016b93334d',
        })
        self.assertIs(encryption['negativeParentQualified'], False)
        self.assertIs(encryption['fullOuterPhaseSucceeded'], False)
        negative = API['read_receipt'](encryption['negativeParentReferences']['phase-negative.json'])
        self.assertEqual(negative['format'], 'sabalan-source-a-stream-phase-negative/v1')
        self.assertIs(negative['productionAdmission'], False)

    def test_actual_frontend_independent_evidence_keeps_private_rsa_remote(self):
        value = API['read_receipt']({
            'file': str(Q / 'C30-source-a-existing-independent-runtime-frontend-9fd8e6b3abb34a9d872cfe63b8fa3e41/verification-complete.json'),
            'sha256': 'e1e03fa49b64f984074ecd3a9104a7c7f2636883cb745eab2874522d4a15a0c1',
        })
        self.assertIs(value['independentDecryptVerified'], True)
        self.assertIs(value['allOriginalChildrenClosed'], True)
        for key in ['privateRsaExported', 'plaintextPersisted', 'cipherPersisted', 'productionAdmission']:
            self.assertIs(value['native'][key], False)
        for ref in value['originalClosures']:
            API['original'](API['read_receipt'](ref))


if __name__ == '__main__':
    unittest.main()
