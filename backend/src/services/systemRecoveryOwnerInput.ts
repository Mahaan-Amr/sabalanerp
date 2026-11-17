import { TextDecoder } from 'node:util';
import { assertStrongBackupPassphrase } from './systemRecoveryPolicy';

const maximumBytes = 4096;
const invalid = () => new Error('SYSTEM_RECOVERY_OWNER_INPUT_INVALID');

export async function readSystemRecoveryOwnerRequest(args: readonly string[], input: AsyncIterable<Buffer>) {
  const [operationId] = args;
  if (args.length !== 1 || !/^c[a-z0-9]{24}$/.test(operationId)) throw invalid();

  const bytes = Buffer.alloc(maximumBytes);
  let length = 0;
  try {
    for await (const chunk of input) {
      if (!Buffer.isBuffer(chunk) || chunk.length > maximumBytes - length) throw invalid();
      length += chunk.copy(bytes, length);
    }
    const passphrase = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
    return { operationId, passphrase: assertStrongBackupPassphrase(passphrase) };
  } catch {
    throw invalid();
  } finally {
    bytes.fill(0);
  }
}
