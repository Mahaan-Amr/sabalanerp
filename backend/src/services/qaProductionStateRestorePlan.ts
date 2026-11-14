import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export type QaProductionStateRestorePlan = {
  format: 'sabalan-qa-production-state-restore/v1';
  qaOnly: true;
  qaTargetPlanSha256: string;
  checkpointId: string;
  databaseName: string;
  sourceObject: { path: string; sha256: string; size: number };
  sourceSidecar: { path: string; sha256: string };
  runSidecarPath: string;
  reportPath: string;
};

const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
const sha = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const inMount = (value: unknown, root: string) => typeof value === 'string' && path.posix.isAbsolute(value)
  && path.posix.normalize(value) === value && value.startsWith(`${root}/`) && !value.includes('//');

/** This receipt is deliberately ineligible for independent drill or retention admission. */
export function assertQaProductionStateRestorePlan(
  untrustedPlan: unknown, source: Record<string, unknown>, run: Record<string, unknown>,
): asserts untrustedPlan is QaProductionStateRestorePlan {
  const plan = untrustedPlan as Partial<QaProductionStateRestorePlan>;
  const sourceObject = plan?.sourceObject;
  const sourceSidecar = plan?.sourceSidecar;
  if (!sourceObject || !sourceSidecar) throw Object.assign(new Error('QA_RESTORE_PLAN_INVALID'), { code: 'QA_RESTORE_PLAN_INVALID' });
  if (!plan || plan.format !== 'sabalan-qa-production-state-restore/v1' || plan.qaOnly !== true
    || !/^deploy-[a-zA-Z0-9-]+-release$/.test(plan.checkpointId || '')
    || !/^(sabalanerp|sabalanerp_qa_[a-z0-9_]+)$/.test(plan.databaseName || '')
    || !sha(plan.qaTargetPlanSha256)
    || !inMount(sourceObject.path, '/qa-checkpoint')
    || sourceObject.path !== `/qa-checkpoint/${plan.checkpointId}.sabrec`
    || !inMount(sourceSidecar.path, '/qa-checkpoint')
    || sourceSidecar.path !== `${sourceObject.path}.json`
    || !inMount(plan.runSidecarPath, '/qa-evidence')
    || !inMount(plan.reportPath, '/qa-evidence')
    || plan.runSidecarPath === plan.reportPath
    || !sha(sourceObject.sha256) || !sha(sourceSidecar.sha256)
    || !Number.isSafeInteger(sourceObject.size) || sourceObject.size < 1) fail('QA_RESTORE_PLAN_INVALID');
  if (source.independentRestoreVerified === true || run.independentRestoreVerified === true
    || (source.lastDrill != null) || (run.lastDrill != null)) fail('QA_RESTORE_DRILL_ELIGIBILITY_FORBIDDEN');
  if (source.id !== plan.checkpointId || source.deploymentId !== plan.checkpointId
    || typeof source.releaseId !== 'string' || !source.releaseId
    || source.remoteVerified !== true || source.checksum !== sourceObject.sha256
    || source.size !== sourceObject.size
    || !sha(source.sourceMachineUuidSha256) || !sha(source.sourceKernelBootIdSha256)) fail('QA_RESTORE_SOURCE_INVALID');
  const intended = { ...source, remotePath: sourceObject.path };
  if (!isDeepStrictEqual(run, intended)) fail('QA_RESTORE_SIDECAR_CHANGED');
}
