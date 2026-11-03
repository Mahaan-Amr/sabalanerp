import { createHmac, timingSafeEqual } from 'node:crypto';
import { BiometricCommand, canonicalizeBiometricValue, SignedBiometricCommand } from './biometricProtocol';

export const signBiometricCommand = (command: BiometricCommand, secret: string): SignedBiometricCommand => ({
  command,
  signature: createHmac('sha256', secret).update(canonicalizeBiometricValue(command)).digest('base64url'),
});

export const assertBiometricCommandSignature = (signed: SignedBiometricCommand, secret: string) => {
  const expected = signBiometricCommand(signed.command, secret).signature;
  const suppliedBytes = Buffer.from(signed.signature);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) throw new Error('Invalid connector command signature');
};
