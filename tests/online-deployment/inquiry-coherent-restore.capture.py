"""Private actual EX10 SQLite cut, never a published recovery point."""
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys

root = Path(sys.argv[1])
assert re.fullmatch(r'/app/online-runtime-acceptance/inquiry-coherent-[a-f0-9]{32}', str(root))
for descriptor, mode in [(9, 'WRITE'), (10, 'WRITE'), (11, 'READ'), (12, 'WRITE')]:
    assert any(re.fullmatch(r'lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+' + mode + r'\s+\S+\s+[0-9a-f]+:[0-9a-f]+:[0-9]+\s+0\s+EOF\s*', line)
               for line in Path('/proc/self/fdinfo/' + str(descriptor)).read_text().splitlines())
configuration = json.loads((root / 'prepared.json').read_bytes())
source = root / 'source.db'
before = source.stat()
work = json.loads((Path(configuration['source']['boundaryDirectory']) / 'state.json').read_bytes())
assert work['phase'] == 'QUIESCENT'
with sqlite3.connect('file:' + str(source) + '?mode=ro', uri=True) as connection:
    assert connection.execute("SELECT rowNumber FROM Product WHERE rowNumber='COHERENT-ACK-LOST'").fetchall() == [('COHERENT-ACK-LOST',)]
    assert connection.execute("SELECT count(*) FROM Product WHERE rowNumber='COHERENT-QUEUED'").fetchone()[0] == 0
    with sqlite3.connect(root / 'restored.db') as target:
        connection.backup(target)
        assert target.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
after = source.stat()
assert (before.st_dev, before.st_ino) == (after.st_dev, after.st_ino)
fd = os.open(root / 'restored.db', os.O_RDONLY | os.O_NOFOLLOW)
try:
    os.fsync(fd)
    digest = hashlib.sha256()
    while chunk := os.read(fd, 262144):
        digest.update(chunk)
finally:
    os.close(fd)
proof = {'format': 'sabalan-private-inquiry-sqlite-cut/v1', 'sha256': digest.hexdigest(),
         'bytes': (root / 'restored.db').stat().st_size, 'sourceDevice': str(before.st_dev), 'sourceInode': str(before.st_ino),
         'actualInheritedExclusiveGate': True, 'admittedActionCommitted': True, 'queuedActionAbsent': True,
         'productionRecoveryPoint': False}
with (root / 'capture-proof.json').open('x') as output:
    os.chmod(root / 'capture-proof.json', 0o600)
    json.dump(proof, output, sort_keys=True)
    output.flush()
    os.fsync(output.fileno())
fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
try:
    os.fsync(fd)
finally:
    os.close(fd)
