import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { canonicalPerformanceEvidence as canonical } from './performance-evidence-canonical.mjs';

const services = Object.freeze(['backend', 'frontend', 'inquiry']);
const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex');

const defaultCommand = (name, args) => execFileSync(name, args, {
  encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

export const capturePerformanceRuntimeSourceBinding = ({ commit, sourceHash, command = defaultCommand }) => {
  const images = {};
  const runtimeImageLabels = {};
  for (const service of services) {
    const container = `sabalanerp-local-${service}-1`;
    images[service] = command('docker', ['inspect', '--format', '{{.Image}}', container]);
    runtimeImageLabels[service] = {
      commit: command('docker', ['inspect', '--format', '{{ index .Config.Labels "io.sabalan.performance.source-commit" }}', container]),
      sourceHash: command('docker', ['inspect', '--format', '{{ index .Config.Labels "io.sabalan.performance.source-hash" }}', container]),
    };
  }
  const validImages = Object.values(images).every((image) => /^sha256:[a-f0-9]{64}$/.test(image));
  const labelsMatch = Object.values(runtimeImageLabels).every((labels) => labels.commit === commit
    && labels.sourceHash === sourceHash);
  if (!validImages || !labelsMatch) throw new Error('RUNTIME_SOURCE_BINDING_UNPROVEN');
  const proof = { commit, sourceHash, images, runtimeImageLabels };
  return { images, runtimeImageLabels, runtimeSourceBinding: {
    status: 'LIVE_IMAGE_IDENTITIES_MATCH_SOURCE', evidenceHash: digest(proof),
  } };
};

export const verifyPerformanceRuntimeSourceBinding = (reported, current) => {
  const captured = capturePerformanceRuntimeSourceBinding(current);
  if (canonical(reported.images) !== canonical(captured.images)
    || canonical(reported.runtimeImageLabels) !== canonical(captured.runtimeImageLabels)
    || canonical(reported.runtimeSourceBinding) !== canonical(captured.runtimeSourceBinding)) {
    throw new Error('RUNTIME_SOURCE_BINDING_CHANGED');
  }
  return captured;
};
