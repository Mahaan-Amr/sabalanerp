import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { assertValidBiometricCommandPayload, BiometricConnector, BiometricConnectorResult, digestBiometricValue, SignedBiometricCommand } from './biometricProtocol';
import { assertBiometricCommandSignature } from './biometricSigning';

type JournalState = 'IN_FLIGHT' | 'COMPLETED' | 'INTERRUPTED';
interface JournalRecord { commandId: string; nonceHash: string; requestHash: string; state: JournalState; response?: BiometricConnectorResult | unknown }
type Reservation = { state: 'RESERVED' } | { state: 'IN_FLIGHT' } | { state: 'INTERRUPTED' } | { state: 'COMPLETED'; response: BiometricConnectorResult };

export class BiometricCommandJournal {
  private records = new Map<string, JournalRecord>();

  constructor(private readonly path: string) {
    if (!existsSync(path)) return;
    const stored = JSON.parse(readFileSync(path, 'utf8')) as Array<Partial<JournalRecord> & { commandId: string; nonceHash: string; requestHash: string }>;
    let recovered = false;
    stored.forEach((record) => {
      const state: JournalState = record.state || (record.response === undefined ? 'INTERRUPTED' : 'COMPLETED');
      const normalized = { ...record, state: state === 'IN_FLIGHT' ? 'INTERRUPTED' : state } as JournalRecord;
      if (state === 'IN_FLIGHT') recovered = true;
      this.records.set(normalized.commandId, normalized);
    });
    if (recovered) this.persist();
  }

  find(commandId: string) { return this.records.get(commandId); }

  reserve(input: { commandId: string; nonceHash: string; requestHash: string }): Reservation {
    const existing = this.records.get(input.commandId);
    if (existing) {
      if (existing.requestHash !== input.requestHash) throw new Error('Idempotency key was reused with a different command');
      if (existing.state === 'COMPLETED') return { state: 'COMPLETED', response: existing.response as BiometricConnectorResult };
      return { state: existing.state };
    }
    if ([...this.records.values()].some((record) => record.nonceHash === input.nonceHash)) throw new Error('Connector command replay detected');
    this.records.set(input.commandId, { ...input, state: 'IN_FLIGHT' });
    this.persist();
    return { state: 'RESERVED' };
  }

  complete(commandId: string, response: BiometricConnectorResult | unknown) {
    const record = this.records.get(commandId);
    if (!record || record.state !== 'IN_FLIGHT') throw new Error('Connector command has no active reservation');
    this.records.set(commandId, { ...record, state: 'COMPLETED', response });
    this.persist();
  }

  interrupt(commandId: string) {
    const record = this.records.get(commandId);
    if (!record || record.state !== 'IN_FLIGHT') return;
    this.records.set(commandId, { ...record, state: 'INTERRUPTED' });
    this.persist();
  }

  private persist() {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify([...this.records.values()]), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporaryPath, this.path);
  }
}

export class AuthenticatedBiometricConnector {
  constructor(private readonly options: { secret: string; workstationId: string; connector: BiometricConnector; journal: BiometricCommandJournal; now?: () => Date }) {
    if (Buffer.byteLength(options.secret, 'utf8') < 32) throw new Error('Connector authentication secret must be at least 32 bytes');
  }

  async execute(signed: SignedBiometricCommand): Promise<BiometricConnectorResult> {
    assertBiometricCommandSignature(signed, this.options.secret);
    const now = (this.options.now || (() => new Date()))().getTime();
    const issuedAt = Date.parse(signed.command.issuedAt);
    const expiresAt = Date.parse(signed.command.expiresAt);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) throw new Error('Connector command timestamp is invalid');
    if (expiresAt - issuedAt > 60_000) throw new Error('Connector command validity window exceeds 60 seconds');
    if (issuedAt > now + 30_000 || expiresAt < now) throw new Error('Connector command is expired or not yet valid');
    if (signed.command.workstationId !== this.options.workstationId) throw new Error('Connector command targets another workstation');
    assertValidBiometricCommandPayload(signed.command);

    const reservation = this.options.journal.reserve({ commandId: signed.command.commandId, nonceHash: digestBiometricValue(signed.command.nonce), requestHash: digestBiometricValue(signed.command) });
    if (reservation.state === 'COMPLETED') return reservation.response;
    if (reservation.state === 'IN_FLIGHT') throw new Error('Connector command is already in progress');
    if (reservation.state === 'INTERRUPTED') throw new Error('Connector command was interrupted after reservation; outcome is unknown and automatic replay is forbidden');

    try {
      const response = await this.options.connector.execute(signed.command);
      this.options.journal.complete(signed.command.commandId, response);
      return response;
    } catch (error) {
      this.options.journal.interrupt(signed.command.commandId);
      throw error;
    }
  }
}
