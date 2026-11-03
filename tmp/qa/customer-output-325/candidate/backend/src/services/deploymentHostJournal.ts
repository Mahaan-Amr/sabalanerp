import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type HostJournalEntry = {
  sequence: number;
  at: string;
  deploymentId: string;
  phase: string;
  event: string;
  previousHash: string | null;
  hash: string;
  details?: Record<string, unknown>;
};

const digest = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

const readEntries = async (journalPath: string): Promise<HostJournalEntry[]> => {
  try {
    return (await fs.promises.readFile(journalPath, 'utf8'))
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as HostJournalEntry);
  } catch (error: any) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
};

export const validateDeploymentHostJournal = async (journalPath: string) => {
  const entries = await readEntries(journalPath);
  let previousHash: string | null = null;
  entries.forEach((entry, index) => {
    const { hash, ...unsigned } = entry;
    if (entry.sequence !== index + 1 || entry.previousHash !== previousHash || digest(unsigned) !== hash) {
      throw Object.assign(new Error(`Deployment host journal is invalid at sequence ${entry.sequence}.`), {
        code: 'DEPLOYMENT_HOST_JOURNAL_INVALID',
      });
    }
    previousHash = hash;
  });
  return entries;
};

export const appendDeploymentHostJournal = async (journalPath: string, input: {
  deploymentId: string;
  phase: string;
  event: string;
  details?: Record<string, unknown>;
}) => {
  await fs.promises.mkdir(path.dirname(journalPath), { recursive: true });
  const entries = await validateDeploymentHostJournal(journalPath);
  const unsigned = {
    sequence: entries.length + 1,
    at: new Date().toISOString(),
    deploymentId: input.deploymentId,
    phase: input.phase,
    event: input.event,
    previousHash: entries.at(-1)?.hash || null,
    ...(input.details ? { details: input.details } : {}),
  };
  const entry: HostJournalEntry = { ...unsigned, hash: digest(unsigned) };
  const handle = await fs.promises.open(journalPath, 'a', 0o600);
  try {
    await handle.write(`${JSON.stringify(entry)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return entry;
};
