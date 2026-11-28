import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertFirstRoleHostLock, readFirstRolePrivateFile, switchFirstRoleEnvironment } from './first-role-cutover-host-environment.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const parse = file => JSON.parse(readFirstRolePrivateFile(file).bytes);
const reject = () => { throw new Error('FIRST_ROLE_ROLLBACK_HOST_BOUNDARY_UNPROVEN'); };

function loadOwnedEnvironment(root, reportDir, environment) {
  assertFirstRoleHostLock(root);
  const session = parse(path.join(reportDir, 'active-deployment-session.json'));
  const { purpose, deploymentId, releaseId, leaseToken, targetCommit, firstRoleCutover, phase } = session;
  const beforeSha256 = firstRoleCutover?.beforeEnvironmentSha256;
  const afterSha256 = firstRoleCutover?.afterEnvironmentSha256;
  if (purpose !== 'first-database-role-cutover' || session.bootstrap !== false || !id(deploymentId) || !id(releaseId)
    || !/^[a-f0-9]{40}$/.test(targetCommit ?? '') || !sha(leaseToken) || !sha(beforeSha256) || !sha(afterSha256)
    || beforeSha256 === afterSha256 || !['MUTATION_STARTED', 'MIGRATIONS_APPLIED', 'RELEASE_STARTED', 'GATES_PASSED', 'ROLLBACK_STARTED'].includes(phase)) reject();
  const current = hash(readFirstRolePrivateFile(environment).bytes);
  if (current === beforeSha256) return { session, retained: environment, expected: { deploymentId, beforeSha256, afterSha256 } };
  const retained = path.join(reportDir, `first-role-environment-${deploymentId}.previous`);
  if (current !== afterSha256 || hash(readFirstRolePrivateFile(retained).bytes) !== beforeSha256) reject();
  return { session, retained, expected: { deploymentId, beforeSha256, afterSha256 } };
}

function docker(args, input) {
  return execFileSync('docker', args, { input, encoding: 'utf8', timeout: 15_000, stdio: ['pipe', 'pipe', 'ignore'] }).trim();
}

async function restoreOwnedEnvironment(root, reportDir, environment, postgres) {
  if (!/^[a-f0-9]{12,64}$/.test(postgres ?? '')) reject();
  const { session, expected } = loadOwnedEnvironment(root, reportDir, environment);
  const { deploymentId, releaseId, leaseToken, targetCommit, rollbackReleaseSet } = session;
  const [container] = JSON.parse(docker(['inspect', postgres]));
  if (!container.Id.startsWith(postgres) || container.Image !== rollbackReleaseSet?.postgres || container.State?.Running !== true
    || container.Config?.Labels?.['com.docker.compose.project'] !== 'sabalanerp'
    || container.Config?.Labels?.['com.docker.compose.service'] !== 'postgres') reject();
  const coordination = docker(['volume', 'inspect', 'sabalanerp_recovery_coordination', '--format', '{{.Mountpoint}}']);
  if (!path.isAbsolute(coordination)) reject();
  const proveBoundary = () => {
    const marker = parse(path.join(coordination, 'deployment-maintenance.json'));
    const checkpoint = parse(path.join(coordination, 'deployment-checkpoint.json'));
    if (marker.deploymentId !== deploymentId || marker.releaseId !== releaseId || checkpoint.deploymentId !== deploymentId
      || checkpoint.releaseId !== releaseId || !sha(checkpoint.checksum) || !sha(checkpoint.canonicalMetadataSha256)
      || checkpoint.localVerified !== true || checkpoint.remoteVerified !== true || checkpoint.localRestoreVerified !== true) return false;
    // Values interpolated here are limited to checked identifiers or lowercase hexadecimal.
    const sql = `BEGIN READ ONLY;
      SELECT count(*) FROM public.deployment_operations WHERE id = '${deploymentId}' AND "releaseId" = '${releaseId}'
        AND "targetCommit" = '${targetCommit}' AND "leaseToken" = '${leaseToken}' AND "activeKey" = 'production'
        AND phase = 'ROLLBACK_STARTED' AND "leaseExpiresAt" > clock_timestamp() AT TIME ZONE 'UTC'
        AND "checkpointJson"->>'checksum' = '${checkpoint.checksum}'
        AND "reportJson"->'firstRoleCutoverAcl'->>'action' = 'restore'
        AND "reportJson"->'firstRoleCutoverAcl'->>'checkpointSha256' = '${checkpoint.checksum}'
        AND "reportJson"->'firstRoleCutoverAcl'->>'checkpointMetadataSha256' = '${checkpoint.canonicalMetadataSha256}'
        AND NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename = 'sabalan_application_runtime');
      ROLLBACK;`;
    return docker(['exec', '-i', postgres, 'sh', '-c', 'exec psql -XAtq -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'], sql) === '1';
  };
  await switchFirstRoleEnvironment({ root, reportDir, environment, expected, action: 'restore', proveBoundary });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, root, report, environment, postgres] = process.argv.slice(2);
    if (command === 'original-environment' && process.argv.length === 6) {
      process.stdout.write(loadOwnedEnvironment(root, report, environment).retained);
    } else if (command === 'restore-environment' && process.argv.length === 7) {
      await restoreOwnedEnvironment(root, report, environment, postgres);
    } else reject();
  } catch {
    console.error('The original first-role environment cannot be restored under the current checkpoint and lease.');
    process.exitCode = 1;
  }
}
