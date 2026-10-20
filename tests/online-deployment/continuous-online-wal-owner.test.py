import base64
import copy
import datetime
import importlib.util
from pathlib import Path
import unittest
import os
import sys
import tempfile
from types import SimpleNamespace

FILE = Path(__file__).resolve().parents[2]/'deploy/scripts/continuous-online-wal-owner.py'
spec = importlib.util.spec_from_file_location('continuous_online_wal_owner', FILE)
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)


class CertificateTests(unittest.TestCase):
    def fixture(self):
        request = dict(format='sabalan-original-wal-window-verification-request/v1', sequence=1,
            challenge='a'*64, deploymentId='deployment_123456', releaseId='release_123456',
            windowSha256='b'*64, sourceIdentity=dict(systemIdentifier='123456',timeline=1),
            objects=[dict(name='000000010000000000000001.sabrec',bytes=16778000,sha256='c'*64)])
        decision = dict(format='sabalan-original-wal-window-verification/v1',requestSha256=module.sha(module.canonical(request)),
            challenge=request['challenge'],independentTokenSha256='d'*64,windowSha256=request['windowSha256'],
            sourceIdentity=request['sourceIdentity'],objects=request['objects'],issuedAt='2026-10-20T01:00:00Z',expiresAt='2026-10-20T01:05:00Z')
        envelope = dict(format='sabalan-signed-original-wal-window-verification/v1',decision=decision,signature=base64.b64encode(bytes(64)).decode())
        return request,envelope

    def test_structural_binding_is_distinct_from_actual_signature_authority(self):
        request,envelope=self.fixture()
        raw,signature=module.validate_window_certificate(request,envelope,module.date('2026-10-20T01:01:00Z'))
        self.assertEqual(raw,module.DOMAIN+module.canonical(envelope['decision']))
        self.assertEqual(len(signature),64)  # The runtime additionally invokes original openssl -verify.

    def test_cross_release_challenge_cipher_and_source_substitution_refuse(self):
        request,envelope=self.fixture()
        for field,value in [('challenge','f'*64),('releaseId','another_release'),('windowSha256','e'*64),
                            ('sourceIdentity',dict(systemIdentifier='other',timeline=1)),('objects',[])]:
            changed=copy.deepcopy(request);changed[field]=value
            with self.assertRaises(RuntimeError):module.validate_window_certificate(changed,envelope,module.date('2026-10-20T01:01:00Z'))

    def test_expired_overlong_future_and_invented_certificate_fields_refuse(self):
        request,envelope=self.fixture()
        for change,now in [(dict(expiresAt='2026-10-20T01:30:00Z'),'2026-10-20T01:01:00Z'),
                           ({},'2026-10-20T01:05:00Z'),({},'2026-10-20T00:58:00Z'),
                           (dict(remoteVerified=True),'2026-10-20T01:01:00Z')]:
            changed=copy.deepcopy(envelope);changed['decision'].update(change)
            with self.assertRaises(RuntimeError):module.validate_window_certificate(request,changed,module.date(now))


class ChainTests(unittest.TestCase):
    def test_actual_full_segment_overlap_is_contiguous_but_missing_segment_or_cluster_is_not(self):
        source=dict(databaseName='db',databaseOid='42',systemIdentifier='123',timeline=1,segmentBytes=16777216)
        windows=[dict(source=source,startLsn='0/1000001',endLsn='0/9000000'),
                 dict(source=source,startLsn='0/8000001',endLsn='0/10000000')]
        self.assertEqual(module.assert_window_chain(windows,source,'0/F000000'),0x10000000)
        for edit in [lambda v:v[1].update(startLsn='0/A000001'),
                     lambda v:v[1].update(source={**source,'systemIdentifier':'999'}),
                     lambda v:v[1].update(endLsn='0/8000000')]:
            changed=copy.deepcopy(windows);edit(changed)
            with self.assertRaises(RuntimeError):module.assert_window_chain(changed,source)


@unittest.skipUnless(sys.platform=='linux','actual Linux descriptor and immutable registry semantics')
class RegistryTests(unittest.TestCase):
    def prepare(self, root):
        helper_file=FILE.with_name('online-checkpoint-producer.py')
        spec=importlib.util.spec_from_file_location('original_producer_registry_fixture',helper_file)
        helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
        owner=object.__new__(module.OriginalOnlineWalCoverage)
        owner.h=helper;owner.state_file=root/'continuous-wal-state.json';owner.state_raw=None
        owner.owner=dict(pid=os.getpid(),startTicks='1',bootId='11111111-1111-1111-1111-111111111111',pidNamespace='pid:[1]')
        owner.windows=[];owner.closed=[]
        owner.p=SimpleNamespace(root=root,ownership=lambda:None,config=dict(captureId='a'*64,
            lease=dict(deploymentId='deployment_123456',releaseId='release_123456'),database=dict(name='fixture',systemIdentifier='123')))
        return owner

    def test_opening_is_private_and_atomic_transition_refuses_external_replacement(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);root.chmod(0o700);owner=self.prepare(root)
            owner._state('OPENING');first=owner.state_file.stat()
            self.assertEqual(first.st_mode&0o777,0o400)
            owner._state('ACTIVE');self.assertNotEqual(first.st_ino,owner.state_file.stat().st_ino)
            self.assertEqual(module.json.loads(owner.state_file.read_bytes())['phase'],'ACTIVE')
            replacement=root/'foreign';replacement.write_bytes(b'{"phase":"COMPLETE"}');replacement.chmod(0o400)
            os.replace(replacement,owner.state_file)
            with self.assertRaisesRegex(RuntimeError,'REGISTRY_CHANGED'):owner._state('COMPLETE')
            self.assertEqual(owner.state_file.read_bytes(),b'{"phase":"COMPLETE"}')

    def test_existing_unknown_or_alias_never_gets_overwritten_or_adopted(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);root.chmod(0o700);owner=self.prepare(root)
            original=b'{"phase":"UNKNOWN"}';owner.state_file.write_bytes(original);owner.state_file.chmod(0o400)
            with self.assertRaisesRegex(RuntimeError,'PRIOR_REGISTRY_REQUIRES_RECOVERY'):owner._state('OPENING')
            self.assertEqual(owner.state_file.read_bytes(),original)
            owner.state_file.unlink();owner.state_file.symlink_to('/dev/null')
            with self.assertRaisesRegex(RuntimeError,'PRIOR_REGISTRY_REQUIRES_RECOVERY'):owner._state('OPENING')


if __name__=='__main__':unittest.main()
