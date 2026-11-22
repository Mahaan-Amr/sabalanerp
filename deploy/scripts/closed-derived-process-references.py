"""Bounded reference census, used under the closed copy's ownership locks.

No process is stopped or file changed. Permission/parse/budget failures refuse
retirement. This complements exclusive admission and mount/reference checks;
it cannot authorize a live or otherwise unknown copy merely because no reference
was observed during one scan.
"""
import os
from pathlib import Path

def assert_no_process_references(identities):
    identities = frozenset(identities)
    if not identities or any(not isinstance(row, tuple) or len(row) != 2
                             or any(type(value) is not int or value < 0 for value in row) for row in identities):
        raise RuntimeError('CLOSED_DERIVED_IDENTITY_UNPROVEN')
    mapped = {(os.major(device), os.minor(device), inode) for device, inode in identities}
    inodes = {inode for _, inode in identities}
    counts = {'processes': 0, 'tasks': 0, 'fds': 0, 'mapsBytes': 0}
    def check(path, kind, pid):
        value = path.stat()
        if (value.st_dev, value.st_ino) in identities:
            raise RuntimeError('CLOSED_DERIVED_REFERENCED:' + kind + ':' + pid)
    try:
        for process in Path('/proc').iterdir():
            if not process.name.isdigit(): continue
            counts['processes'] += 1
            if counts['processes'] > 8192: raise RuntimeError('CLOSED_DERIVED_PROCESS_BUDGET')
            try:
                # All threads in a thread group share the mm; their filesystem
                # context and descriptor tables can differ, so inspect each.
                for task in (process / 'task').iterdir():
                    counts['tasks'] += 1
                    if counts['tasks'] > 65536: raise RuntimeError('CLOSED_DERIVED_TASK_BUDGET')
                    try:
                        for descriptor in (task / 'fd').iterdir():
                            counts['fds'] += 1
                            if counts['fds'] > 1000000: raise RuntimeError('CLOSED_DERIVED_FD_BUDGET')
                            try: check(descriptor, 'fd', process.name)
                            except FileNotFoundError: continue  # A descriptor was actually closed.
                        for kind in ['cwd', 'root']: check(task / kind, kind, process.name)
                    except FileNotFoundError: continue  # This task has actually exited.
                with (process / 'maps').open('rb') as stream:
                    for line in stream:
                        counts['mapsBytes'] += len(line)
                        if len(line) > 1048576 or counts['mapsBytes'] > 256 * 1024**2:
                            raise RuntimeError('CLOSED_DERIVED_MAP_BUDGET')
                        fields = line.split(None, 5)
                        if len(fields) < 5: raise RuntimeError('CLOSED_DERIVED_MAP_UNPROVEN')
                        major, minor = fields[3].split(b':')
                        if (int(major, 16), int(minor, 16), int(fields[4])) in mapped:
                            raise RuntimeError('CLOSED_DERIVED_REFERENCED:maps:' + process.name)
                        # Overlay mappings may expose their backing device
                        # while stat reports the overlay device. Resolve a
                        # matching inode through that process's own root.
                        if int(fields[4]) in inodes:
                            if len(fields) != 6 or not fields[5].startswith(b'/'):
                                raise RuntimeError('CLOSED_DERIVED_MAP_ALIAS_UNPROVEN')
                            name = os.fsdecode(fields[5].rstrip(b'\n'))
                            if name.endswith(' (deleted)') or '\\' in name:
                                raise RuntimeError('CLOSED_DERIVED_MAP_ALIAS_UNPROVEN')
                            try: check(process / 'root' / name.lstrip('/'), 'maps', process.name)
                            except FileNotFoundError:
                                raise RuntimeError('CLOSED_DERIVED_MAP_ALIAS_UNPROVEN')
            except FileNotFoundError: continue  # This process has actually exited.
    except RuntimeError:
        raise
    except (OSError, ValueError) as error:
        raise RuntimeError('CLOSED_DERIVED_PROCESS_CENSUS_UNPROVEN') from error
    return counts
