import { spawnSync } from 'node:child_process';

const REQUIRED_SERVICES = ['postgres', 'redis', 'backend', 'frontend'];

export const parseComposeStatus = (output) => {
  const trimmed = output.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) return JSON.parse(trimmed);
  return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
};

export const validateRequiredServices = (services) => {
  const failures = [];
  for (const required of REQUIRED_SERVICES) {
    const service = services.find((candidate) => candidate.Service === required);
    if (!service) {
      failures.push(`${required}: missing`);
      continue;
    }
    const state = String(service.State || '').toLowerCase();
    const health = String(service.Health || '').toLowerCase();
    if (state !== 'running' || (health && health !== 'healthy')) {
      failures.push(`${required}: ${state || 'unknown'}${health ? `/${health}` : ''}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `sabalanerp-local is not ready (${failures.join(', ')}). `
      + 'Start Docker Desktop, then run npm run docker:local:up and retry.'
    );
  }
};

export const inspectLocalComposeProject = (repositoryRoot) => {
  const result = spawnSync(
    'docker',
    ['compose', '-f', 'docker-compose.local.yml', 'ps', '--format', 'json'],
    { cwd: repositoryRoot, encoding: 'utf8', shell: process.platform === 'win32' }
  );
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr.trim() || 'Docker Compose check failed';
    throw new Error(
      `Cannot inspect sabalanerp-local: ${detail}. `
      + 'Start Docker Desktop, then run npm run docker:local:up and retry.'
    );
  }
  const services = parseComposeStatus(result.stdout);
  validateRequiredServices(services);
  return services;
};

export const assertHttpReady = async (url, label) => {
  try {
    const response = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(
      `${label} is unavailable at ${url}: ${error instanceof Error ? error.message : String(error)}. `
      + 'Run npm run docker:verify before retrying.'
    );
  }
};
