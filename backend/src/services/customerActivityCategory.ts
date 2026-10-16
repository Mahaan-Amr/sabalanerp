import { z } from 'zod';
import type { Prisma } from '@prisma/client';

export const customerActivityCategorySchema = z.enum(['BUILDER', 'ARCHITECT', 'NONE'], {
  required_error: 'دسته‌بندی فعالیت مشتری الزامی است.',
  invalid_type_error: 'دسته‌بندی فعالیت مشتری معتبر نیست.',
});

export async function recordCustomerActivityCategory(
  tx: Prisma.TransactionClient, customerId: string, actorId: string,
  before: string | null, after: string,
) {
  if (before === after) return;
  await tx.crmTimelineEvent.create({ data: {
    customerId, actorId, eventType: 'CUSTOMER_ACTIVITY_CATEGORY_CHANGED',
    title: 'ثبت دسته‌بندی فعالیت مشتری', metadata: { before, after },
  } });
}
