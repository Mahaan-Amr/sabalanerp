import os
from pathlib import Path
import sqlite3
import sys
import time

root, name = Path(sys.argv[1]), sys.argv[2]
assert not any(key.startswith('PG') for key in os.environ)
with sqlite3.connect(os.environ['DATABASE_URL'][5:]) as connection:
    connection.execute('BEGIN IMMEDIATE')
    connection.execute('INSERT INTO native_probes VALUES(?,?,?)',
                       (name, '123456789.12345678', '0.00000001'))
    (root / (name + '.sql-ready')).write_text('actual-sqlite-transaction')
    while not (root / (name + '.finish')).exists():
        time.sleep(0.01)
    connection.commit()
with open(root / (name + '.sql-committed'), 'x') as proof:
    proof.write('commit-completed')
    proof.flush()
    os.fsync(proof.fileno())
