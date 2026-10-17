"""Actual scoped database freeze and inherited native descriptors."""
import importlib.util
import json
import os
from pathlib import Path
import re

root = Path(__file__).parent
spec = importlib.util.spec_from_file_location('native_freeze', root / 'recovery-database-freeze.py')
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)
source_url = os.environ['DATABASE_URL']
namespace = os.environ['BACKEND_NATIVE_POSTGRES_APPLICATION_NAME']
assert api.native_capture_namespace(source_url, 10) == namespace
claim = json.loads(Path(os.environ['BACKEND_NATIVE_AUTHORITY_FILE']).read_bytes())


def owned():
    assert api.native_capture_namespace(source_url, 10) == namespace


with open(os.devnull, 'wb') as diagnostic:
    boundary = api.DatabaseFreeze(source_url, 10, owned, diagnostic.fileno())
    try:
        observed = boundary.acquire(claim['clusterIdentifier'], claim['initialDatabase']['name'])
        assert observed['namespace'] == namespace and observed['relations'] == 1
        # Prove the actual psql child retained each same open description,
        # rather than relying on pass_fds metadata or client process death.
        for descriptor, access in [(9, 'WRITE'), (10, 'WRITE'), (11, 'READ'), (12, 'WRITE')]:
            expected = os.fstat(descriptor)
            actual = os.stat('/proc/' + str(boundary.process.pid) + '/fd/' + str(descriptor))
            assert (expected.st_dev, expected.st_ino) == (actual.st_dev, actual.st_ino)
            details = Path('/proc/' + str(boundary.process.pid) + '/fdinfo/' + str(descriptor)).read_text()
            assert re.search(r'^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+' + access + r'\s+\S+\s+[0-9a-f]+:[0-9a-f]+:'
                             + str(expected.st_ino) + r'\s+0\s+EOF\s*$', details, re.M)
        boundary.assert_frozen()
    finally:
        assert boundary.close() == 0
print(json.dumps(dict(event='online-capture-closed', descriptors=4, relations=1, namespace=namespace)))
