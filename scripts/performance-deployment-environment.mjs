import fs from 'node:fs';

export const releaseEnvironmentKeys = [
  'PERFORMANCE_RELEASE_COMMIT', 'PERFORMANCE_RELEASE_SOURCE_HASH',
  'PERFORMANCE_RELEASE_SCHEMA_HASH', 'PERFORMANCE_RELEASE_POLICY_HASH',
  'PERFORMANCE_RELEASE_INFRASTRUCTURE_HASH', 'PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH',
  'PERFORMANCE_RELEASE_BACKEND_IMAGE', 'PERFORMANCE_RELEASE_FRONTEND_IMAGE',
  'PERFORMANCE_RELEASE_INQUIRY_IMAGE',
];

export const validateReleaseEnvironment = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid rollback runtime identity.');
  if (Object.keys(input).some((key) => !releaseEnvironmentKeys.includes(key))) throw new Error('Unexpected rollback identity field.');
  return Object.fromEntries(releaseEnvironmentKeys.map((key) => {
    const value = input[key] ?? '';
    const pattern = key.endsWith('_COMMIT') ? /^[a-f0-9]{40}$/
      : key.endsWith('_IMAGE') ? /^sha256:[a-f0-9]{64}$/ : /^[a-f0-9]{64}$/;
    if (typeof value !== 'string' || (value && !pattern.test(value))) throw new Error(`Invalid rollback identity: ${key}`);
    return [key, value];
  }));
};

if (process.argv[2] === 'capture') {
  const [container] = JSON.parse(fs.readFileSync(0, 'utf8'));
  const entries = (container.Config.Env ?? []).map((entry) => {
    const split = entry.indexOf('=');
    return [entry.slice(0, split), entry.slice(split + 1)];
  }).filter(([key]) => releaseEnvironmentKeys.includes(key));
  process.stdout.write(JSON.stringify(validateReleaseEnvironment(Object.fromEntries(entries))));
} else if (process.argv[2] === 'restore') {
  const session = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  // Old journals predate runtime-identity capture. Their recovery behavior stays unchanged.
  if (session.rollbackPerformanceEnvironment !== undefined) {
    const environment = validateReleaseEnvironment(session.rollbackPerformanceEnvironment);
    for (const [key, value] of Object.entries(environment)) console.log(`export ${key}='${value}'`);
  }
}
