import fs from 'node:fs/promises';
import path from 'node:path';
import { createPublicKey, randomBytes, verify } from 'node:crypto';

const checkpointKey = /^(\d{8}T\d{6}Z-[a-f0-9]{12,16}-(?:release|configuration))\/deploy-\1\.sabrec(?:\.uploading)?$/;
const reportRoot = '/app/deployment-reports';
const mountedBackupRoot = '/app/deployment-remote';

export const usesQaNativeReadback = () => {
  if (process.env.DEPLOYMENT_QA_NATIVE_READBACK === undefined) return false;
  if (process.env.DEPLOYMENT_QA_NATIVE_READBACK !== '1'
    || process.env.SABALAN_BACKUP_TARGET !== 'qa'
    || process.env.DEPLOYMENT_CLAMAV_OPERATION !== 'incident-recovery'
    || !/^[a-f0-9]{64}$/.test(process.env.SABALAN_QA_PLAN_SHA256 || '')) {
    throw new Error('QA_NATIVE_READBACK_ENVIRONMENT_INVALID');
  }
  return true;
};

const sameFile = (left: Awaited<ReturnType<typeof fs.lstat>>, right: Awaited<ReturnType<typeof fs.lstat>>) =>
  left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino
  && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
  && left.nlink === 1 && right.nlink === 1;

export function verifyQaNativeReceipt(
  envelope: { result: string; signature: string },
  pinnedKey: string,
  request: { requestId: string; objectKey: string; size: number; mtimeSeconds: number },
): string {
  const key = createPublicKey({ key: Buffer.from(pinnedKey, 'base64'), format: 'der', type: 'spki' });
  const raw = Buffer.from(envelope.result, 'base64');
  if (key.asymmetricKeyType !== 'ed25519' || !verify(null, raw, key, Buffer.from(envelope.signature, 'base64'))) {
    throw new Error('QA_NATIVE_READBACK_SIGNATURE_INVALID');
  }
  const response = JSON.parse(raw.toString('utf8'));
  if (response.format !== 'sabalan-qa-native-readback-result/v1'
    || response.requestId !== request.requestId || response.objectKey !== request.objectKey
    || response.size !== request.size || response.mtimeSeconds !== request.mtimeSeconds
    || !/^[a-f0-9]{64}$/.test(response.sha256 || '')) {
    throw new Error('QA_NATIVE_READBACK_RECEIPT_MISMATCH');
  }
  return response.sha256;
}

export async function qaNativeCheckpointChecksum(file: string): Promise<string> {
  if (!usesQaNativeReadback()) throw new Error('QA_NATIVE_READBACK_DISABLED');
  const deploymentId = process.env.DEPLOYMENT_ID;
  if (!/^deploy-\d{8}T\d{6}Z-[a-f0-9]{12,16}-release$/.test(deploymentId || '') || path.resolve(file) !== file) {
    throw new Error('QA_NATIVE_READBACK_TARGET_INVALID');
  }
  const objectKey = path.relative(mountedBackupRoot, file);
  if (!checkpointKey.test(objectKey) || await fs.realpath(file) !== file) throw new Error('QA_NATIVE_READBACK_PATH_INVALID');
  const queue = path.join(reportRoot, 'qa-native-readback-' + deploymentId);
  const queueStat = await fs.lstat(queue);
  if (!queueStat.isDirectory() || queueStat.uid !== 0 || (queueStat.mode & 0o777) !== 0o700 || await fs.realpath(queue) !== queue) {
    throw new Error('QA_NATIVE_READBACK_QUEUE_INVALID');
  }
  const before = await fs.lstat(file);
  if (!before.isFile() || before.nlink !== 1 || before.size <= 0) throw new Error('QA_NATIVE_READBACK_OBJECT_INVALID');
  const requestId = randomBytes(32).toString('hex');
  const requestFile = path.join(queue, requestId + '.request.json');
  const responseFile = path.join(queue, requestId + '.response.json');
  const request = { format: 'sabalan-qa-native-readback/v1', requestId, objectKey, size: before.size };
  await fs.writeFile(requestFile + '.tmp', JSON.stringify(request) + '\n', { flag: 'wx', mode: 0o600 });
  await fs.rename(requestFile + '.tmp', requestFile);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const responseStat = await fs.lstat(responseFile).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (!responseStat) {
      await new Promise(resolve => setTimeout(resolve, 250));
      continue;
    }
    if (!responseStat.isFile() || responseStat.uid !== 0 || responseStat.nlink !== 1
      || (responseStat.mode & 0o777) !== 0o400 || responseStat.size > 4096) {
      throw new Error('QA_NATIVE_READBACK_RECEIPT_CUSTODY_INVALID');
    }
    const envelope = JSON.parse(await fs.readFile(responseFile, 'utf8'));
    const checksum = verifyQaNativeReceipt(envelope, process.env.DEPLOYMENT_QA_NATIVE_READBACK_PUBLIC_KEY || '', {
      ...request, mtimeSeconds: Math.floor(before.mtimeMs / 1000),
    });
    if (!sameFile(responseStat, await fs.lstat(responseFile)) || !sameFile(before, await fs.lstat(file))) {
      throw new Error('QA_NATIVE_READBACK_OBJECT_CHANGED');
    }
    return checksum;
  }
  throw new Error('QA_NATIVE_READBACK_RECEIPT_TIMEOUT');
}
