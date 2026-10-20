import 'dotenv/config';
import type { PrismaClient } from '@prisma/client';
import type { Server as HttpServer } from 'node:http';
import type { RuntimeWorkBoundary } from './services/runtimeWorkBoundary';
import { openOriginalOnlineControllerAuthority, assertOriginalOnlineControllerAuthority } from './services/onlineReleaseControllerAuthority';
import { admitOnlineRuntime, assertOnlineRuntimeAdmission,activateOnlineProtectedBootstrap, stopOnlineRuntimeAdmission, type OnlineRuntimeAdmission } from './services/onlineReleaseAdmission';
import { assertOnlineHttpIngressAssigned } from './services/onlinePrivateIngress';

type HttpApplication = { server: HttpServer; io: { close(callback: (error?: Error) => void): void };
  realtimeDelivery: { stop(timeoutMs: number): Promise<void> };
  closeExternalAdmission(): void;
  hrRedesignCutoverStartup: { enabled: boolean; acceptancePath: string | null; sourceRevision: string | null } };

/** Production-only online entry. Ordinary index.ts and its standalone startup
 * remain separate. Importing this module starts nothing. No environment role
 * can replace native custody or the host controller's signed acceptance.
 *
 * The host controller signer/RO key provisioning remains an explicit
 * installation dependency. Startup never maps serving to standalone or
 * quietly omits workers/deliveries. */
export async function mainOnlineRuntime() {
  const authority = openOriginalOnlineControllerAuthority();
  const decision = assertOriginalOnlineControllerAuthority(authority);
  const purpose = decision.runtimePurpose;
  if ((purpose === 'http' && (decision.role !== 'serving' || !decision.httpIngress))
    || (purpose === 'jobs' && decision.httpIngress !== null)) throw new Error('ONLINE_RUNTIME_PURPOSE_REQUIRED');
  const ingress = decision.httpIngress;
  let shuttingDown = false, admission: OnlineRuntimeAdmission | undefined, boundary: RuntimeWorkBoundary | undefined;
  let application: HttpApplication | undefined, database: PrismaClient | undefined, disconnect: (() => Promise<void>) | undefined;
  let shutdownPromise: Promise<void> | undefined, startupComplete = false, stopRequested = false;
  let producer:Awaited<ReturnType<typeof import('./services/onlineRealtimeBridge').createOnlineRealtimeProducer>>|undefined;
  let workers: Awaited<ReturnType<typeof import('./services/applicationWorkers').startOnlineApplicationWorkers>> | undefined;
  let consumer: Awaited<ReturnType<typeof import('./services/onlineRealtimeScheduling').startOnlineRealtimeConsumer>> | undefined;
  let preparePromise: Promise<void> | undefined;
  const prepareDrain = () => preparePromise ??= (async()=>{
    if (purpose === 'jobs') { workers?.stopNewTicks(); return; }
    application?.closeExternalAdmission();
    if (boundary) await boundary.requests.waitForDrain(240_000);
    const { assertOnlineHrInvalidationClosed } = await import('./services/onlineHrInvalidation');
    assertOnlineHrInvalidationClosed();
  })();
  const shutdown = () => {
    shutdownPromise ??= (async () => {
      // Source admission closes first. Accepted callbacks still own native
      // HTTP work until the protected controller's exact SQL DRAINING fence.
      await prepareDrain();
      if (workers) await workers.stopAndDrain(240_000);
      else if(producer)await producer.stopAndDrain();
      if (consumer) await consumer.drainAndStop(240_000);
      if (application) await application.realtimeDelivery.stop(240_000);
      shuttingDown = true;
      if (admission) stopOnlineRuntimeAdmission(admission);
      if (boundary) await boundary.stopAndDrain(240_000);
      if (application?.server.listening) await new Promise<void>((resolve,reject)=>{
        application!.io.close(error=>error?reject(error):resolve());
      });
      if (disconnect) { await disconnect(); disconnect = undefined; }
    })();
    return shutdownPromise;
  };
  const signal = () => {
    stopRequested = true;
    // A startup await still owns its returned resource. Its original catch
    // closes that resource after completion, rather than caching an empty
    // shutdown before a pool/boundary is installed later in the same process.
    if (startupComplete) void shutdown().catch(() => { console.error('ONLINE_RUNTIME_DRAIN_UNPROVEN'); process.exitCode = 1; });
  };
  process.once('SIGTERM', signal); process.once('SIGINT', signal);
  try {
    // Only the canonical singleton is imported, after original native/signed
    // admission has been checked. No application route is imported yet.
    const pool = await import('./lib/prisma'); database = pool.prisma; disconnect = pool.disconnectDatabase;
    if (stopRequested) throw new Error('ONLINE_RUNTIME_STOPPING');
    admission = await admitOnlineRuntime(authority, database);
    if (stopRequested) throw new Error('ONLINE_RUNTIME_STOPPING');
    const manifest = assertOnlineRuntimeAdmission(admission, purpose);
    const { createScopedRuntimeWork } = await import('./services/onlineRuntimeWork');
    boundary = await createScopedRuntimeWork({ registrySha256: manifest.runtimeBundleSha256, generation: manifest.generation,
      canJoin: () => {
        if (shuttingDown || !admission) return false;
        assertOnlineRuntimeAdmission(admission, purpose); return true;
      } });
    if (stopRequested) throw new Error('ONLINE_RUNTIME_STOPPING');
    const { openOnlineRuntimeComposition } = await import('./services/onlineRuntimeComposition');
    const runtime = await openOnlineRuntimeComposition({ admission, boundary });
    if (stopRequested) throw new Error('ONLINE_RUNTIME_STOPPING');
    if (purpose === 'jobs') {
      // Same canonical validator, providers, singleton and actual native jobs
      // boundary as serving; never initialize/recover System Recovery here.
      const { validateProductionEnvironment } = await import('./services/productionEnvironment');
      validateProductionEnvironment();
      const { resolveHrRedesignCutoverStartup } = await import('./services/hrRedesignCutoverStartup');
      const cutover = process.env.NODE_ENV === 'production' ? resolveHrRedesignCutoverStartup(process.env) : undefined;
      if (cutover?.enabled) {
        const { readFile } = await import('node:fs/promises');
        const { verifyHrRedesignCutover } = await import('./services/hrRedesignCutover');
        await verifyHrRedesignCutover(database,{
          acceptanceAttestation:JSON.parse(await readFile(cutover.acceptancePath!,'utf8')),
          sourceRevision:cutover.sourceRevision!,
        });
      }
      const { createOnlineRealtimeProducer } = await import('./services/onlineRealtimeBridge');
      producer = await createOnlineRealtimeProducer(runtime,database);
      const { startOnlineApplicationWorkers } = await import('./services/applicationWorkers');
      workers = await startOnlineApplicationWorkers(runtime,database,producer);
      if (stopRequested) throw new Error('ONLINE_RUNTIME_STOPPING');
      startupComplete = true;
      return Object.freeze({prepareDrain,shutdown});
    }
    const canonical = await import('./application');
    application = canonical.createOnlineApplication({ runtime, isShuttingDown: () => shuttingDown });
    const { startOnlineRealtimeConsumer } = await import('./services/onlineRealtimeScheduling');
    consumer = await startOnlineRealtimeConsumer(runtime,application);
    if (application.hrRedesignCutoverStartup.enabled) {
      const { readFile } = await import('node:fs/promises');
      const { verifyHrRedesignCutover } = await import('./services/hrRedesignCutover');
      await verifyHrRedesignCutover(database, {
        acceptanceAttestation: JSON.parse(await readFile(application.hrRedesignCutoverStartup.acceptancePath!, 'utf8')),
        sourceRevision: application.hrRedesignCutoverStartup.sourceRevision!,
      });
    }
    if (stopRequested) throw new Error('ONLINE_RUNTIME_STOPPING');
    assertOnlineRuntimeAdmission(admission, purpose);
    assertOriginalOnlineControllerAuthority(authority);
    if (!ingress) throw new Error('ONLINE_HTTP_INGRESS_REQUIRED');
    assertOnlineHttpIngressAssigned(ingress);
    await new Promise<void>((resolve, reject) => {
      application!.server.once('error', reject);
      // Only the original host's signed private slot can select the listener.
      application!.server.listen(ingress.port, ingress.bindHost, () => { application!.server.off('error', reject); resolve(); });
    });
    if (stopRequested) throw new Error('ONLINE_RUNTIME_STOPPING');
    if (!ingress) throw new Error('ONLINE_HTTP_INGRESS_REQUIRED');
    assertOnlineHttpIngressAssigned(ingress);
    startupComplete = true;
    return Object.freeze({prepareDrain,shutdown,activateProtectedBootstrap:async()=>{
      if(!admission||!startupComplete||stopRequested)throw Error('ONLINE_BOOTSTRAP_STARTUP_NOT_READY');
      await activateOnlineProtectedBootstrap(admission);
    }});
  } catch (error) {
    try { await shutdown(); } catch { process.exitCode = 1; throw new Error('ONLINE_STARTUP_CLOSURE_UNPROVEN'); }
    process.removeListener('SIGTERM', signal); process.removeListener('SIGINT', signal); throw error;
  }
}

if (require.main === module) void mainOnlineRuntime().catch(() => {
  console.error('ONLINE_RUNTIME_STARTUP_REFUSED'); process.exitCode = 1;
});
