import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { canonicalPerformanceEvidence as canonical } from './performance-evidence-canonical.mjs';

const acceptableKeyId = (value) => typeof value === 'string' && Boolean(value.trim())
  && !/^(change|replace|example|placeholder|local|test|fixture)/i.test(value);

const privateKeyFromEnvironment = (environment, idName, keyName) => {
  const keyId = environment[idName]?.trim() ?? '';
  const encoded = environment[keyName]?.trim() ?? '';
  if (!keyId || /^(change|replace|example|placeholder|local|test|fixture)/i.test(keyId) || !encoded) return null;
  try {
    const der = Buffer.from(encoded, 'base64');
    if (der.toString('base64') !== encoded.replace(/\s/g, '')) return null;
    const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    return privateKey.asymmetricKeyType === 'ed25519' ? { keyId, privateKey } : null;
  } catch {
    return null;
  }
};

const publicKeyFromEnvironment = (environment, idName, keyName) => {
  const keyId = environment[idName]?.trim() ?? '';
  const encoded = environment[keyName]?.trim() ?? '';
  if (!acceptableKeyId(keyId) || !encoded) return null;
  try {
    const der = Buffer.from(encoded, 'base64');
    if (der.toString('base64') !== encoded.replace(/\s/g, '')) return null;
    const publicKey = createPublicKey({ key: der, format: 'der', type: 'spki' });
    return publicKey.asymmetricKeyType === 'ed25519' ? { keyId, publicKey } : null;
  } catch {
    return null;
  }
};

export const performanceMeasurementSignerFromEnvironment = (environment = process.env) => privateKeyFromEnvironment(environment,
  'PERFORMANCE_MEASUREMENT_ATTESTATION_KEY_ID', 'PERFORMANCE_MEASUREMENT_ATTESTATION_PRIVATE_KEY_BASE64');

export const performanceAcceptanceTrustFromEnvironment = (environment = process.env) => ({
  measurementPublicKey: publicKeyFromEnvironment(environment,
    'PERFORMANCE_MEASUREMENT_ATTESTATION_KEY_ID', 'PERFORMANCE_MEASUREMENT_ATTESTATION_PUBLIC_KEY_BASE64'),
  candidatePublicKey: publicKeyFromEnvironment(environment,
    'PERFORMANCE_CANDIDATE_ATTESTATION_KEY_ID', 'PERFORMANCE_CANDIDATE_ATTESTATION_PUBLIC_KEY_BASE64'),
  handoffSigner: privateKeyFromEnvironment(environment,
    'PERFORMANCE_HANDOFF_ATTESTATION_KEY_ID', 'PERFORMANCE_HANDOFF_ATTESTATION_PRIVATE_KEY_BASE64'),
});

export const signedPerformanceAcceptanceLane = ({ lane, identity, command, durationMs, rawEvidence, measurements, signer }) => {
  const unsigned = {
    schemaVersion: 1,
    contract: 'PERSONNEL_PERFORMANCE_ACCEPTANCE_LANE_V1',
    lane,
    status: 'PASS',
    productionActivationAuthorized: false,
    candidateIdentityHash: createHash('sha256').update(canonical(identity)).digest('hex'),
    observedAt: new Date().toISOString(),
    durationMs,
    command,
    rawEvidenceHash: createHash('sha256').update(rawEvidence).digest('hex'),
    measurements,
  };
  return { ...unsigned, measurementAttestation: {
    keyId: signer.keyId,
    algorithm: 'Ed25519',
    signature: sign(null, Buffer.from(canonical(unsigned)), signer.privateKey).toString('base64'),
  } };
};
