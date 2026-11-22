"""Test the actual launcher selection helper without launching any process."""
import ast
import hashlib
from pathlib import Path
from types import SimpleNamespace
import unittest

SOURCE=Path(__file__).resolve().parents[2]/'deploy/scripts/online-release-launcher.py'

class PrebuiltLauncherSelection(unittest.TestCase):
    def setUp(self):
        self.raw=b'actual immutable plan bytes';self.mode=0o100400
        outer=self
        class File:
            def __init__(self,value):self.value=value
            def is_absolute(self):return self.value.startswith('/')
            def resolve(self):return self
            def lstat(self):return SimpleNamespace(st_mode=outer.mode)
            def __str__(self):return self.value
        import re
        self.context=dict(hashlib=hashlib,pathlib=SimpleNamespace(Path=File),re=re,immutable=lambda file:self.raw)
        tree=ast.parse(SOURCE.read_text(encoding='utf-8'))
        functions=[node for node in tree.body if isinstance(node,ast.FunctionDef)and node.name in ('require','prebuilt_release_arguments')]
        exec(compile(ast.Module(body=functions,type_ignores=[]),str(SOURCE),'exec'),self.context)
        self.selection=dict(file='/root/private/release-plan.json',sha256=hashlib.sha256(self.raw).hexdigest())

    def test_original_helper_returns_only_fixed_release_content_arguments(self):
        self.assertEqual(self.context['prebuilt_release_arguments'](self.selection),['--prebuilt-release',self.selection['file'],self.selection['sha256']])

    def test_changed_hash_mode_extra_key_or_relative_path_refuses(self):
        for selection in [{**self.selection,'sha256':'a'*64},{**self.selection,'force':True},{**self.selection,'file':'relative.json'}]:
            with self.assertRaises(RuntimeError):self.context['prebuilt_release_arguments'](selection)
        self.mode=0o100600
        with self.assertRaises(RuntimeError):self.context['prebuilt_release_arguments'](self.selection)

if __name__=='__main__':unittest.main()
