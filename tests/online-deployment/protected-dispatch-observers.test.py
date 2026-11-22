import importlib.util
from pathlib import Path
import sys
import unittest
import os
import tempfile
from unittest.mock import patch

source=Path(__file__).resolve().parents[2]/'deploy/scripts/protected-dispatch-root-prepare.py'


def module():
    spec=importlib.util.spec_from_file_location('owned_dispatch_observers',source)
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result


class OriginalObserverTests(unittest.TestCase):
    def test_private_qa_compose_is_selected_only_by_validated_plan(self):
        owner=module()
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            base=root/'docker-compose.rehearsal.yml';base.touch()
            env=root/'qa.env';env.touch()
            plan=root/'plan.json';plan.touch()
            selector=root/'qa-rehearsal-target.mjs'
            settings={'DEPLOYMENT_QA_REHEARSAL_PLAN_FILE':str(plan),
                      'DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256':'a'*64}
            with patch.object(owner,'__file__',str(root/'protected-dispatch-root-prepare.py')), \
                    patch.object(owner,'observed',return_value=b'docker-compose.rehearsal.yml\n') as observed:
                with patch.dict(os.environ,settings,clear=True):
                    owner.validate_compose(base,env)
                observed.assert_called_once_with(['node',str(selector),str(plan),'a'*64,str(root),str(env)])
                for bad in [{},{'DEPLOYMENT_QA_REHEARSAL_PLAN_FILE':str(plan)},
                            {'DEPLOYMENT_QA_REHEARSAL_PLAN_FILE':str(plan),
                             'DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256':'bad'}]:
                    observed.reset_mock()
                    with patch.dict(os.environ,bad,clear=True),self.assertRaises(RuntimeError):
                        owner.validate_compose(base,env)
                    observed.assert_not_called()
                with patch.dict(os.environ,settings,clear=True), \
                        patch.object(owner,'observed',return_value=b'docker-compose.prod.yml\n'):
                    with self.assertRaises(RuntimeError):owner.validate_compose(base,env)

    def test_actual_original_child_closes_before_nonzero_is_rejected(self):
        owner=module()
        with self.assertRaisesRegex(RuntimeError,'PROTECTED_DISPATCH_ROOT_UNPROVEN'):
            owner.observed([sys.executable,'-c',"import sys;sys.stderr.write('failure');sys.exit(7)"])
        self.assertEqual(len(owner.original_children),1)
        original=owner.original_children[0]
        self.assertTrue(original['closed']);self.assertEqual(original['code'],7)
        self.assertEqual(original['child'].poll(),7)
        self.assertTrue(all(not thread.is_alive() for thread in original['threads']))

    def test_oversized_actual_pipe_output_is_drained_and_bounded_without_kill(self):
        owner=module()
        with self.assertRaisesRegex(RuntimeError,'PROTECTED_DISPATCH_ROOT_UNPROVEN'):
            owner.observed([sys.executable,'-c',"import sys;sys.stdout.buffer.write(b'x'*(8*1024*1024+65536));sys.stdout.flush()"])
        original=owner.original_children[0]
        self.assertTrue(original['closed']);self.assertEqual(original['code'],0);self.assertTrue(original['overflow'])
        self.assertLessEqual(sum(map(len,original['stdout']+original['stderr'])),8*1024**2)
        self.assertTrue(all(not thread.is_alive() for thread in original['threads']))


if __name__=='__main__':unittest.main()
