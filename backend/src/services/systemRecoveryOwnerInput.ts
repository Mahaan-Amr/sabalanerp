import { TextDecoder } from 'node:util';
import { assertStrongBackupPassphrase } from './systemRecoveryPolicy';
import { parseRecoveryOwnerRequest } from './systemRecoveryOwnerHandoff';

const maximumBytes = 4096;
const invalid = () => new Error('SYSTEM_RECOVERY_OWNER_INPUT_INVALID');

export async function readSystemRecoveryOwnerRequest(args: readonly string[], input: AsyncIterable<Buffer>, deploymentId: string | undefined) {
  const [operationId] = args;
  if (args.length !== 1 || !/^c[a-z0-9]{24}$/.test(operationId)) throw invalid();

  if (!deploymentId || !/^deploy-[a-zA-Z0-9_-]{1,120}$/.test(deploymentId)) throw invalid();
  const bytes = Buffer.alloc(maximumBytes);
  let length = 0;
  try {
    for await (const chunk of input) {
      if (!Buffer.isBuffer(chunk) || chunk.length > maximumBytes - length) throw invalid();
      length += chunk.copy(bytes, length);
    }
    const passphrase = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
    return { operationId, deploymentId, passphrase: assertStrongBackupPassphrase(passphrase) };
  } catch {
    throw invalid();
  } finally {
    bytes.fill(0);
  }
}

export async function readSealedRecoveryOwnerInput(args: readonly string[], input: AsyncIterable<Buffer>, deploymentId: string | undefined) {
  if (args.length !== 3 || args[0] !== '--sealed' || !/^c[a-z0-9]{24}$/.test(args[1] || '')
    || !['BACKUP', 'RESTORE'].includes(args[2] || '') || !/^deploy-[a-zA-Z0-9_-]{1,120}$/.test(deploymentId || '')) throw invalid();
  const bytes = Buffer.alloc(16384);
  let length = 0;
  try {
    for await (const chunk of input) {
      if (!Buffer.isBuffer(chunk) || chunk.length > bytes.length - length) throw invalid();
      length += chunk.copy(bytes, length);
    }
    const contents = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
    const request = parseRecoveryOwnerRequest(contents.request);
    if (request.operationId !== args[1] || request.action !== args[2] || !/^[a-f0-9]{64}$/.test(contents.sealedSha256 || '')) throw invalid();
    return { request, sealedSha256: contents.sealedSha256 as string, deploymentId: deploymentId! };
  } catch { throw invalid(); }
  finally { bytes.fill(0); }
}
