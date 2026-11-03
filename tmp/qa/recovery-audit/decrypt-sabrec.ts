import path from 'node:path';
import readline from 'node:readline/promises';
import { decryptRecoveryArchive } from '../../../backend/src/services/recoveryCrypto';

const main = async () => {
  const source = process.argv[2];
  const destination = process.argv[3];

  if (!source || !destination) {
    throw new Error('source and destination are required');
  }

  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const passphrase = await prompt.question('');
  prompt.close();
  if (!passphrase) throw new Error('passphrase is required on stdin');

  await decryptRecoveryArchive(path.resolve(source), path.resolve(destination), passphrase);
  process.stdout.write('recovery package authenticated and decrypted\n');
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
