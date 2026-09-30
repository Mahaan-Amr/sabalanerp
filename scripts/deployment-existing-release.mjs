import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateReleaseEnvironment } from './performance-deployment-environment.mjs';

const services = ['backend', 'frontend', 'inquiry', 'nginx', 'postgres', 'clamav'];
export function existingRelease(containers) {
  const images = {};
  let identity;
  for (const service of services) {
    const matches = containers.filter(c => c.Config?.Labels?.['com.docker.compose.service'] === service);
    if (matches.length !== 1) throw new Error(`Existing release requires exactly one ${service} container.`);
    const container = matches[0];
    if (!container.State?.Running || container.State?.Health?.Status !== 'healthy') {
      throw new Error(`Existing release ${service} must be running and healthy.`);
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(container.Image)) throw new Error(`Existing ${service} image is not immutable.`);
    images[service] = container.Image;
    if (service === 'backend') {
      const environment = Object.fromEntries(container.Config.Env.map(entry => {
        const split = entry.indexOf('='); return [entry.slice(0, split), entry.slice(split + 1)];
      }));
      identity = validateReleaseEnvironment(Object.fromEntries(Object.entries(environment).filter(([key]) => key.startsWith('PERFORMANCE_RELEASE_') || key === 'PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH')));
      if (Object.values(identity).some(value => !value)) throw new Error('Existing release identity is incomplete.');
    }
  }
  for (const service of ['backend', 'frontend', 'inquiry']) {
    if (identity[`PERFORMANCE_RELEASE_${service.toUpperCase()}_IMAGE`] !== images[service]) {
      throw new Error(`Existing ${service} image disagrees with recorded release identity.`);
    }
  }
  return { images, identity };
}

export function releaseExports(release) {
  const environment = {
    ...release.identity,
    DEPLOYMENT_TARGET_COMMIT: release.identity.PERFORMANCE_RELEASE_COMMIT,
    ...Object.fromEntries(Object.entries(release.images).map(([service, image]) => [`DEPLOYMENT_${service.toUpperCase()}_IMAGE`, image])),
  };
  // Every value has been validated as a commit, digest or hash; no secrets or shell syntax.
  return Object.entries(environment).map(([key, value]) => `export ${key}='${value}'`).join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(releaseExports(existingRelease(JSON.parse(fs.readFileSync(0, 'utf8')))));
}
