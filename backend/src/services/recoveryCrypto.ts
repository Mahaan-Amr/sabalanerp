import crypto from 'crypto';
import fs from 'fs';

const MAGIC = Buffer.from('SABREC01');
const TAG_BYTES = 16;

type EncryptionHeader = {
  format: 'sabalan-recovery';
  version: 1;
  cipher: 'aes-256-gcm';
  kdf: 'scrypt';
  salt: string;
  iv: string;
};

const deriveKey = (passphrase: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });

export const sha256File = (filePath: string) => new Promise<string>((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.on('error', reject);
  stream.on('end', () => resolve(hash.digest('hex')));
});

const pipeline = async (...streams: any[]) => {
  const { pipeline: run } = await import('stream/promises');
  await run(streams as any);
};

export const encryptRecoveryArchive = async (sourcePath: string, destinationPath: string, passphrase: string) => {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await deriveKey(passphrase, salt);
  const header: EncryptionHeader = {
    format: 'sabalan-recovery',
    version: 1,
    cipher: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
  };
  const encodedHeader = Buffer.from(JSON.stringify(header), 'utf8');
  const prefix = Buffer.alloc(MAGIC.length + 4 + encodedHeader.length);
  MAGIC.copy(prefix, 0);
  prefix.writeUInt32BE(encodedHeader.length, MAGIC.length);
  encodedHeader.copy(prefix, MAGIC.length + 4);
  const output = fs.createWriteStream(destinationPath, { flags: 'wx' });
  output.write(prefix);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(encodedHeader);
  await pipeline(fs.createReadStream(sourcePath), cipher, output);
  await fs.promises.appendFile(destinationPath, cipher.getAuthTag());
};

export const decryptRecoveryArchive = async (sourcePath: string, destinationPath: string, passphrase: string) => {
  const descriptor = await fs.promises.open(sourcePath, 'r');
  try {
    const stat = await descriptor.stat();
    const prefix = Buffer.alloc(MAGIC.length + 4);
    await descriptor.read(prefix, 0, prefix.length, 0);
    if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) throw Object.assign(new Error('Invalid recovery package.'), { code: 'INVALID_RECOVERY_PACKAGE' });
    const headerLength = prefix.readUInt32BE(MAGIC.length);
    if (headerLength <= 0 || headerLength > 16_384) throw Object.assign(new Error('Invalid recovery header.'), { code: 'INVALID_RECOVERY_PACKAGE' });
    const encodedHeader = Buffer.alloc(headerLength);
    await descriptor.read(encodedHeader, 0, headerLength, prefix.length);
    const header = JSON.parse(encodedHeader.toString('utf8')) as EncryptionHeader;
    if (header.format !== 'sabalan-recovery' || header.version !== 1) throw Object.assign(new Error('Unsupported recovery package format.'), { code: 'UNSUPPORTED_RECOVERY_FORMAT' });
    const tag = Buffer.alloc(TAG_BYTES);
    await descriptor.read(tag, 0, TAG_BYTES, stat.size - TAG_BYTES);
    const ciphertextStart = prefix.length + headerLength;
    const ciphertextEnd = stat.size - TAG_BYTES - 1;
    if (ciphertextEnd < ciphertextStart) throw Object.assign(new Error('Recovery package is truncated.'), { code: 'INVALID_RECOVERY_PACKAGE' });
    const key = await deriveKey(passphrase, Buffer.from(header.salt, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'base64'));
    decipher.setAAD(encodedHeader);
    decipher.setAuthTag(tag);
    try {
      await pipeline(fs.createReadStream(sourcePath, { start: ciphertextStart, end: ciphertextEnd }), decipher, fs.createWriteStream(destinationPath, { flags: 'wx' }));
    } catch {
      await fs.promises.rm(destinationPath, { force: true });
      throw Object.assign(new Error('Backup passphrase is incorrect or the package was modified.'), { code: 'RECOVERY_DECRYPTION_FAILED' });
    }
  } finally {
    await descriptor.close();
  }
};
