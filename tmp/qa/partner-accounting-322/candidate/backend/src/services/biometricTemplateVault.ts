import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { canonicalizeBiometricValue } from './biometricProtocol';

export interface ProtectedTemplateEnvelope { version: 1; keyId: string; algorithm: 'AES-256-GCM'; iv: string; ciphertext: string; authenticationTag: string }
interface TemplateContext { personnelId: string; finger: string; format: string }

export class ProtectedTemplateVault {
  constructor(private readonly keyring: { activeKeyId: string; keys: Record<string, Buffer> }) {}
  seal(material: Buffer, context: TemplateContext): ProtectedTemplateEnvelope {
    const key = this.keyring.keys[this.keyring.activeKeyId];
    if (!key || key.length !== 32) throw new Error('A 256-bit active biometric key is required');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(canonicalizeBiometricValue(context)));
    const ciphertext = Buffer.concat([cipher.update(material), cipher.final()]);
    return { version: 1, keyId: this.keyring.activeKeyId, algorithm: 'AES-256-GCM', iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), authenticationTag: cipher.getAuthTag().toString('base64') };
  }
  open(envelope: ProtectedTemplateEnvelope, context: TemplateContext): Buffer {
    const key = this.keyring.keys[envelope.keyId];
    if (!key) throw new Error('Biometric template key is unavailable');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(canonicalizeBiometricValue(context)));
    decipher.setAuthTag(Buffer.from(envelope.authenticationTag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
  }
}
