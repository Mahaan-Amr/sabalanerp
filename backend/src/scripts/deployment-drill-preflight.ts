import fs from 'node:fs';
import path from 'node:path';
import { recoveryDrillFreshness, recoveryRehearsalFreshness } from '../services/deploymentDrillPolicy';

type Metadata = {
  deploymentId: string;
  createdAt: string;
  remoteVerified: boolean;
  lastDrill?: { status?: string; completedAt?: string };
  lastRehearsal?: { status?: string; completedAt?: string };
};

const findMetadata = async (root: string): Promise<string[]> => {
  const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await findMetadata(absolute));
    else if (entry.isFile() && entry.name.endsWith('.sabrec.json')) files.push(absolute);
  }
  return files;
};

const main = async () => {
  const root = String(process.env.DEPLOYMENT_REMOTE_MOUNT || '').trim();
  if (!root) throw Object.assign(new Error('DEPLOYMENT_REMOTE_MOUNT is required.'), { code: 'DEPLOYMENT_CONFIGURATION_MISSING' });
  const metadata: Metadata[] = [];
  for (const file of await findMetadata(root)) {
    try {
      const item = JSON.parse(await fs.promises.readFile(file, 'utf8')) as Metadata;
      if (item.remoteVerified && item.createdAt) metadata.push(item);
    } catch {
      // An unreadable sidecar cannot be treated as healthy.
    }
  }
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
