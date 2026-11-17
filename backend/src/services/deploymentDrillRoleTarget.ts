import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

type RecoveryHost = { machineUuidSha256: string; kernelBootIdSha256: string };
type DatabaseIdentity = { name: string; oid: string; systemIdentifier: string };
type Source = {
  id: string;
  checksum: string;
  size: number;
  sourceDatabase?: DatabaseIdentity;
};

export type RoleDrillTarget = {
  format: 'sabalan-independent-role-drill-target/v1';
  checkpointId: string;
  ciphertextSha256: string;
  ciphertextSize: number;
  snapshotSha256: string;
  sourceDatabase: DatabaseIdentity;
  recoveryHost: RecoveryHost;
  targetDatabase: DatabaseIdentity & { owner: string };
};

function unproven(): never {
  throw Object.assign(new Error('The independent role recovery target is unproven.'), {
    code: 'DEPLOYMENT_DRILL_ROLE_TARGET_UNPROVEN',
  });
}

const oid = (value: unknown) => typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
const sha = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export async function loadRoleDrillTarget(source: Source, snapshotSha256: string, host: RecoveryHost) {
  const targetPath = process.env.DEPLOYMENT_DRILL_ROLE_TARGET_FILE;
  const sha256 = process.env.DEPLOYMENT_DRILL_ROLE_TARGET_SHA256;
  if (process.platform !== 'linux' || !targetPath || !path.isAbsolute(targetPath) || !sha(sha256) || !sha(snapshotSha256)) return unproven();

  const file = await fs.promises.open(targetPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  let bytes: Buffer;
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > 16_384n || before.uid !== BigInt(process.getuid!())
      || (before.mode & 0o777n) !== 0o400n) return unproven();
    bytes = await file.readFile();
    const after = await file.stat({ bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
      || createHash('sha256').update(bytes).digest('hex') !== sha256) return unproven();
  } finally {
    await file.close();
  }

  const plan = JSON.parse(bytes.toString('utf8')) as RoleDrillTarget;
  const target = plan?.targetDatabase;
  if (plan?.format !== 'sabalan-independent-role-drill-target/v1' || plan.checkpointId !== source.id
    || plan.ciphertextSha256 !== source.checksum || plan.ciphertextSize !== source.size
    || plan.snapshotSha256 !== snapshotSha256
    || typeof source.sourceDatabase?.name !== 'string' || !source.sourceDatabase.name
    || plan.sourceDatabase?.name !== source.sourceDatabase.name
    || !oid(plan.sourceDatabase.oid) || plan.sourceDatabase.oid !== source.sourceDatabase.oid
    || !oid(plan.sourceDatabase.systemIdentifier) || plan.sourceDatabase.systemIdentifier !== source.sourceDatabase.systemIdentifier
    || plan.recoveryHost?.machineUuidSha256 !== host.machineUuidSha256
    || plan.recoveryHost?.kernelBootIdSha256 !== host.kernelBootIdSha256
    || typeof target?.name !== 'string' || !target.name || target.name === 'postgres'
    || typeof target?.owner !== 'string' || !target.owner || !oid(target.oid)
    || !oid(target.systemIdentifier) || target.systemIdentifier === plan.sourceDatabase.systemIdentifier) return unproven();

  return { plan, sha256: sha256! };
}

export function assertRoleDrillDatabase(plan: RoleDrillTarget, actual: RoleDrillTarget['targetDatabase'] & {
  admitted: boolean; controlSchemaAvailable: boolean;
}, promoted = false) {
  const target = plan.targetDatabase;
  if (!actual?.admitted || !actual.controlSchemaAvailable || actual.name !== target.name || actual.owner !== target.owner
    || actual.systemIdentifier !== target.systemIdentifier || !oid(actual.oid)
    || (promoted ? actual.oid === target.oid : actual.oid !== target.oid)) return unproven();
}
