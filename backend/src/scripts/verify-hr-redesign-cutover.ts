import { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { verifyHrRedesignCutover } from '../services/hrRedesignCutover';

const prisma = new PrismaClient();
const shakilaArgument = process.argv.find((argument) => argument.startsWith('--shakila-user-id='));
const shakilaUserId = shakilaArgument?.slice('--shakila-user-id='.length) || process.env.HR_SHAKILA_USER_ID;
const acceptanceArgument = process.argv.find((argument) => argument.startsWith('--acceptance='));
const acceptancePath = acceptanceArgument?.slice('--acceptance='.length) || process.env.HR_REDESIGN_CUTOVER_ACCEPTANCE_PATH;
const revisionArgument = process.argv.find((argument) => argument.startsWith('--source-revision='));
const sourceRevision = revisionArgument?.slice('--source-revision='.length) || process.env.HR_REDESIGN_CUTOVER_REVISION || '';

const run = async () => {
  if (!acceptancePath) throw new Error('HR redesign Cutover acceptance path is required.');
  const acceptanceAttestation = JSON.parse(await readFile(acceptancePath, 'utf8')) as unknown;
  const report = await verifyHrRedesignCutover(prisma, { shakilaUserId, acceptanceAttestation, sourceRevision });
  console.log(JSON.stringify({ mode: 'cutover-verification', idempotentDryRun: true, report }, null, 2));
};

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
