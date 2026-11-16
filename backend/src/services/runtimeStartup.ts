export type BackendRuntimeRole = 'standalone';

export function resolveRuntimeRole(value: string | undefined): BackendRuntimeRole {
  if (value === undefined || value === '' || value === 'standalone') return 'standalone';
  throw new Error('BACKEND_RUNTIME_ROLE_INVALID');
}

export async function startRuntime(role: BackendRuntimeRole, operations: {
  assertControlOwnership: () => void;
  initializeRecovery: () => Promise<void>;
  verifyCutover: () => Promise<void>;
  startWorkers: () => void | Promise<void>;
  listen: () => void;
}) {
  operations.assertControlOwnership();
  await operations.initializeRecovery();
  await operations.verifyCutover();
  await operations.startWorkers();
  operations.listen();
}
