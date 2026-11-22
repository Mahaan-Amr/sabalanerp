import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import os
import sys
import base64

source = Path(__file__).parents[2] / 'deploy/scripts/capture-coordination-history.py'

class History(unittest.TestCase):
    def module(self):
        spec = importlib.util.spec_from_file_location('history', source)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        return module

    def test_unknown_path_refused_and_configuration_is_classified(self):
        module=self.module()
        self.assertEqual(module.classification('biometric-configuration/previous.json'),'CONFIGURATION_RECOVERY')
        self.assertEqual(module.classification('pending-restore.json'),'DURABLE_RECOVERY')
        self.assertEqual(module.classification('online/native/a/state.json'),'RUNTIME_CUSTODY_ONLY')
        for name in ('unexpected.json','online/unreviewed/grant.json','../state.json'):
            with self.assertRaises(RuntimeError): module.classification(name)

    def test_local_qualification_requires_exact_original_qa_root_and_app_subtree(self):
        module=self.module();root='/app/online-runtime-acceptance/application-native-'+ 'a'*32+'/restored-coordination'
        for relative in ['private-qualifications','private-qualifications/'+'b'*64,'private-qualifications/'+'b'*64+'/restored-app/storage/contracts/original.pdf']:
            self.assertEqual(module.classification(relative,source_root=root),'LOCAL_QUALIFICATION_HISTORY')
        for relative,source_root in [('private-qualifications/'+'b'*64+'/unreviewed.json',root),('private-qualifications/not-issued/restored-app/file',root),('private-qualifications/'+'b'*64+'/restored-app/file','/app/storage/recovery-coordination')]:
            with self.assertRaises(RuntimeError):module.classification(relative,source_root=source_root)
        with self.assertRaises(RuntimeError):module.classification('private-qualifications/'+'b'*64+'/restored-app/file')

    def test_no_output_when_original_freeze_assertion_fails(self):
        spec = importlib.util.spec_from_file_location('history', source)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'intent.json').write_text('{}')
            (root/'registered-backend-boundary.json').write_text('{}')
            def refused(): raise RuntimeError('ORIGINAL_FREEZE_LOST')
            with self.assertRaisesRegex(RuntimeError, 'ORIGINAL_FREEZE_LOST'):
                module.capture(root, 'a'*64, {}, refused)
            self.assertFalse((root/'coordination-history.json').exists())

    @unittest.skipUnless(sys.platform=='linux','actual flock descriptor and no-follow semantics')
    def test_original_ex_archive_preserves_configuration_and_refuses_symlink(self):
        import fcntl
        module=self.module()
        with tempfile.TemporaryDirectory() as temporary:
            top=Path(temporary);root=top/'coordination';root.mkdir(mode=0o700)
            work=top/'output';work.mkdir(mode=0o700)
            config=root/'biometric-configuration';config.mkdir(mode=0o700)
            raw=b'{"originalEnvironment":"EXACT PRIVATE PREVIOUS VALUE"}\n'
            (config/'previous.json').write_bytes(raw);(config/'previous.json').chmod(0o600)
            lock=os.open(top/'gate',os.O_RDWR|os.O_CREAT|os.O_EXCL,0o600)
            try:
                fcntl.flock(lock,fcntl.LOCK_EX);os.dup2(lock,10)
                proof=module.capture(work,'a'*64,dict(coordinationDirectory=str(root)),lambda:None)
                history=json.loads((work/proof['file']).read_bytes())
                self.assertEqual(base64.b64decode(history['entries'][1]['rawBase64']),raw)
                self.assertFalse(history['runtimeAdmission']);self.assertTrue(history['archivalOnly'])
                (root/'state.json').symlink_to(config/'previous.json')
                with self.assertRaisesRegex(RuntimeError,'ALIAS'):
                    module.capture(work,'b'*64,dict(coordinationDirectory=str(root)),lambda:None)
            finally:
                if lock!=10:os.close(10)
                os.close(lock)

if __name__ == '__main__': unittest.main()
