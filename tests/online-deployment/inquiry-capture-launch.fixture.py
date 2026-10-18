import json
import os
from pathlib import Path
import sys

root = Path(sys.argv[1])
configuration = json.loads((root / 'action-fixture.json').read_text())
environment = {key: value for key, value in os.environ.items() if not key.startswith('BACKEND_')}
assert environment['DATABASE_URL'].startswith(('postgres://', 'postgresql://'))
environment.update(BACKEND_RUNTIME_ROLE='control', RECOVERY_COORDINATION_DIR=configuration['coordination'],
                   BACKEND_ONLINE_SCOPE_FILE=configuration['captureFile'], BACKEND_ONLINE_SCOPE_SHA256=configuration['captureSha256'])
os.execve('/usr/bin/python3', ['/usr/bin/python3', '-I', '-B', str(root / 'online-runtime-owner.py'),
                             '/usr/bin/python3', '-I', '-B', str(root / 'pause-capture.py'), str(root)], environment)
