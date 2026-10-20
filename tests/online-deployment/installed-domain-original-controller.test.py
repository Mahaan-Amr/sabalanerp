"""Real small original-child checks; these are not native business qualification."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('domain_owner',Path(__file__).with_name('application-native-candidate-controller.fixture.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class OriginalDomainObserverTests(unittest.TestCase):
    def owner(self):
        owner=object.__new__(module.CandidateOwner)
        owner.grant=lambda kind: {'exact':kind}
        owner.sql_closure=lambda grant,namespace: dict(visible=True,sessions=0,prepared=0)
        return owner

    def test_foreign_target_input_is_refused_before_child_creation(self):
        owner=self.owner()
        with self.assertRaisesRegex(RuntimeError,'PRIVATE_DOMAIN_INPUT_INVALID'):
            owner.private_domain({'input':{'origin':'http://foreign.invalid'}})

    def test_private_browser_rejects_caller_endpoint_before_any_helper(self):
        owner=self.owner()
        with self.assertRaisesRegex(RuntimeError,'PRIVATE_BROWSER_INPUT_INVALID'):
            owner.start_chrome({'input':{'endpoint':'ws://foreign.invalid'}},True)

    def test_private_browser_close_cannot_select_another_original(self):
        owner=self.owner();owner.completed={'restored-http'}
        owner.actors={'private-chrome':dict(id='a'*64,closed=False)}
        with self.assertRaisesRegex(RuntimeError,'PRIVATE_BROWSER_CLOSE_OWNER_CHANGED'):
            owner.close_chrome({'input':{'actorId':'b'*64}},True)
        self.assertFalse(owner.actors['private-chrome']['closed'])

    def test_actual_legacy_browser_refuses_caller_endpoint_and_early_start(self):
        owner=self.owner()
        with self.assertRaisesRegex(RuntimeError,'PRIVATE_BROWSER_INPUT_INVALID'):
            owner.start_chrome({'input':{'endpoint':'ws://foreign.invalid'}},legacy=True)
        owner.completed={'migration','private-chrome'};owner.actors={'private-http2':{}}
        with self.assertRaisesRegex(RuntimeError,'PRIVATE_BROWSER_ORDER_INVALID'):
            owner.start_chrome({'input':{}},legacy=True)

    def test_actual_legacy_chrome_cannot_wait_another_browser_handle(self):
        owner=self.owner();owner.completed=set()
        owner.actors={'legacy-private-chrome':dict(id='a'*64,closed=False),'private-chrome':dict(id='b'*64,closed=True)}
        with self.assertRaisesRegex(RuntimeError,'PRIVATE_BROWSER_CLOSE_OWNER_CHANGED'):
            owner.close_chrome({'input':{'actorId':'b'*64}},legacy=True)
        self.assertFalse(owner.actors['legacy-private-chrome']['closed'])

    def test_actual_legacy_sql_verifier_refuses_external_proof_before_read_or_child(self):
        owner=self.owner();owner.completed={'private-jobs','private-http2','private-chrome','private-browser-verify','legacy-private-chrome'}
        owner.root=Path('/app/online-runtime-acceptance/application-native-'+'a'*32)
        owner.qualification_root=lambda:Path('/owned/app')
        with self.assertRaisesRegex(RuntimeError,'BROWSER_TICKETS_INPUT_CHANGED'):
            owner.private_browser_verify({'input':{'proofPath':'/foreign/proof','proofSha256':'c'*64}},legacy=True)

    def test_actual_original_nonzero_child_is_known_closed_without_native_claim(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/'stdout';output.write_bytes(b'')
            child=subprocess.Popen([sys.executable,'-c','raise SystemExit(7)'],stdin=subprocess.DEVNULL)
            value=dict(actor=child,birth={'actualPid':child.pid},pumps=[],output=output,closed=False,
                observerNamespace='sabalan-rt-'+'a'*48,before={})
            child.wait(timeout=10)
            owner=self.owner()
            # resource() is Linux-only; closure below records its observation.
            original=module.resource;module.resource=lambda: {'actualTestObserver':True}
            try:result,closure=owner.private_domain_closed(value)
            finally:module.resource=original
            self.assertIsNone(result);self.assertTrue(value['closed'])
            self.assertEqual(closure['originalPopenPid'],child.pid)
            self.assertEqual(closure['originalReturncode'],7)
            self.assertIsNone(closure['nativeRawBase64']);self.assertIsNone(closure['scopeSha256'])

    def test_sql_uncertainty_cannot_mark_original_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/'stdout';output.write_bytes(json.dumps({'observed':True}).encode())
            child=subprocess.Popen([sys.executable,'-c','pass'],stdin=subprocess.DEVNULL);child.wait(timeout=10)
            value=dict(actor=child,pumps=[],output=output,closed=False,observerNamespace='sabalan-rt-'+'a'*48)
            owner=self.owner()
            def unknown(*args):raise RuntimeError('SQL_UNKNOWN')
            owner.sql_closure=unknown
            with self.assertRaisesRegex(RuntimeError,'SQL_UNKNOWN'):owner.private_domain_closed(value)
            self.assertFalse(value['closed'])

if __name__=='__main__':unittest.main()
