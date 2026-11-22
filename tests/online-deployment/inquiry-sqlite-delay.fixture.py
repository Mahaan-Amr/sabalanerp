"""Owned private fault injector: reserve SQLite without changing any rows."""
import json
import os
from pathlib import Path
import sqlite3
import sys
import time

root = Path(sys.argv[1])
configuration = json.loads((root / 'action-fixture.json').read_text())
database = configuration['databaseUrl'].split('?', 1)[0]
connection = sqlite3.connect(database + '?mode=rw', uri=True)
try:
    connection.execute('BEGIN IMMEDIATE')
    with open(root / 'sqlite-delay-ready', 'x') as marker:
        os.fchmod(marker.fileno(), 0o600)
        marker.write('reserved-without-row-mutation')
        marker.flush()
        os.fsync(marker.fileno())
    while not (root / 'sqlite-delay-finish').exists():
        time.sleep(0.005)
    connection.rollback()
finally:
    connection.close()
with open(root / 'sqlite-delay-closed', 'x') as marker:
    os.fchmod(marker.fileno(), 0o600)
    marker.write('connection-closed')
    marker.flush()
    os.fsync(marker.fileno())
