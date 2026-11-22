import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import type { RuntimeWorkContext } from '../../backend/src/services/runtimeWorkContext';
import type { VersionedFilePublication } from '../../backend/src/services/versionedFilePublication';
import { stableDeletionFingerprint } from '../../backend/src/services/hrRecordRetentionPolicy';
import { eraseVersionedJobApplication } from '../../backend/src/services/hrVersionedJobApplicationErasure';

/** Owns one observer client only for this harness's isolated database. The
 * application still uses its existing singleton and two-connection pool. */
export async function exerciseVersionedJobApplicationConcurrency(database: PrismaClient,
  publication: VersionedFilePublication, work: RuntimeWorkContext, root: string) {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, 'postgres'); assert.match(url.pathname, /^\/qa_hr_erasure_[a-f0-9]{32}$/);
  const applicationName = url.searchParams.get('application_name'); assert.ok(applicationName);
  url.searchParams.set('application_name', 'qa-erasure-observer-' + randomUUID());
  url.searchParams.set('connection_limit', '1'); url.searchParams.set('pool_timeout', '5');
  const observer = new PrismaClient({ datasources: { db: { url: url.href } } });
  let release!: () => void, signal!: () => void;
  const entered = new Promise<void>(resolve => { signal = resolve; });
  const resumed = new Promise<void>(resolve => { release = resolve; });
  let first: ReturnType<typeof eraseVersionedJobApplication> | undefined;
  let second: ReturnType<typeof eraseVersionedJobApplication> | undefined;
  const observe = <T>(promise: Promise<T>) => promise.then(value => ({ status: 'fulfilled' as const, value }), reason => ({ status: 'rejected' as const, reason }));
  try {
    await observer.$queryRaw`SELECT 1::int AS connected`;
    const actorUserId = randomUUID();
    const candidate = await database.hrCandidate.create({ data: { firstName: 'Private', lastName: 'Concurrent QA', mobile: '09120000000' } });
    const application = await database.hrJobApplication.create({ data: { candidateId: candidate.id, createdBy: actorUserId } });
    const name = randomUUID() + '.pdf'; await publication.publish(name, Buffer.from('ONE ERASURE OWNER'));
    await database.hrHiringDocument.create({ data: { applicationId: application.id, category: 'NATIONAL_ID_FRONT',
      version: 1, inspectionSource: 'COPY_RECEIVED', storageName: name, originalName: 'private.pdf', uploadedBy: actorUserId } });
    const readImpact = async (tx: Prisma.TransactionClient, id: string) => {
      const current = await tx.hrJobApplication.findUnique({ where: { id }, include: { documents: { orderBy: { id: 'asc' } } } });
      if (!current) return null;
      const files = current.documents.flatMap(row => row.storageName ? [row.storageName] : []).sort();
      return { fingerprint: stableDeletionFingerprint(current, 'PRIVATE CONCURRENT FIXTURE KEY'), files,
        counts: { applications: 1, documents: current.documents.length }, fileCounts: { liveReferences: files.length } };
    };
    const impact = await database.$transaction(tx => readImpact(tx, application.id)); assert.ok(impact);
    let paused = false;
    first = eraseVersionedJobApplication({ database, publication, work, root, applicationId: application.id, actorUserId,
      reason: 'Private first concurrent operation', expectedFingerprint: impact.fingerprint,
      readImpact: async (tx, id) => { if (!paused) { paused = true; signal(); await resumed; } return readImpact(tx, id); } });
    const firstResult = observe(first);
    await Promise.race([entered, firstResult.then(() => { throw new Error('FIRST_ERASURE_DID_NOT_REACH_IMPACT_PORT'); })]);
    second = eraseVersionedJobApplication({ database, publication, work, root, applicationId: application.id, actorUserId,
      reason: 'Private second concurrent operation', expectedFingerprint: impact.fingerprint, readImpact });
    const secondResult = observe(second);
    const deadline = performance.now() + 700;
    while (true) {
      const rows = await observer.$queryRaw<{ waiting: number }[]>`SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname=current_database() AND application_name=${applicationName} AND wait_event_type='Lock' AND wait_event='advisory'`;
      if (rows[0].waiting === 1) break;
      if (performance.now() >= deadline) throw new Error('SECOND_ERASURE_NEVER_OBSERVED_WAITING');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    release();
    const results = await Promise.all([firstResult, secondResult]);
    assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
    if (results[1].status === 'rejected') assert.equal(results[1].reason?.code, 'HR_VERSIONED_APPLICATION_OPERATION_UNRESOLVED');
    const receipts = await database.hrDeletionReceipt.findMany({ where: { targetType: 'JOB_APPLICATION', targetId: application.id } });
    assert.equal(receipts.length, 1); assert.equal(receipts[0].status, 'FILE_CLEANUP_PENDING');
    assert.equal(await database.hrJobApplication.count({ where: { id: application.id } }), 0);
    console.log(JSON.stringify({ versionedJobApplicationConcurrencyPassed: true }));
  } finally {
    release(); await Promise.allSettled([first, second].filter(Boolean));
    await observer.$disconnect();
    console.log(JSON.stringify({ versionedJobApplicationObserverClosed: true }));
  }
}
