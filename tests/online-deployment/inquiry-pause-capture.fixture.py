"""A real native pause probe, explicitly not a coherent application capture."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import sqlite3

root = Path(sys.argv[1])
configuration = json.loads((root / 'action-fixture.json').read_text())
for descriptor, mode in [(9, 'WRITE'), (10, 'WRITE'), (11, 'READ'), (12, 'WRITE')]:
    assert any(re.fullmatch(r'lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+' + mode + r'\s+\S+\s+[0-9a-f]+:[0-9a-f]+:[0-9]+\s+0\s+EOF\s*', line)
               for line in Path('/proc/self/fdinfo/' + str(descriptor)).read_text().splitlines())
native = Path(os.environ['BACKEND_NATIVE_AUTHORITY_FILE']).read_bytes()
assert hashlib.sha256(native).hexdigest() == os.environ['BACKEND_NATIVE_CLAIM_SHA256']
claim = json.loads(native)
assert claim['phase'] == 'ACTIVE' and claim['onlineScope']['scope']['purpose'] == 'capture'
arrivals = Path(configuration['coordination']).parent / 'arrivals'
case_id = root.name.removeprefix('pause-')
assert (arrivals / (case_id + '.delayed.json')).exists()
assert (arrivals / (case_id + '.release')).exists()
assert (arrivals / (case_id + '.acquire.json')).exists()
work = Path(configuration['coordination']) / 'online/work' / configuration['runtimeId'] / 'state.json'
state = json.loads(work.read_text())
assert state['phase'] == 'QUIESCENT'
connection = sqlite3.connect(configuration['databaseUrl'].split('?', 1)[0] + '?mode=ro', uri=True)
try:
    rows = configuration['rowNumbers']
    actual = connection.execute('SELECT rowNumber FROM Product WHERE rowNumber IN (?,?,?) ORDER BY rowNumber',
                                (rows['first'], rows['second'], rows['queued'])).fetchall()
    assert (rows['first'],) in actual and (rows['second'],) in actual, 'ADMITTED_IMPORT_INCOMPLETE'
    assert (rows['queued'],) not in actual, 'QUEUED_ACTION_ENTERED_CAPTURE_BOUNDARY'
finally:
    connection.close()
proof = dict(format='sabalan-native-inquiry-pause-probe/v1', actualNativeDescriptors=True,
             admittedActionCompleted=True, httpEpoch=state['epoch'], captureScopeSha256=claim['onlineScope']['sha256'],
             queuedRowAbsentUnderExclusiveGate=True,
             coherentApplicationCapture=False, productionRecoveryPoint=False)
with open(root / 'pause-probe.json', 'x') as output:
    os.fchmod(output.fileno(), 0o600)
    json.dump(proof, output, sort_keys=True)
    output.flush()
    os.fsync(output.fileno())
