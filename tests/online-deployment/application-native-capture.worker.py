"""Diagnostic error locations around the unchanged canonical capture entry.

No query text, arguments, environment values or exception messages are logged.
The original run(), guardian, lock ownership and admission transitions remain
authoritative; failures still return75 and never reopen the durable pause.
"""
import importlib.util
from pathlib import Path
import sys
import traceback

script = Path(__file__).with_name('capture-coherent-components.py')
specification = importlib.util.spec_from_file_location('application_canonical_coherent_capture', script)
module = importlib.util.module_from_spec(specification)
specification.loader.exec_module(module)
try:
    sys.exit(module.run())
except Exception as failure:
    for frame in traceback.extract_tb(failure.__traceback__):
        print('CAPTURE_FAILURE_LOCATION ' + Path(frame.filename).name + ':' + str(frame.lineno) + ':' + frame.name,
              file=sys.stderr, flush=True)
    print('CAPTURE_FAILURE_TYPE ' + type(failure).__name__, file=sys.stderr, flush=True)
    sys.exit(75)
