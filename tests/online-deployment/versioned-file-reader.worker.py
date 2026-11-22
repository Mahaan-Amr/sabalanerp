"""Private file-only fixture. No SQL, serving or production control authority."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import sys

spec = importlib.util.spec_from_file_location('versioned_reader', Path(__file__).with_name('recovery-versioned-files.py'))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
if len(sys.argv) == 6 and sys.argv[5] == 'pause-after-copy':
    write = os.write
    paused = False

    def observed_write(fd, data):
        global paused
        result = write(fd, data)
        if not paused:
            paused = True
            print('ACTUAL_IMMUTABLE_BYTES_COPIED', flush=True)
            os.kill(os.getpid(), signal.SIGSTOP)
        return result

    os.write = observed_write

try:
    selected = reader.SealedVersionedFiles(sys.argv[1], sys.argv[2], sys.argv[3])
    result = selected.restore(sys.argv[4])
    print(json.dumps({'ok': True, 'result': result}), flush=True)
except Exception as error:
    print(json.dumps({'ok': False, 'error': str(error)}), flush=True)
    sys.exit(1)
