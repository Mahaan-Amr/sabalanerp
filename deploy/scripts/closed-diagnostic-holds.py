"""Explicit private-diagnostic cleanup safeguard; no checkpoint hold schema."""
import hashlib, json
from pathlib import Path
import stat

def assert_no_diagnostic_holds(parents, operation, reconciled):
    parents = [Path(p) for p in parents]; operation = Path(operation)
    if len(parents) != 2 or parents[1].parent != parents[0] or operation.parent != parents[1]:
        raise RuntimeError('DIAGNOSTIC_HOLD_SCOPE_UNPROVEN')
    for path, expected in reconciled.items():
        path = Path(path)
        if path.parent != operation or path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise RuntimeError('RECONCILED_HOLD_CHANGED')
    def inspect(path, operation_entry=False):
        value = path.lstat()
        if stat.S_ISLNK(value.st_mode): raise RuntimeError('DIAGNOSTIC_HOLD_SCAN_UNPROVEN')
        name = path.name.lower()
        if any(token in name for token in ['hold','held','incident','unproven']) or ('active' in name and name.endswith('.json')):
            expected = reconciled.get(path)
            if not expected or not stat.S_ISREG(value.st_mode) or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                raise RuntimeError('UNRECONCILED_DIAGNOSTIC_HOLD')
        # Parent directories also contain historical native stdout captures
        # named .json that are not JSON documents or a private hold registry.
        # Their explicit marker names are checked above. Inspect structured
        # incident flags recursively inside this exact operation only.
        if operation_entry and path.suffix == '.json' and path not in reconciled:
            if value.st_size > 1048576: raise RuntimeError('DIAGNOSTIC_HOLD_SCAN_BOUND')
            row = json.loads(path.read_text())
            if isinstance(row, dict) and (row.get('incidentOpen') is True or row.get('active') is True):
                raise RuntimeError('UNRECONCILED_DIAGNOSTIC_HOLD')
    count = 0
    for parent in parents:
        for path in parent.iterdir():
            inspect(path); count += 1
            if count > 250000: raise RuntimeError('DIAGNOSTIC_HOLD_SCAN_BOUND')
    for path in operation.rglob('*'):
        inspect(path, True); count += 1
        if count > 250000: raise RuntimeError('DIAGNOSTIC_HOLD_SCAN_BOUND')
    return {'entriesInspected':count,'exactReconciledMarkers':len(reconciled)}
