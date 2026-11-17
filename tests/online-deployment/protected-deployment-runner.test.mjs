import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../deploy/scripts/deploy.sh', import.meta.url), 'utf8').replaceAll('\r\n', '\n');

test('protected release runner records legacy risk before maintenance and keeps canonical release and rollback gates', () => {
  const legacyPreflight = source.indexOf('legacy-backend-signal.py" --preflight');
  const sessionPreparation = source.indexOf('\n  control prepare\n');
  const migration = source.indexOf('dist/scripts/deployment-owned-migrations.js');
  const releaseGate = source.indexOf('node dist/scripts/deployment-gates.js', migration);
  const opened = source.indexOf('\nphase TRAFFIC_OPENED\n', releaseGate);
  const retiredPipeRefusal = source.indexOf('Online bootstrap is unavailable in this protected maintenance runner.');
  const firstExternalPreflight = source.indexOf('for command in git docker awk curl df flock grep mkdir node python3 timeout; do');
  assert.ok(legacyPreflight > 0 && legacyPreflight < sessionPreparation);
  assert.ok(source.indexOf('\n  control prepare-predecessor-role-cutover\n') > legacyPreflight);
  assert.ok(retiredPipeRefusal > 0 && retiredPipeRefusal < firstExternalPreflight);
  assert.ok(migration > sessionPreparation && releaseGate > migration && opened > releaseGate);
  assert.match(source, /DEPLOYMENT_GATE_MODE=ROLLBACK run_backend node dist\/scripts\/deployment-gates\.js/);
  assert.doesNotMatch(source, /deployment-online-bootstrap-gate\.js|online_bootstrap_boundary|docker-compose\.online(?:-storage)?\.yml|retire-protected-online-legacy-records\.py/);
});
