import fs from 'node:fs';
import { assertIsolatedRecoveryDrill } from '../services/deploymentDrillPolicy';
import { validateDeploymentHostJournal } from '../services/deploymentHostJournal';

const required = (name: string) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw Object.assign(new Error(`${name} is required.`), { code: 'DEPLOYMENT_REHEARSAL_CONFIGURATION_MISSING' });
  return value;
};

const main = async () => {
  assertIsolatedRecoveryDrill(process.env);
  const metadataPath = required('DEPLOYMENT_DRILL_METADATA_PATH');
  const successJournalPath = required('DEPLOYMENT_REHEARSAL_SUCCESS_JOURNAL');
  const rollbackJournalPath = required('DEPLOYMENT_REHEARSAL_ROLLBACK_JOURNAL');
  const [successJournal, rollbackJournal] = await Promise.all([
    validateDeploymentHostJournal(successJournalPath),
    validateDeploymentHostJournal(rollbackJournalPath),
  ]);
  const success = successJournal.at(-1);
  const rollback = rollbackJournal.at(-1);
  if (success?.phase !== 'COMPLETED' || rollback?.phase !== 'ROLLED_BACK' || success.deploymentId === rollback.deploymentId) {
    throw Object.assign(new Error('Quarterly rehearsal requires separate checksum-valid COMPLETED and ROLLED_BACK deployment journals.'), {
      code: 'DEPLOYMENT_REHEARSAL_EVIDENCE_INVALID',
    });
  }
  const metadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf8'));
  const completedAt = new Date().toISOString();
  const lastRehearsal = {
    status: 'HEALTHY',
    completedAt,
    successDeploymentId: success.deploymentId,
    rollbackDeploymentId: rollback.deploymentId,
    successJournalHash: success.hash,
    rollbackJournalHash: rollback.hash,
  };
  await fs.promises.writeFile(metadataPath, `${JSON.stringify({ ...metadata, lastRehearsal }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(JSON.stringify({ ok: true, lastRehearsal }));
};

main().catch((error: any) => {
  console.error(JSON.stringify({ ok: false, code: error?.code || 'DEPLOYMENT_REHEARSAL_RECORD_FAILED', message: error?.message }));
  process.exitCode = 1;
});
