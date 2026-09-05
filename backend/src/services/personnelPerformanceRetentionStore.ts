import type { Prisma, PrismaClient } from '@prisma/client';
import { canonicalPerformanceHash } from './personnelPerformancePolicy';
import { performanceVaultKeyFromEnvironment, readPerformancePayload } from './personnelPerformancePayloadStore';
import { isSupportedPerformanceRetentionPolicy, PERFORMANCE_RETENTION_SCHEDULE_V1 } from './personnelPerformanceRetention';

export const readPerformanceRetentionPolicy = async (client: PrismaClient | Prisma.TransactionClient, at: Date) => {
  const policy = await client.performancePolicyVersion.findFirst({
    where: { policyKind: 'RETENTION', lifecycle: 'ACTIVE', effectiveFrom: { lte: at } },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
  });
  if (!policy?.encryptedPayloadId) throw Object.assign(new Error('برنامه نگهداری مصوب و قابل بازسازی وجود ندارد. پاک‌سازی تا تعیین تکلیف منابع انسانی متوقف است.'), {
    code: 'PERFORMANCE_RETENTION_POLICY_MISSING', status: 409,
  });
  const content = await readPerformancePayload<unknown>(client, policy.encryptedPayloadId, performanceVaultKeyFromEnvironment());
  if (!isSupportedPerformanceRetentionPolicy(content) || canonicalPerformanceHash(content) !== policy.contentHash) {
    throw Object.assign(new Error('نسخه برنامه نگهداری قابل تأیید نیست. پاک‌سازی تا بررسی مالک سامانه متوقف است.'), {
      code: 'PERFORMANCE_RETENTION_POLICY_UNVERIFIED', status: 409,
    });
  }
  return { policy, content: PERFORMANCE_RETENTION_SCHEDULE_V1 };
};
