import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(process.cwd(), '..');
const deployScript = fs.readFileSync(path.join(repositoryRoot, 'deploy', 'scripts', 'deploy.sh'), 'utf8');
const checkpointScript = fs.readFileSync(path.join(process.cwd(), 'src', 'scripts', 'deployment-checkpoint.ts'), 'utf8');

assert.match(
  deployScript,
  /run_backend_timed_with_heartbeat\(\)[\s\S]*run_backend_timed "\$\{duration\}" "\$@" <\/dev\/null &[\s\S]*if ! control heartbeat[\s\S]*kill -TERM "\$\{timed_pid\}"[\s\S]*wait "\$\{timed_pid\}"/,
  'long checkpoint work must renew the durable deployment lease until the child exits',
);
assert.match(
  deployScript,
  /run_backend_timed_with_heartbeat "\$\{checkpoint_timeout\}" node dist\/scripts\/deployment-checkpoint\.js/,
  'the coordinated checkpoint must run through the heartbeat-aware wrapper',
);
assert.match(
  deployScript,
  /run_backend\(\)[\s\S]*docker compose[^\n]* run -T --rm --no-deps/,
  'deployment control jobs must disable Compose TTY allocation',
);
assert.match(
  deployScript,
  /run_backend_timed\(\)[\s\S]*docker compose[^\n]* run -T --rm --no-deps/,
  'timed deployment jobs must disable Compose TTY allocation so background timeout jobs cannot be stopped by SIGTTIN',
);
assert.doesNotMatch(
  checkpointScript,
  /validateRecoveryPackage\(\{ sourcePath: uploaded\.objectPath/,
  'a byte-identical remote package must not be downloaded and decrypted a second time',
);
assert.match(
  checkpointScript,
  /remote\.uploadVerified\(result\.destination, objectKey, result\.sha256\)/,
  'remote read-back must compare against the checksum produced by package creation',
);
assert.match(
  deployScript,
  /DEPLOYMENT_GATE_MODE=ROLLBACK run_backend node dist\/scripts\/deployment-gates\.js; then[\s\S]*--refer-from="\/app\/deployment-reports\/\$\{FINANCIAL_EVIDENCE_DRY_RUN_REPORT\}"[\s\S]*if \[ "\$\{referral_ready\}" -eq 1 \]; then[\s\S]*control maintenance-off/,
  'unresolved evidence referral must persist after verified rollback and before traffic reopens',
);
assert.doesNotMatch(
  deployScript,
  /--refer-unresolved --deployment-checkpoint/,
  'a pre-rollback support referral would be erased by checkpoint restoration',
);

console.log('deployment checkpoint runtime tests passed');
