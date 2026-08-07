import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type BiometricOperation = 'HEALTH' | 'CAPTURE' | 'VERIFY' | 'CANCEL';
export type SimulatorScenario = 'SUCCESS' | 'POOR_QUALITY' | 'LIVENESS_FAILURE' | 'NON_MATCH' | 'WRONG_DRIVER' | 'DISCONNECT' | 'TIMEOUT' | 'RETRY' | 'RECOVERY';
export type ConnectorErrorCategory = 'NONE' | 'POOR_CAPTURE_QUALITY' | 'LIVENESS_FAILED' | 'NO_MATCH' | 'WRONG_DRIVER' | 'DEVICE_DISCONNECTED' | 'CAPTURE_TIMEOUT' | 'RETRYABLE_CONNECTOR_ERROR' | 'INVALID_COMMAND';

export interface BiometricCommand {
  commandId: string;
  nonce: string;
  workstationId: string;
  issuedAt: string;
  expiresAt: string;
  operation: BiometricOperation;
  payload: {
    challengeId?: string;
    expectedDriverId?: string;
    templateReference?: string;
    simulation?: { scenario: SimulatorScenario | string; attempt?: number };
    [key: string]: unknown;
  };
}

export interface SignedBiometricCommand {
  command: BiometricCommand;
  signature: string;
}

export interface BiometricConnectorResult {
  commandId: string;
  operation: BiometricOperation;
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  device: { model: string; serial: string; connectorVersion: string; sdkVersion: string };
  captureQuality: { state: 'ACCEPTED' | 'REJECTED' | 'NOT_EVALUATED'; score?: number };
  liveness: { state: 'LIVE' | 'NOT_LIVE' | 'NOT_EVALUATED'; score?: number };
  match: { state: 'MATCH' | 'NO_MATCH' | 'NOT_EVALUATED'; score?: number };
  errorCategory: ConnectorErrorCategory;
  retryable: boolean;
  recoveredFrom?: ConnectorErrorCategory;
}

export interface BiometricConnector {
  execute(command: BiometricCommand): Promise<BiometricConnectorResult>;
}

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
};

const digest = (value: unknown) => createHash('sha256').update(canonicalize(value)).digest('hex');

export const signBiometricCommand = (command: BiometricCommand, secret: string): SignedBiometricCommand => ({
  command,
  signature: createHmac('sha256', secret).update(canonicalize(command)).digest('base64url'),
});

const baseResult = (command: BiometricCommand): BiometricConnectorResult => ({
  commandId: command.commandId,
  operation: command.operation,
  availability: 'AVAILABLE',
  device: {
    model: 'Sabalan deterministic simulator',
    serial: 'SIM-0001',
    connectorVersion: '1.0.0-simulator',
    sdkVersion: 'simulator-1',
  },
  captureQuality: { state: 'ACCEPTED', score: 82 },
  liveness: { state: 'LIVE', score: 91 },
  match: { state: command.operation === 'VERIFY' ? 'MATCH' : 'NOT_EVALUATED', ...(command.operation === 'VERIFY' ? { score: 96 } : {}) },
  errorCategory: 'NONE',
  retryable: false,
});

export class DeterministicBiometricSimulator implements BiometricConnector {
  async execute(command: BiometricCommand): Promise<BiometricConnectorResult> {
    const scenario = String(command.payload.simulation?.scenario || 'SUCCESS') as SimulatorScenario;
    const attempt = Number(command.payload.simulation?.attempt || 1);
    const result = baseResult(command);
    const unevaluated = () => {
      result.captureQuality = { state: 'NOT_EVALUATED' };
      result.liveness = { state: 'NOT_EVALUATED' };
      result.match = { state: 'NOT_EVALUATED' };
    };

    switch (scenario) {
      case 'POOR_QUALITY':
        result.captureQuality = { state: 'REJECTED', score: 18 };
        result.liveness = { state: 'NOT_EVALUATED' };
        result.match = { state: 'NOT_EVALUATED' };
        result.errorCategory = 'POOR_CAPTURE_QUALITY';
        result.retryable = true;
        break;
      case 'LIVENESS_FAILURE':
        result.liveness = { state: 'NOT_LIVE', score: 11 };
        result.match = { state: 'NOT_EVALUATED' };
        result.errorCategory = 'LIVENESS_FAILED';
        break;
      case 'NON_MATCH':
        result.match = { state: 'NO_MATCH', score: 12 };
        result.errorCategory = 'NO_MATCH';
        result.retryable = true;
        break;
      case 'WRONG_DRIVER':
        result.match = { state: 'NO_MATCH', score: 4 };
        result.errorCategory = 'WRONG_DRIVER';
        break;
      case 'DISCONNECT':
        result.availability = 'UNAVAILABLE';
        unevaluated();
        result.errorCategory = 'DEVICE_DISCONNECTED';
        result.retryable = true;
        break;
      case 'TIMEOUT':
        unevaluated();
        result.errorCategory = 'CAPTURE_TIMEOUT';
        result.retryable = true;
        break;
      case 'RETRY':
        if (attempt < 2) {
          unevaluated();
          result.errorCategory = 'RETRYABLE_CONNECTOR_ERROR';
          result.retryable = true;
        }
        break;
      case 'RECOVERY':
        result.recoveredFrom = 'DEVICE_DISCONNECTED';
        break;
      case 'SUCCESS':
        break;
      default:
        unevaluated();
        result.errorCategory = 'INVALID_COMMAND';
        break;
    }
    return result;
  }
}

export const readBiometricConnectorDiagnostics = async (
  connector: BiometricConnector,
  checkedAt = new Date(),
) => {
  const health = await connector.execute({
    commandId: `diagnostic-${checkedAt.getTime()}`,
    nonce: 'diagnostic-read-only',
    workstationId: 'server-diagnostic',
    issuedAt: checkedAt.toISOString(),
    expiresAt: checkedAt.toISOString(),
    operation: 'HEALTH',
    payload: {},
  });
  return {
    mode: 'SIMULATOR' as const,
    availability: health.availability,
    liveEnrollmentEnabled: false,
    checkedAt: checkedAt.toISOString(),
    device: health.device,
    supportedChecks: ['capture-quality', 'liveness', 'one-to-one-match', 'retry-recovery'] as const,
  };
};

interface JournalRecord {
  commandId: string;
  nonceHash: string;
  requestHash: string;
  response: unknown;
}

export class BiometricCommandJournal {
  private records = new Map<string, JournalRecord>();

  constructor(private readonly path: string) {
    if (!existsSync(path)) return;
    const stored = JSON.parse(readFileSync(path, 'utf8')) as JournalRecord[];
    stored.forEach((record) => this.records.set(record.commandId, record));
  }

  find(commandId: string) { return this.records.get(commandId); }
  hasNonce(nonceHash: string) { return [...this.records.values()].some((record) => record.nonceHash === nonceHash); }

  record(record: JournalRecord) {
    this.records.set(record.commandId, record);
    mkdirSync(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify([...this.records.values()]), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporaryPath, this.path);
  }
}

export class AuthenticatedBiometricConnector {
  constructor(private readonly options: {
    secret: string;
    workstationId: string;
    connector: BiometricConnector;
    journal: BiometricCommandJournal;
    now?: () => Date;
  }) {
    if (Buffer.byteLength(options.secret, 'utf8') < 32) throw new Error('Connector authentication secret must be at least 32 bytes');
  }

  async execute(signed: SignedBiometricCommand): Promise<BiometricConnectorResult> {
    const expected = signBiometricCommand(signed.command, this.options.secret).signature;
    const suppliedBytes = Buffer.from(signed.signature);
    const expectedBytes = Buffer.from(expected);
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) throw new Error('Invalid connector command signature');
    const now = (this.options.now || (() => new Date()))().getTime();
    const issuedAt = Date.parse(signed.command.issuedAt);
    const expiresAt = Date.parse(signed.command.expiresAt);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) throw new Error('Connector command timestamp is invalid');
    if (expiresAt - issuedAt > 60_000) throw new Error('Connector command validity window exceeds 60 seconds');
    if (issuedAt > now + 30_000 || expiresAt < now) throw new Error('Connector command is expired or not yet valid');
    if (signed.command.workstationId !== this.options.workstationId) throw new Error('Connector command targets another workstation');

    const requestHash = digest(signed.command);
    const existing = this.options.journal.find(signed.command.commandId);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new Error('Idempotency key was reused with a different command');
      return existing.response as BiometricConnectorResult;
    }
    const nonceHash = digest(signed.command.nonce);
    if (this.options.journal.hasNonce(nonceHash)) throw new Error('Connector command replay detected');

    const response = await this.options.connector.execute(signed.command);
    this.options.journal.record({ commandId: signed.command.commandId, nonceHash, requestHash, response });
    return response;
  }
}

export interface ProtectedTemplateEnvelope {
  version: 1;
  keyId: string;
  algorithm: 'AES-256-GCM';
  iv: string;
  ciphertext: string;
  authenticationTag: string;
}

interface TemplateContext { personnelId: string; finger: string; format: string }

export class ProtectedTemplateVault {
  constructor(private readonly keyring: { activeKeyId: string; keys: Record<string, Buffer> }) {}

  seal(material: Buffer, context: TemplateContext): ProtectedTemplateEnvelope {
    const key = this.keyring.keys[this.keyring.activeKeyId];
    if (!key || key.length !== 32) throw new Error('A 256-bit active biometric key is required');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(canonicalize(context)));
    const ciphertext = Buffer.concat([cipher.update(material), cipher.final()]);
    return { version: 1, keyId: this.keyring.activeKeyId, algorithm: 'AES-256-GCM', iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), authenticationTag: cipher.getAuthTag().toString('base64') };
  }

  open(envelope: ProtectedTemplateEnvelope, context: TemplateContext): Buffer {
    const key = this.keyring.keys[envelope.keyId];
    if (!key) throw new Error('Biometric template key is unavailable');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(canonicalize(context)));
    decipher.setAuthTag(Buffer.from(envelope.authenticationTag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
  }
}
