import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sh = process.platform === 'win32'
  ? path.resolve(spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout.trim(), '../../../usr/bin/sh.exe')
  : '/bin/sh';
const runner = fileURLToPath(new URL('../../deploy/scripts/deploy.sh', import.meta.url)).split(path.sep).join('/');
const runShell = (args, options) => spawnSync(sh, ['-c', 'PATH=/usr/bin:$PATH; export PATH; exec sh "$@"', 'sh', ...args], options);
const operationId = 'c' + 'a'.repeat(24);

test('the protected backup CLI refuses invalid secret input before reading host state', () => {
  for (const input of [Buffer.from('short1'), Buffer.alloc(4097, 'a'), Buffer.from([0xff])]) {
    const result = runShell([runner, '--system-recovery-backup', 'missing.env', operationId], {
      input, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stderr.trim(), 'SYSTEM_RECOVERY_BACKUP_INPUT_INVALID');
    assert.equal(result.stdout, '');
  }
});

const backupRunner = fileURLToPath(new URL('../../deploy/scripts/system-recovery-backup-host.sh', import.meta.url))
  .split(path.sep).join('/');
const fixture = String.raw`set -eu
. "$1"
BACKUP_FIXTURE_FAILURE="$2"
SYSTEM_RECOVERY_OWNER_ACTION="$3"
SYSTEM_RECOVERY_OWNER_HANDOFF=0
[ "$SYSTEM_RECOVERY_OWNER_ACTION" != RESTORE ] || SYSTEM_RECOVERY_OWNER_HANDOFF=1
REPO_ROOT=/opt/sabalanerp
OPERATIONS_ROOT=/fake
COMPOSE_FILE=docker-compose.prod.yml
ENV_FILE=/fake/env
SESSION_HOST_PATH=/fake/session
CONFIGURATION_STATE=/fake/config
SYSTEM_RECOVERY_BACKUP_HOST=/fake/system-recovery-backup-host.mjs
SYSTEM_RECOVERY_BACKUP_INTENT=/fake/hold
SYSTEM_RECOVERY_OPERATION_ID=caaaaaaaaaaaaaaaaaaaaaaaa
DEPLOYMENT_OWNER=operator
MAINTENANCE_ACTIVE=0
ADVISORY_PID=""
exec 8<&0 </dev/null
exec 7<&8
id() { printf '0\n'; }
realpath() { printf '%s\n' "$2"; }
mktemp() { command mktemp; }
env_value() { printf 'sabalan_application_runtime\n'; }
sh() { case "$*" in *storage-preflight.sh*) echo 'storage-preflight';; *) command sh "$@";; esac; }
compose() { case "$*" in *system-recovery-runtime-proof.js*) printf '{"role":"sabalan_application_runtime","commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","releaseId":"release-current","admitted":false}\n';; *) printf 'container-id\n';; esac; }
docker() { case "$*" in *--format*) printf 'no-malware-scan\n';; *) printf '[]\n';; esac; }
database_role_pin_path() { printf '/fake/pin\n'; }
protected_compose_config() { printf '{}\n'; }
capture_only_services() { printf '[]\n'; }
node() {
  case "$*" in
    *deployment-existing-release.mjs)
      printf '%s\n' 'DEPLOYMENT_BACKEND_IMAGE=backend DEPLOYMENT_FRONTEND_IMAGE=frontend DEPLOYMENT_INQUIRY_IMAGE=inquiry DEPLOYMENT_NGINX_IMAGE=nginx DEPLOYMENT_POSTGRES_IMAGE=postgres DEPLOYMENT_TARGET_COMMIT=commit'
      ;;
    *performance-deployment-environment.mjs*) printf 'release\n' ;;
    *'start-original'*) echo 'start-original' ;;
    *'start-restored'*) echo 'start-restored'; case "$BACKUP_FIXTURE_FAILURE" in startup-known|startup-unknown) return 1;; esac ;;
    *'verify-startup-closed'*) [ "$BACKUP_FIXTURE_FAILURE" != startup-unknown ] ;;
    *'start-rolled-back'*) echo 'start-rolled-back' ;;
    *'within-budget'*) [ "$BACKUP_FIXTURE_FAILURE" != deadline ] ;;
    *'stop-owner'*) echo 'owner-stop' ;;
    *' hold '*) echo 'persist-hold' ;;
    *' clear '*) echo 'complete-intent' ;;
    *'randomBytes'*) printf 'unique\n' ;;
    *'hrtime'*) printf '0\n' ;;
  esac
}
python3() { echo 'drain-preflight'; }
run_backend() {
  case "$*" in
    *system-recovery-owner-preflight.js*)
      if [ "$BACKUP_FIXTURE_FAILURE" = stale ]; then echo 'request-rejected'; return 75; fi
      echo 'request-admitted'
      ;;
    *"system-recovery-owner.js "*)
      IFS= read -r supplied || [ -n "$supplied" ]
      [ "$supplied" = 'synthetic1passphrase' ]
      echo 'owner'
      [ "$BACKUP_FIXTURE_FAILURE" != owner ] && [ "$BACKUP_FIXTURE_FAILURE" != promoted ] && [ "$BACKUP_FIXTURE_FAILURE" != rollback ]
      ;;
    *deployment-gates.js*)
      if [ "$SYSTEM_RECOVERY_OWNER_ACTION" = RESTORE ]; then case "$DEPLOYMENT_GATE_MODE" in APPLICATION_RECOVERY|APPLICATION_RECOVERY_ROLLBACK) ;; *) return 1;; esac; else [ "$DEPLOYMENT_GATE_MODE" = PREVIOUS_UNCHANGED ]; fi
      echo 'gates'
      if [ "$BACKUP_FIXTURE_FAILURE" = gates-recover ] && [ "$DEPLOYMENT_GATE_MODE" = APPLICATION_RECOVERY ]; then return 1; fi
      [ "$BACKUP_FIXTURE_FAILURE" != gates ]
      ;;
    *deployment-checkpoint.js*) echo 'checkpoint'; [ "$BACKUP_FIXTURE_FAILURE" != checkpoint ] ;;
    *system-recovery-owner-reconcile.js*) echo 'reconciled-owner' ;;
    *system-recovery-rollback-receipt.js*) echo 'rollback-receipt' ;;
    *deployment-rollback.js*) echo 'checkpoint-rollback'; [ "$BACKUP_FIXTURE_FAILURE" != rollback ] ;;
    *deployment-finalize-recovery.js*) echo 'rollback-finalized' ;;
  esac
}
try_acquire_advisory() { echo 'advisory'; }
assert_system_recovery_advisory() { echo 'advisory-verified'; }
control() { echo "control $*"; if [ "$BACKUP_FIXTURE_FAILURE" = after-public ] && [ "$1" = finish ]; then return 1; fi; }
session_value() { printf 'lease-token\n'; }
phase() { DEPLOYMENT_PHASE="$1"; echo "phase $*"; }
verify_public_maintenance() { echo 'public-503'; }
drain_current_services() { echo 'drain'; }
assert_original_legacy_still_stopped() { echo 'original-drained'; }
assert_native_runtime_closed() { echo 'native-closed'; }
drain_release_for_rollback() { echo 'rollback-drain'; }
verify_database_role_pin() { echo 'roles-verified'; }
run_original_owned_with_heartbeat() { "$@"; }
cleanup_locks() { echo 'cleanup'; }
capture_clamav_checkpoint() { echo 'capture-scanner'; }
assert_qa_remote_checkpoint_mount() { echo 'remote-mount'; }
host_backup_retention() { echo "retention $*"; }
bind_host_backup_retention_receipt() { echo "retention-bound $*"; }
run_backend_timed_with_heartbeat() { shift; run_backend "$@"; }
sleep() { :; }
run_system_recovery_backup
`;

function runBackupFixture(failure = '', action = 'BACKUP') {
  const result = runShell(['-c', fixture, 'sh', backupRunner, failure, action], {
    input: 'synthetic1passphrase', encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.error, undefined);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic1passphrase/);
  return result;
}

test('the protected backup opens traffic after the owner and unchanged release gates pass', () => {
  const result = runBackupFixture();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /persist-hold[\s\S]*control acquire[\s\S]*public-503[\s\S]*drain\n[\s\S]*phase SERVICES_DRAINED[\s\S]*owner\n[\s\S]*native-closed[\s\S]*start-original[\s\S]*gates[\s\S]*public-503[\s\S]*control maintenance-off[\s\S]*control finish[\s\S]*complete-intent/);
});

test('a fully reaped promoted owner failure restores the verified pre-request checkpoint before reopening', () => {
  const result = runBackupFixture('promoted', 'RESTORE');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /reconciled-owner[\s\S]*phase ROLLBACK_STARTED[\s\S]*checkpoint-rollback[\s\S]*rollback-finalized[\s\S]*rollback-receipt[\s\S]*start-rolled-back[\s\S]*gates[\s\S]*control maintenance-off[\s\S]*control finish/);
});

test('a definitely closed startup failure rolls back while unknown original native completion stays held', () => {
  const known = runBackupFixture('startup-known', 'RESTORE');
  assert.equal(known.status, 0, known.stderr);
  assert.match(known.stdout, /start-restored[\s\S]*checkpoint-rollback[\s\S]*start-rolled-back[\s\S]*control maintenance-off/);
  const unknown = runBackupFixture('startup-unknown', 'RESTORE');
  assert.equal(unknown.status, 1, unknown.stderr);
  assert.doesNotMatch(unknown.stdout, /checkpoint-rollback|maintenance-off/);
});

test('post-owner deadline fences gates, stops only their owned container and reaps before returning', () => {
  const script = String.raw`set -eu
. "$1"
SYSTEM_RECOVERY_OWNER_ACTION=RESTORE
OPERATIONS_ROOT=/fake
restore_mutation_started=0
DEPLOYMENT_GATE_MODE=APPLICATION_RECOVERY
SYSTEM_RECOVERY_GATES_CONTAINER=exact-gates
DEPLOYMENT_TARGET_BACKEND_IMAGE=exact-image
DEPLOYMENT_ID=deploy-current
SYSTEM_RECOVERY_OPERATION_ID=operation-current
checks=0
gate_marker="$(mktemp)"
rm "$gate_marker"
trap 'rm -f "$gate_marker"' EXIT
node() {
 case "$*" in
  *within-budget*) checks=$((checks+1)); [ "$checks" -lt 2 ]; ;;
  *stop-gates*) echo "stop $*"; : > "$gate_marker";;
 esac
}
phase() { echo "phase $*"; }
sleep() { command sleep 0.01; }
gates() { while [ ! -e "$gate_marker" ]; do sleep; done; echo 'original-child-closed'; }
status=0
run_system_recovery_postowner gates || status=$?
echo "returned $status"
`;
  const result = runShell(['-c', script, 'sh', backupRunner], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /phase ROLLBACK_STARTED/);
  assert.match(result.stdout, /stop .*stop-gates exact-gates exact-image deploy-current operation-current[\s\S]*original-child-closed[\s\S]*returned 124/);
});

test('expiry while capturing the runtime proof retains rollback phase in its original shell', () => {
  const script = String.raw`set -eu
. "$1"
SYSTEM_RECOVERY_OWNER_ACTION=RESTORE
OPERATIONS_ROOT=/fake
SESSION_HOST_PATH="$(mktemp)"
DEPLOYMENT_PHASE=RELEASE_STARTED
restore_mutation_started=0
checks=0
node() { checks=$((checks+1)); [ "$checks" -lt 2 ]; }
phase() {
 [ "$DEPLOYMENT_PHASE" != "$1" ] || { echo 'forbidden-self-transition' >&2; return 1; }
 DEPLOYMENT_PHASE="$1"
 echo "phase $1" >&2
}
sleep() { command sleep 0.01; }
compose() { command sleep 0.1; printf '{"admitted":false}\n'; }
status=0
capture_system_recovery_runtime_after || status=$?
echo "captured $status $DEPLOYMENT_PHASE"
if [ "$DEPLOYMENT_PHASE" != ROLLBACK_STARTED ]; then phase ROLLBACK_STARTED; fi
echo 'checkpoint-rollback-admitted'
rm -f "$SESSION_HOST_PATH" "$SESSION_HOST_PATH".runtime-proof.*
`;
  const result = runShell(['-c', script, 'sh', backupRunner], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /captured 124 ROLLBACK_STARTED[\s\S]*checkpoint-rollback-admitted/);
  assert.doesNotMatch(result.stderr, /forbidden-self-transition/);
});

test('restore health failure or elapsed mutation deadline runs one checkpoint rollback, while a failed rollback stays closed', () => {
  for (const failure of ['gates-recover', 'deadline']) {
    const result = runBackupFixture(failure, 'RESTORE');
    assert.equal(result.status, 0, result.stderr);
    assert.equal((result.stdout.match(/checkpoint-rollback/g) || []).length, 1);
    assert.match(result.stdout, /phase ROLLBACK_STARTED[\s\S]*rollback-finalized[\s\S]*gates[\s\S]*control maintenance-off/);
  }
  const held = runBackupFixture('rollback', 'RESTORE');
  assert.equal(held.status, 1);
  assert.equal((held.stdout.match(/checkpoint-rollback/g) || []).length, 1);
  assert.doesNotMatch(held.stdout, /maintenance-off|complete-intent/);
});

test('a failure after public reopening never rolls back newly acknowledged writes', () => {
  const result = runBackupFixture('after-public', 'RESTORE');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /control maintenance-off[\s\S]*control maintenance-on/);
  assert.doesNotMatch(result.stdout, /checkpoint-rollback|phase ROLLBACK_STARTED/);
});

test('application restore requires independent checkpoint verification before mutation and all release gates before reopening', () => {
  const result = runBackupFixture('', 'RESTORE');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /storage-preflight[\s\S]*phase SERVICES_DRAINED[\s\S]*checkpoint[\s\S]*phase LOCAL_CHECKPOINT_VERIFIED[\s\S]*phase REMOTE_CHECKPOINT_VERIFIED[\s\S]*phase MUTATION_STARTED[\s\S]*owner\n[\s\S]*phase MIGRATIONS_APPLIED[\s\S]*phase RELEASE_STARTED[\s\S]*gates[\s\S]*phase GATES_PASSED[\s\S]*control maintenance-off[\s\S]*phase TRAFFIC_OPENED[\s\S]*control finish/);
  const failed = runBackupFixture('checkpoint', 'RESTORE');
  assert.equal(failed.status, 1, failed.stderr);
  assert.doesNotMatch(failed.stdout, /owner\n|maintenance-off|complete-intent/);
});

test('a stale sealed request is rejected before advisory ownership, drain or public maintenance', () => {
  const result = runBackupFixture('stale', 'RESTORE');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /request-rejected/);
  assert.doesNotMatch(result.stdout, /persist-hold|control acquire|maintenance-on|drain|owner\n/);
});

test('owner or unchanged release gate failures keep the durable hold and maintenance', () => {
  for (const failure of ['owner', 'gates']) {
    const result = runBackupFixture(failure);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /persist-hold[\s\S]*control maintenance-on[\s\S]*owner[\s\S]*control maintenance-on[\s\S]*cleanup/);
    assert.doesNotMatch(result.stdout, /maintenance-off|complete-intent/);
    assert.match(result.stderr, /held in maintenance/);
  }
});
