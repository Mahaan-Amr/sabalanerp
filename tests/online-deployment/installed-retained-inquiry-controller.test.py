import importlib.util
from pathlib import Path
import unittest

class Input(unittest.TestCase):
    def test_unmeasured_or_reused_inquiry_pair_is_refused(self):
        file=Path(__file__).with_name('installed-retained-inquiry-controller.fixture.py')
        spec=importlib.util.spec_from_file_location('inquiry_pair',file)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        actor=dict(containerId='a'*64,image='sha256:'+'b'*64,startedAt='2026-10-20T00:00:00Z',host='172.18.0.8',runtimeBundleSha256='c'*64,sourceCommit='d'*40)
        with self.assertRaises(RuntimeError):module.validate_pair(dict(old=actor,current=actor))
        other=dict(actor,containerId='e'*64,image='sha256:'+'f'*64,host='172.18.0.9')
        module.validate_pair(dict(old=actor,current=other))
        for key,value in [('host','0.0.0.0'),('sourceCommit','main'),('runtimeBundleSha256','unmeasured')]:
            with self.assertRaises(RuntimeError):module.validate_pair(dict(old=actor,current=dict(other,**{key:value})))

    def test_schema_formatting_cannot_erase_changed_models_or_string_defaults(self):
        file=Path(__file__).with_name('installed-retained-inquiry-controller.fixture.py')
        spec=importlib.util.spec_from_file_location('inquiry_schema',file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        source=b'model Product { id String @id name String @default("private // original") }'
        self.assertEqual(module.prisma_tokens(source),module.prisma_tokens(b'// formatting\nmodel Product{ id String @id\n name String @default("private // original") }'))
        self.assertNotEqual(module.prisma_tokens(source),module.prisma_tokens(source.replace(b'name String',b'name String?')))
        self.assertNotEqual(module.prisma_tokens(source),module.prisma_tokens(source.replace(b'private // original',b'changed')))

if __name__=='__main__':unittest.main()
