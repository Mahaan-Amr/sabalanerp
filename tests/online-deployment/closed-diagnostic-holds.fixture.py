import hashlib, json
from pathlib import Path
import tempfile
scope={};exec(compile(HOLD_SOURCE,'closed-diagnostic-holds.py','exec'),scope)
check=scope['assert_no_diagnostic_holds']
with tempfile.TemporaryDirectory(prefix='sabalan-diagnostic-holds-') as directory:
    parent=Path(directory);qa=parent/'qa';qa.mkdir();operation=qa/'operation';operation.mkdir()
    old=operation/'ownership-held-unproven.json';old.write_text('{"historical":true}')
    exempt={old:hashlib.sha256(old.read_bytes()).hexdigest()}
    check([parent,qa],operation,exempt)
    for path,contents in [(parent/'other-active.json','{}'),(qa/'incident-hold.json','{}'),
                          (operation/'new-unproven.json','{}'),(operation/'operator-state.json','{"incidentOpen":true}')]:
        path.write_text(contents)
        try:
            try:check([parent,qa],operation,exempt)
            except RuntimeError as error:assert str(error)=='UNRECONCILED_DIAGNOSTIC_HOLD'
            else:raise AssertionError('UNKNOWN_HOLD_WAS_NOT_REFUSED')
        finally:path.unlink()
    old.write_text('{"historical":false}')
    try:check([parent,qa],operation,exempt)
    except RuntimeError as error:assert str(error)=='RECONCILED_HOLD_CHANGED'
    else:raise AssertionError('ALTERED_HISTORICAL_HOLD_WAS_NOT_REFUSED')
print(json.dumps({'closedDiagnosticHoldsAcceptance':True,'parentActiveRefused':True,'newIncidentRefused':True,'changedReconciledMarkerRefused':True}))
