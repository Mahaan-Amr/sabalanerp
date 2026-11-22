import 'dotenv/config';
import { startOrdinaryApplicationWorkers } from './services/applicationWorkers';
import { readFile } from 'fs/promises';
import { performance } from 'node:perf_hooks';
import { createApplication } from './application';
import { resolveRuntimeRole, startRuntime } from './services/runtimeStartup';
import { assertRuntimeControlAdmission } from './services/runtimeControlOwnership';
import { runtimeHttpRequests } from './services/httpRequestLifecycle';
import { disconnectDatabase, prisma } from './lib/prisma';
import { getRecoveryRuntimeState, initializeRecoveryRuntime, waitForActiveWrites, waitForRecoveryOperationDrain } from './services/recoveryRuntime';
import { initializeSystemRecovery } from './services/systemRecoveryLifecycle';
import { verifyHrRedesignCutover } from './services/hrRedesignCutover';

const runtimeRole = resolveRuntimeRole(process.env.BACKEND_RUNTIME_ROLE);
if (runtimeRole === 'standalone') {
  assertRuntimeControlAdmission();
  initializeRecoveryRuntime();
}
let isShuttingDown = false;
const { app, server, io, realtimeDelivery, hrRedesignCutoverStartup } = createApplication({
  runtimeRole, isShuttingDown: () => isShuttingDown,
});
const PORT = process.env.PORT || 5000;

let applicationWorkers: Awaited<ReturnType<typeof startOrdinaryApplicationWorkers>> | undefined;

// Start only after interrupted recovery has been finalized or safely rolled back.
startRuntime(runtimeRole, {
  assertControlOwnership: assertRuntimeControlAdmission,
  initializeRecovery: () => initializeSystemRecovery(prisma),
  verifyCutover: async () => {
    if (hrRedesignCutoverStartup.enabled) {
      const acceptanceAttestation = JSON.parse(await readFile(hrRedesignCutoverStartup.acceptancePath!, "utf8")) as unknown;
      await verifyHrRedesignCutover(prisma, {
        acceptanceAttestation,
        sourceRevision: hrRedesignCutoverStartup.sourceRevision!,
      });
    }
  },
  startWorkers: async () => {
    if (getRecoveryRuntimeState().mode === 'NORMAL') {
      applicationWorkers = await startOrdinaryApplicationWorkers(prisma,
        (userId, notification) => realtimeDelivery.notify(userId, notification.id));
    }
  },
  listen: () => server.listen(PORT, () => {
    console.log(`? Server running on port ${PORT}`);
    console.log(`? Health check: http://localhost:${PORT}/api/health`);
  }),
}).catch((error) => {
  console.error("Backend startup blocked:", error);
  process.exitCode = 1;
});


const shutdown = async (signal: NodeJS.Signals) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  applicationWorkers?.stopNewTicks();
  console.log(`Received ${signal}; draining connections before shutdown.`);

  try {
    const deadline = performance.now() + 240_000;
    const remaining = () => Math.max(0, deadline - performance.now());
    // Stop admission before closing sockets; callbacks already running must finish.
    await Promise.all([
      applicationWorkers?.stopAndDrain(240_000),
      waitForRecoveryOperationDrain(240_000),
      waitForActiveWrites(240_000),
      runtimeHttpRequests.waitForDrain(240_000),
    ]);
    await realtimeDelivery.stop(remaining());
    if (server.listening) {
      let timeout: NodeJS.Timeout | undefined;
      try {
        await Promise.race([new Promise<void>((resolve, reject) => {
          io.close((error) => (error ? reject(error) : resolve()));
        }), new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('RUNTIME_SOCKET_DRAIN_TIMEOUT')), remaining());
        })]);
      } finally { if (timeout) clearTimeout(timeout); }
    }
    await disconnectDatabase();
    process.exit(0);
  } catch (error) {
    console.error("Graceful shutdown failed:", error);
    // Keep the process and pool alive for unfinished work. Readiness stays false;
    // the deployment must fail closed rather than claim that this runtime drained.
    process.exitCode = 1;
  }
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

export { io };
