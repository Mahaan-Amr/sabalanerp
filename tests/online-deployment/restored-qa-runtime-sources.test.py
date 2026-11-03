"""Finite source specialization checks; never launches an application or Docker."""
import ast
import importlib.util
from pathlib import Path
import unittest

root=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('restored_runtime_sources',root/'scripts/lib/restored-qa/build-runtime-sources.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Sources(unittest.TestCase):
 def test_finite_specialization_is_repeatable_and_does_not_write_outputs(self):
  before=set(module.R.joinpath('scripts/lib/restored-qa').iterdir())
  first=module.build()
  self.assertEqual(set(first),{'independent-restored-baseline.worker.cjs','private-qualification-observer.py','independent-private-runtime.py','private-qualification-materialize.py','original-host-controller-channel.py'})
  self.assertEqual(first,module.build())
  self.assertEqual(before,set(module.R.joinpath('scripts/lib/restored-qa').iterdir()))
  for name,source in first.items():
   if name.endswith('.py'):ast.parse(source)

if __name__=='__main__':unittest.main()
