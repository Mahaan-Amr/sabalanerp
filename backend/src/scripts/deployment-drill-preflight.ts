import { recoveryDrillFreshness, recoveryRehearsalFreshness } from '../services/deploymentDrillPolicy';
import { readDeploymentDrillMetadata } from '../services/deploymentDrillMetadata';

const main = async () => {
  const root = String(process.env.DEPLOYMENT_REMOTE_MOUNT || '').trim();
  if (!root) throw Object.assign(new Error('DEPLOYMENT_REMOTE_MOUNT is required.'), { code: 'DEPLOYMENT_CONFIGURATION_MISSING' });
  const metadata = await readDeploymentDrillMetadata(root);
  metadata.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const latest = metadata[0];
  if (!latest) {
    console.log(JSON.stringify({ ok: true, reason: 'NO_PREVIOUS_REMOTE_CHECKPOINT' }));
    return;
  }
  const firstCheckpointAt = new Date(metadata[metadata.length - 1].createdAt);
  const healthyDrillTimes = metadata
    .filter((item) => item.lastDrill?.status === 'HEALTHY' && item.lastDrill.completedAt)
    .map((item) => new Date(item.lastDrill!.completedAt!))
    .filter((item) => Number.isFinite(item.getTime()));
  const lastHealthyDrillAt = healthyDrillTimes.sort((left, right) => right.getTime() - left.getTime())[0];
  const decision = recoveryDrillFreshness({ checkpointCreatedAt: firstCheckpointAt, lastHealthyDrillAt, now: new Date() });
  if (!decision.healthy) {
    throw Object.assign(new Error(`The latest remote checkpoint ${latest.deploymentId} has no current healthy restore drill.`), { code: 'DEPLOYMENT_DRILL_OVERDUE' });
  }
  const healthyRehearsalTimes = metadata
    .filter((item) => item.lastRehearsal?.status === 'HEALTHY' && item.lastRehearsal.completedAt)
    .map((item) => new Date(item.lastRehearsal!.completedAt!))
    .filter((item) => Number.isFinite(item.getTime()));
  const lastHealthyRehearsalAt = healthyRehearsalTimes.sort((left, right) => right.getTime() - left.getTime())[0];
  const rehearsal = recoveryRehearsalFreshness({ checkpointCreatedAt: firstCheckpointAt, lastHealthyRehearsalAt, now: new Date() });
  if (!rehearsal.healthy) {
    throw Object.assign(new Error(`The latest remote checkpoint ${latest.deploymentId} has no current quarterly deployment/rollback rehearsal.`), { code: 'DEPLOYMENT_REHEARSAL_OVERDUE' });
  }
  console.log(JSON.stringify({ ok: true, checkpoint: latest.deploymentId, decision, rehearsal }));
};

main().catch((error: any) => {
  console.error(JSON.stringify({ ok: false, code: error?.code || 'DEPLOYMENT_DRILL_PREFLIGHT_FAILED', message: error?.message }));
  process.exitCode = 1;
});
