import fs from 'node:fs';
import path from 'node:path';

export type DeploymentMaintenanceState = {
  deploymentId: string;
  releaseId: string;
  message: string;
  activatedAt: string;
};

export const DEPLOYMENT_MAINTENANCE_FILE = 'deployment-maintenance.json';

const maintenancePath = (coordinationDir: string) => path.join(coordinationDir, DEPLOYMENT_MAINTENANCE_FILE);

export const deploymentMaintenanceActive = (coordinationDir: string) => fs.existsSync(maintenancePath(coordinationDir));

export const readDeploymentMaintenance = async (coordinationDir: string): Promise<DeploymentMaintenanceState | null> => {
  try {
    return JSON.parse(await fs.promises.readFile(maintenancePath(coordinationDir), 'utf8')) as DeploymentMaintenanceState;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};

export const activateDeploymentMaintenance = async (
  coordinationDir: string,
  input: { deploymentId: string; releaseId: string; message: string; activatedAt: Date },
) => {
  await fs.promises.mkdir(coordinationDir, { recursive: true });
  const existing = await readDeploymentMaintenance(coordinationDir);
  if (existing && existing.deploymentId !== input.deploymentId) {
    throw Object.assign(new Error('Another deployment owns the maintenance switch.'), { code: 'DEPLOYMENT_MAINTENANCE_ACTIVE' });
  }
  const state: DeploymentMaintenanceState = {
    deploymentId: input.deploymentId,
    releaseId: input.releaseId,
    message: input.message,
    activatedAt: input.activatedAt.toISOString(),
  };
  const target = maintenancePath(coordinationDir);
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.promises.writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await fs.promises.rename(temporary, target);
  return state;
};

export const deactivateDeploymentMaintenance = async (coordinationDir: string, deploymentId: string) => {
  const existing = await readDeploymentMaintenance(coordinationDir);
  if (!existing) return;
  if (existing.deploymentId !== deploymentId) {
    throw Object.assign(new Error('Deployment does not own the maintenance switch.'), { code: 'DEPLOYMENT_MAINTENANCE_NOT_OWNED' });
  }
  await fs.promises.rm(maintenancePath(coordinationDir), { force: true });
};
