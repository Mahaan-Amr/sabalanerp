import importlib.util
from pathlib import Path
import unittest
import os
import tempfile
import json
from unittest.mock import patch

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

class Custody(unittest.TestCase):
    def setUp(self):
        spec=importlib.util.spec_from_file_location('inquiry_custody',Path(__file__).with_name('installed-retained-inquiry-controller.fixture.py'))
        self.m=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.m)

    @unittest.skipUnless(os.name=='posix' and os.getuid()==0,'Actual Linux root custody required')
    def test_public_image_metadata_is_separate_from_private_scope_reader(self):
        m=self.m
        with tempfile.TemporaryDirectory() as name:
            file=Path(name)/'legacy-business-source.json';raw=b'{"kind":"COMPILED_IMAGE"}';file.write_bytes(raw);file.chmod(0o755)
            with patch.object(m,'_IMAGE_BUSINESS_SOURCE',file):
                self.assertEqual(m.read_image_business_source(file,len(raw),m.digest(raw)),raw)
                with self.assertRaises(RuntimeError):m.read(file)
                for mode in (0o775,0o777,0o666):
                    file.chmod(mode)
                    with self.assertRaises(RuntimeError):m.read_image_business_source(file,len(raw),m.digest(raw))
                file.chmod(0o755)
                with self.assertRaises(RuntimeError):m.read_image_business_source(file,len(raw),m.digest(b'changed'))
                other=Path(name)/'other';os.link(file,other)
                with self.assertRaises(RuntimeError):m.read_image_business_source(file,len(raw),m.digest(raw))
                other.unlink();file.rename(other);file.symlink_to(other)
                with self.assertRaises(RuntimeError):m.read_image_business_source(file,len(raw),m.digest(raw))
                file.unlink();other.rename(file)
                original=m.os.read;changed=False
                def mutate(fd,size):
                    nonlocal changed
                    value=original(fd,size)
                    if not changed:
                        changed=True;file.write_bytes(b'X'*len(raw))
                    return value
                with patch.object(m.os,'read',mutate):
                    with self.assertRaises(RuntimeError):m.read_image_business_source(file,len(raw),m.digest(raw))

    @unittest.skipUnless(os.name=='posix' and os.getuid()==0,'Actual Linux root custody required')
    def test_negative_abort_requires_both_exact_initial_scopes_and_no_start_attempt(self):
        m=self.m
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);root.chmod(0o700);authority=root/'authority';authority.mkdir(mode=0o700)
            owner=m.Controller.__new__(m.Controller);owner.root=root;owner.mode='issuer';owner.children=[];owner.actor_start_attempted=False;owner.native=owner.ready=owner.gate=None;owner.negative_aborted=False
            coordination=root/'coordination';coordination.mkdir(mode=0o700)
            gate=owner.lock(coordination/'deployment-write-admission.lock');interlock=owner.lock(coordination/'deployment-runtime-control.lock')
            scopes={}
            for mode,char in [('old','a'),('current','b')]:
                runtime=char*64;native=coordination/'online/native'/runtime;work=coordination/'online/work'/runtime;native.mkdir(mode=0o700,parents=True);work.mkdir(mode=0o700,parents=True)
                control=owner.lock(native/'deployment-runtime-control.lock');workraw=m.encoded({'scope':mode});m.save(work/'scope.json',workraw)
                scope=dict(runtimeId=runtime,nativeDirectory=str(native),boundaryDirectory=str(work),gate=gate,interlock=interlock)
                raw=m.encoded(scope);m.save(authority/(runtime+'.json'),raw);scopes[mode]=dict(scope=scope,nativeControl=control,workScopeSha256=m.digest(workraw),sha256=m.digest(raw))
            config=dict(format='sabalan-retained-inquiry-pair/v1',root=str(root),scopes=scopes);m.save(root/'pair.json',m.encoded(config));owner.configuration=config
            with patch.object(m,'_ISSUER_AUTHORITY',authority):
                self.assertEqual(owner.initial_pair_state(),config)
                body=dict(format='sabalan-original-inquiry-preactor-failure/v1',mode='old',runtimeId='a'*64,nativeStartAttempted=False,childrenClosed=True,bothScopesInitial=True)
                self.assertFalse(owner.abort_pre_actor(body)['qualificationSuccess'])
                owner.actor_start_attempted=True;self.assertIsNone(owner.initial_pair_state());owner.actor_start_attempted=False
                # A current preactor failure cannot retire an already-started OLD counterpart.
                oldnative=Path(scopes['old']['scope']['nativeDirectory']);unknown=oldnative/'deployment-runtime-native.json';unknown.write_bytes(b'active')
                self.assertIsNone(owner.initial_pair_state())
                with self.assertRaises(RuntimeError):owner.abort_pre_actor(body)
                unknown.unlink();unknown.symlink_to(root/'missing');self.assertIsNone(owner.initial_pair_state());unknown.unlink()
                workfile=Path(scopes['current']['scope']['boundaryDirectory'])/'scope.json';workfile.chmod(0o600);workfile.write_bytes(b'changed');self.assertIsNone(owner.initial_pair_state())

if __name__=='__main__':unittest.main()
