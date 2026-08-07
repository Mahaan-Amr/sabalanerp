import { createHash } from 'node:crypto';

export type BiometricOperation = 'HEALTH' | 'CAPTURE' | 'VERIFY' | 'CANCEL';
export type SimulatorScenario = 'SUCCESS' | 'POOR_QUALITY' | 'LIVENESS_FAILURE' | 'NON_MATCH' | 'WRONG_DRIVER' | 'DISCONNECT' | 'TIMEOUT' | 'RETRY' | 'RECOVERY' | 'LICENSING_FAILURE';
export type ConnectorErrorCategory = 'NONE' | 'POOR_CAPTURE_QUALITY' | 'LIVENESS_FAILED' | 'NO_MATCH' | 'WRONG_DRIVER' | 'DEVICE_DISCONNECTED' | 'CAPTURE_TIMEOUT' | 'RETRYABLE_CONNECTOR_ERROR' | 'SDK_LICENSE_INVALID' | 'ATTEMPT_SEQUENCE_INVALID' | 'INVALID_COMMAND';

export interface BiometricCommand {
  commandId: string;
  nonce: string;
  workstationId: string;
  issuedAt: string;
  expiresAt: string;
  operation: BiometricOperation;
  payload: Record<string, unknown> & {
    challengeId?: string;
    expectedDriverId?: string;
    templateReference?: string;
    simulation?: { scenario: SimulatorScenario | string; attempt?: number };
  };
}

export interface SignedBiometricCommand { command: BiometricCommand; signature: string }

export interface BiometricConnectorResult {
  commandId: string;
  operation: BiometricOperation;
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  device: { model: string; serial: string; connectorVersion: string; sdkVersion: string };
  captureQuality: { state: 'ACCEPTED' | 'REJECTED' | 'NOT_EVALUATED'; score?: number };
  liveness: { state: 'LIVE' | 'NOT_LIVE' | 'NOT_EVALUATED'; score?: number };
  match: { state: 'MATCH' | 'NO_MATCH' | 'NOT_EVALUATED'; score?: number };
  fallback: { goodQualityLiveNonMatchCount: number; eligible: boolean };
  errorCategory: ConnectorErrorCategory;
  retryable: boolean;
  recoveredFrom?: ConnectorErrorCategory;
}

export interface BiometricConnector { execute(command: BiometricCommand): Promise<BiometricConnectorResult> }

export const canonicalizeBiometricValue = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeBiometricValue).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalizeBiometricValue(record[key])}`).join(',')}}`;
};

export const digestBiometricValue = (value: unknown) => createHash('sha256').update(canonicalizeBiometricValue(value)).digest('hex');

const allowedPayloadKeys: Record<BiometricOperation, ReadonlySet<string>> = {
  HEALTH: new Set(['simulation']),
  CAPTURE: new Set(['challengeId', 'simulation']),
  VERIFY: new Set(['challengeId', 'expectedDriverId', 'templateReference', 'simulation']),
  CANCEL: new Set(['challengeId']),
};
const requiredPayloadKeys: Record<BiometricOperation, readonly string[]> = {
  HEALTH: [], CAPTURE: ['challengeId'], VERIFY: ['challengeId', 'expectedDriverId', 'templateReference'], CANCEL: ['challengeId'],
};
const forbiddenKey = /(raw.?image|fingerprint.?image|sample|blob|base64|probe|template.?material)/i;
const safeIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const base64LikeMaterial = /^(?:[A-Za-z0-9+/]{4}){16,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const scenarios = new Set<SimulatorScenario>(['SUCCESS', 'POOR_QUALITY', 'LIVENESS_FAILURE', 'NON_MATCH', 'WRONG_DRIVER', 'DISCONNECT', 'TIMEOUT', 'RETRY', 'RECOVERY', 'LICENSING_FAILURE']);

const assertSafeValue = (key: string, value: unknown) => {
  if (forbiddenKey.test(key)) throw new Error(`Biometric command payload contains forbidden field: ${key}`);
  if (typeof value === 'string' && value.length >= 64 && base64LikeMaterial.test(value)) throw new Error(`Biometric command payload contains base64-like material: ${key}`);
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) throw new Error(`Biometric command payload arrays are not allowed: ${key}`);
    Object.entries(value as Record<string, unknown>).forEach(([nestedKey, nestedValue]) => assertSafeValue(nestedKey, nestedValue));
  }
};

export const assertValidBiometricCommandPayload = (command: BiometricCommand) => {
  if (!Object.prototype.hasOwnProperty.call(allowedPayloadKeys, command.operation)) throw new Error('Biometric command payload has an invalid operation');
  const keys = Object.keys(command.payload);
  for (const key of keys) {
    assertSafeValue(key, command.payload[key]);
    if (!allowedPayloadKeys[command.operation].has(key)) throw new Error(`Biometric command payload field is not allowed for ${command.operation}: ${key}`);
  }
  for (const required of requiredPayloadKeys[command.operation]) {
    const value = command.payload[required];
    if (typeof value !== 'string' || !safeIdentifier.test(value)) throw new Error(`Biometric command payload requires a safe ${required}`);
  }
  const simulation = command.payload.simulation;
  if (simulation !== undefined) {
    if (!simulation || typeof simulation !== 'object' || Array.isArray(simulation)) throw new Error('Biometric command payload simulation is invalid');
    const simulationKeys = Object.keys(simulation);
    if (simulationKeys.some((key) => !['scenario', 'attempt'].includes(key))) throw new Error('Biometric command payload simulation contains an unknown field');
    if (!scenarios.has(simulation.scenario as SimulatorScenario)) throw new Error('Biometric command payload simulation scenario is invalid');
    if (simulation.attempt !== undefined && (!Number.isInteger(simulation.attempt) || Number(simulation.attempt) < 1 || Number(simulation.attempt) > 10)) throw new Error('Biometric command payload simulation attempt is invalid');
  }
};
