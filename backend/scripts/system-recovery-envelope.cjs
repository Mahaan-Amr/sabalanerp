const crypto = require('node:crypto');
const format = 'sabalan-system-recovery-owner/v1';

exports.seal = (request, publicKey) => {
  const recipient = crypto.createPublicKey(publicKey);
  if (recipient.asymmetricKeyType !== 'rsa' || recipient.asymmetricKeyDetails.modulusLength < 3072) throw Error('RECOVERY_OWNER_KEY_INVALID');
  const key = crypto.randomBytes(32);
  try {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(format));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(request), 'utf8'), cipher.final()]);
    return Buffer.from(JSON.stringify({ format, iv: iv.toString('base64'),
      key: crypto.publicEncrypt({ key: recipient, oaepHash: 'sha256' }, key).toString('base64'),
      tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }));
  } finally { key.fill(0); }
};

exports.open = (bytes, privateKey) => {
  if (bytes.length > 32768) throw Error('RECOVERY_OWNER_ENVELOPE_INVALID');
  const envelope = JSON.parse(bytes.toString('utf8'));
  if (envelope.format !== format) throw Error('RECOVERY_OWNER_ENVELOPE_INVALID');
  const key = crypto.privateDecrypt({ key: privateKey, oaepHash: 'sha256' }, Buffer.from(envelope.key, 'base64'));
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(format));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
  } finally { key.fill(0); }
};
