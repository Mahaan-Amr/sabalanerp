import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseComposeStatus } from '../../../scripts/design-system-e2e-preflight.mjs';

export const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const interfaceVersion = 'partner-qa-harness/v1';

export function localTarget(env = process.env) {
  for (const key of ['DATABASE_URL', 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSERVICE', 'PGOPTIONS', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'COMPOSE_FILE']) {
    if (env[key]) throw new Error(`Partner QA refuses inherited ${key}; use only sabalanerp-local.`);
  }
  if (env.NODE_ENV === 'production' || (env.COMPOSE_PROJECT_NAME && env.COMPOSE_PROJECT_NAME !== 'sabalanerp-local')) {
    throw new Error('Partner QA refuses production or an alternate Compose project.');
  }
  const frontend = env.PARTNER_QA_URL || 'http://127.0.0.1:3000';
  if (frontend !== 'http://127.0.0.1:3000') throw new Error('Partner QA frontend must be http://127.0.0.1:3000.');
  return { frontend, backend: 'http://127.0.0.1:5000', database: 'sabalanerp' };
}

export function validateRuntime(runtime) {
  if (runtime.project !== 'sabalanerp-local' || !['development', 'test'].includes(runtime.nodeEnv)
    || runtime.databaseHost !== 'postgres' || runtime.databaseName !== 'sabalanerp'
    || runtime.smsEnvironment !== 'sandbox' || runtime.smsCredentialsPresent !== false) {
    throw new Error('Partner QA requires sabalanerp-local with its original database and credential-free SMS sandbox.');
  }
  return runtime;
}

export function validateNamespace(value) {
  if (!/^partner-qa-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value || '')) {
    throw new Error('Invalid Partner QA namespace.');
  }
  return value;
}

function docker(args) {
  const result = spawnSync('docker', args, { cwd: repositoryRoot, encoding: 'utf8', timeout: 30_000, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('Partner QA Docker inspection failed; verify the existing local stack.');
  return result.stdout.trim();
}

const compose = ['compose', '-f', 'docker-compose.local.yml'];
function status() {
  const services = parseComposeStatus(docker([...compose, 'ps', '--format', 'json']));
  for (const [name, port] of [['backend', 5000], ['frontend', 3000], ['postgres', 55432], ['redis', 56379]]) {
    const service = services.find((item) => item.Service === name);
    if (!service || service.Project !== 'sabalanerp-local' || service.State !== 'running' || service.Health !== 'healthy'
      || !service.Publishers?.some((item) => item.URL === '127.0.0.1' && item.PublishedPort === port)) {
      throw new Error(`Partner QA requires healthy sabalanerp-local ${name} on its fixed loopback port.`);
    }
  }
  return services.map(({ Service, ID, Image }) => ({ service: Service, container: ID, image: Image }));
}

export async function preflight() {
  const target = localTarget();
  // Verify before every other Docker action, including context inspection and exec.
  status();
  const context = JSON.parse(docker(['context', 'inspect']));
  const endpoint = context[0]?.Endpoints?.docker?.Host || '';
  if (!endpoint.startsWith('npipe://') && !endpoint.startsWith('unix://')) throw new Error('Partner QA refuses a remote Docker context.');
  const services = status();
  const runtime = JSON.parse(docker([...compose, 'exec', '-T', 'backend', 'node', '-e', `
    require('dotenv/config');
    const db = new URL(process.env.DATABASE_URL);
    console.log(JSON.stringify({
      project: 'sabalanerp-local', nodeEnv: process.env.NODE_ENV,
      databaseHost: db.hostname, databaseName: db.pathname.slice(1),
      smsEnvironment: process.env.SMS_IR_ENVIRONMENT,
      smsCredentialsPresent: Object.entries(process.env).some(([key,value]) => /SMS.*(KEY|TOKEN|SECRET|PASSWORD)/i.test(key) && Boolean(value))
    }));
  `]));
  validateRuntime(runtime);
  for (const url of [`${target.backend}/api/ready`, `${target.frontend}/login`]) {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('Partner QA local HTTP readiness failed.');
  }
  return { target, runtime, services };
}

// Execute only harness-owned SQL through the verified service; no host DATABASE_URL.
export async function localSql(sql) {
  await preflight();
  status();
  const result = spawnSync('docker', [...compose, 'exec', '-T', 'postgres', 'psql', '-h', '/var/run/postgresql', '-p', '5432', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'sabalanerp'], {
    cwd: repositoryRoot, input: sql, encoding: 'utf8', timeout: 30_000, windowsHide: true,
  });
  // SQL or server errors can contain row contents; never print them into CI logs.
  if (result.error || result.status !== 0) throw new Error('Partner QA database operation refused or failed; no SQL payload was logged.');
  return result.stdout.trim();
}
