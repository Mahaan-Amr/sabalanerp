export type BackendRuntimeRole = 'standalone' | 'candidate';

export function resolveRuntimeRole(value: string | undefined): BackendRuntimeRole {
  if (value === undefined || value === '' || value === 'standalone') return 'standalone';
  if (value === 'candidate') return value;
  throw new Error('BACKEND_RUNTIME_ROLE_INVALID');
}

export async function startRuntime(role: BackendRuntimeRole, operations: {
  assertControlOwnership: () => void;
  initializeRecovery: () => Promise<void>;
  verifyCutover: () => Promise<void>;
  startWorkers: () => void;
  listen: () => void;
}) {
  if (role === 'standalone') {
    operations.assertControlOwnership();
    await operations.initializeRecovery();
    await operations.verifyCutover();
    operations.startWorkers();
  }
  operations.listen();
}
