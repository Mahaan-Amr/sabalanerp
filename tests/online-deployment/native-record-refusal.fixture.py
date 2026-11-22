"""Existing null/unknown ownership records never mean absent authority."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(sys.argv[1])
assert root.parent == Path('/app/online-runtime-acceptance') and root.name.startswith('online-native-')
spec = importlib.util.spec_from_file_location('native_owner', root / 'backend-runtime-owner.py')
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)
reports = []
for selected in ['deployment-runtime-native.json', 'deployment-online-worker-native.json', 'deployment-bootstrap-native.json']:
    directory = root / ('unknown-' + selected.removesuffix('.json'))
    directory.mkdir(mode=0o700)
    file = directory / selected
    file.write_bytes(b'null\n')
    file.chmod(0o600)
    environment = dict(os.environ, RECOVERY_COORDINATION_DIR=str(directory), BACKEND_RUNTIME_ROLE='control')
    legacy = subprocess.run(['sh', str(root / 'with-backend-control-ownership.sh'), 'node', '-e', "console.log('UNSAFE')"],
                            env=environment, capture_output=True, timeout=8)
    assert legacy.returncode == 75 and not legacy.stdout, 'Existing null fence permitted protected control: ' + selected
    if selected != 'deployment-bootstrap-native.json':
        try:
            owner.assert_closed(directory, selected)
        except Exception:
            pass
        else:
            raise AssertionError('Existing null fence permitted native successor: ' + selected)
        probe = subprocess.run(['node', '-e', "const assert=require('node:assert/strict');const {assertNativeRuntimeControlBoundary}=require(process.argv[1]);assert.throws(()=>assertNativeRuntimeControlBoundary(),/AUTHORITY_UNPROVEN/);console.log('REFUSED')",
                                str(root / 'services/runtimeNativeAuthority.js')],
                               env=environment, capture_output=True, timeout=8)
        assert probe.returncode == 0 and probe.stdout.strip() == b'REFUSED'
    assert file.read_bytes() == b'null\n'
    reports.append(dict(file=selected, existingNullRefused=True, originalBytesRetained=True))
print(json.dumps(dict(passResult=True, cases=reports)))
