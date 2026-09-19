import fs from 'node:fs';
import path from 'node:path';
import { disconnectDatabase, prisma } from '../lib/prisma';
import { measurePerformanceDatabaseIdentity } from '../services/personnelPerformanceDatabaseIdentity';

const main = async () => {
  const destination = process.argv[2];
  if (!destination) throw new Error('A deployment identity report path is required.');
  const identity = await measurePerformanceDatabaseIdentity(prisma, { beforeMigrations: process.argv.includes('--before-migrations') });
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.writeFile(destination, JSON.stringify(identity), { mode: 0o600 });
  console.log('Measured performance database identity.');
};
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Database identity measurement failed.');
  process.exitCode = 1;
}).finally(disconnectDatabase);
