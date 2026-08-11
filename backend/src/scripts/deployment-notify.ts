import { disconnectDatabase, prisma } from '../lib/prisma';
import { publishNotificationEvent } from '../services/notificationService';

const notify = async (deploymentId: string, releaseId: string, result: string) => {
  if (!deploymentId || !releaseId || !['COMPLETED', 'ABORTED', 'ROLLED_BACK', 'RECOVERY_REQUIRED'].includes(result)) {
    throw Object.assign(new Error('Deployment notification identity or result is invalid.'), { code: 'DEPLOYMENT_NOTIFICATION_CONFIGURATION_INVALID' });
  }
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true, erasedAt: null }, select: { id: true } });
  if (!admins.length) throw Object.assign(new Error('No active ADMIN exists for the mandatory deployment notification.'), { code: 'DEPLOYMENT_NOTIFICATION_RECIPIENT_MISSING' });
  const failed = result !== 'COMPLETED';
  await publishNotificationEvent(prisma, {
    type: failed ? 'DEPLOYMENT_FAILED' : 'DEPLOYMENT_COMPLETED',
    deduplicationKey: `deployment-result:${deploymentId}:${result}`,
    recipientIds: admins.map((admin) => admin.id),
    resourceType: 'DeploymentOperation',
    resourceId: deploymentId,
    referenceId: deploymentId,
    actionUrl: '/dashboard/admin/system-recovery',
    payload: { releaseId, result },
  });
  return admins.length;
};

const main = async () => {
  if (process.argv[2] === 'retry-blocker') {
    const blocker = await prisma.deploymentOperation.findFirst({
      where: { phase: 'COMPLETED_WITH_NOTIFICATION_FAILURE', errorCode: 'DEPLOYMENT_NOTIFICATION_PENDING' },
      orderBy: { completedAt: 'desc' },
    });
    if (!blocker) {
      console.log(JSON.stringify({ ok: true, retried: false }));
      return;
    }
    const originalResult = String(blocker.errorMessage || '');
    const recipients = await notify(blocker.id, blocker.releaseId, originalResult);
    await prisma.deploymentOperation.update({
      where: { id: blocker.id },
      data: { phase: originalResult, errorCode: null, errorMessage: null },
    });
    console.log(JSON.stringify({ ok: true, retried: true, deploymentId: blocker.id, recipients }));
    return;
  }
  const deploymentId = String(process.env.DEPLOYMENT_ID || '').trim();
  const releaseId = String(process.env.DEPLOYMENT_RELEASE_ID || '').trim();
  const result = String(process.env.DEPLOYMENT_RESULT || '').trim();
  console.log(JSON.stringify({ ok: true, recipients: await notify(deploymentId, releaseId, result), result }));
};

main()
  .catch((error: any) => {
    console.error(JSON.stringify({ ok: false, code: error?.code || 'DEPLOYMENT_NOTIFICATION_FAILED', message: error?.message }));
    process.exitCode = error?.code === 'P2021' ? 4 : 1;
  })
  .finally(() => disconnectDatabase());
