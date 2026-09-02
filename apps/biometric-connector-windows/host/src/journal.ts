import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SignedConnectorResponse } from './protocol';

type JournalState = 'IN_FLIGHT' | 'INTERRUPTED' | 'COMPLETED';
interface JournalRecord {
  commandId: string;
  nonceHash: string;
  requestHash: string;
  state: JournalState;
  safeResponse?: SignedConnectorResponse;
}

export type Reservation =
  | { state: 'RESERVED' }
  | { state: 'IN_FLIGHT' | 'INTERRUPTED' | 'SENSITIVE_REPLAY' }
  | { state: 'COMPLETED'; response: SignedConnectorResponse };

export class CommandJournal {
  private records: JournalRecord[];

  constructor(private readonly path: string) {
    this.records = this.load();
    let changed = false;
    for (const record of this.records) if (record.state === 'IN_FLIGHT') { record.state = 'INTERRUPTED'; changed = true; }
    if (changed) this.persist();
  }

  reserve(input: Omit<JournalRecord, 'state' | 'safeResponse'>): Reservation {
    const nonceOwner = this.records.find((record) => record.nonceHash === input.nonceHash);
    if (nonceOwner && (nonceOwner.commandId !== input.commandId || nonceOwner.requestHash !== input.requestHash)) return { state: 'INTERRUPTED' };
    const existing = this.records.find((record) => record.commandId === input.commandId);
    if (existing) {
      if (existing.requestHash !== input.requestHash || existing.nonceHash !== input.nonceHash) return { state: 'INTERRUPTED' };
      if (existing.state === 'IN_FLIGHT') return { state: 'IN_FLIGHT' };
      if (existing.state === 'INTERRUPTED') return { state: 'INTERRUPTED' };
      return existing.safeResponse ? { state: 'COMPLETED', response: existing.safeResponse } : { state: 'SENSITIVE_REPLAY' };
    }
    this.records.push({ ...input, state: 'IN_FLIGHT' });
    this.persist();
    return { state: 'RESERVED' };
  }

  complete(commandId: string, safeResponse?: SignedConnectorResponse) {
    const record = this.records.find((item) => item.commandId === commandId);
    if (!record || record.state !== 'IN_FLIGHT') throw new Error('Journal command is not in flight');
    record.state = 'COMPLETED';
    record.safeResponse = safeResponse;
    this.persist();
  }

  interrupt(commandId: string) {
    const record = this.records.find((item) => item.commandId === commandId);
    if (record?.state === 'IN_FLIGHT') { record.state = 'INTERRUPTED'; this.persist(); }
  }

  private load(): JournalRecord[] {
    try {
      const value = JSON.parse(readFileSync(this.path, 'utf8'));
      if (!Array.isArray(value)) throw new Error('Connector journal is invalid');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private persist() {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.records), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.path);
  }
}
