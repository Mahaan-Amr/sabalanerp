import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type BackfillStats = {
  dryRun: boolean;
  totalScanned: number;
  ownerInferredByCreatedBy: number;
  ownerInferredByContractCreator: number;
  ownerAssignedFallback: number;
  unchangedAlreadyOwned: number;
  failed: number;
  failedItems: Array<{ customerId: string; reason: string }>;
};

const getArgValue = (name: string): string | undefined => {
  const prefix = `${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
};

async function resolveFallbackUserId(): Promise<string> {
  const explicitUserId = getArgValue('--fallback-user-id');
  if (explicitUserId) return explicitUserId;

  const fallbackEmail = getArgValue('--fallback-email') || process.env.CRM_OWNER_FALLBACK_EMAIL || 'admin@sabalanerp.com';
  const byEmail = await prisma.user.findUnique({
    where: { email: fallbackEmail },
    select: { id: true }
  });
  if (byEmail?.id) return byEmail.id;

  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', isActive: true },
    select: { id: true },
    orderBy: { createdAt: 'asc' }
  });
  if (admin?.id) return admin.id;

  throw new Error('No fallback user found. Provide --fallback-user-id=<id> or create an ADMIN user.');
}

async function main() {
  const dryRun = !process.argv.includes('--apply');
  const fallbackUserId = await resolveFallbackUserId();

  const stats: BackfillStats = {
    dryRun,
    totalScanned: 0,
    ownerInferredByCreatedBy: 0,
    ownerInferredByContractCreator: 0,
    ownerAssignedFallback: 0,
    unchangedAlreadyOwned: 0,
    failed: 0,
    failedItems: []
  };

  const customers = await prisma.crmCustomer.findMany({
    select: {
      id: true,
      ownerUserId: true,
      createdBy: true,
      updatedBy: true
    }
  });

  stats.totalScanned = customers.length;

  for (const customer of customers) {
    try {
      if (customer.ownerUserId) {
        stats.unchangedAlreadyOwned += 1;
        continue;
      }

      let ownerUserId: string | null = null;
      let createdBy = customer.createdBy;
      let updatedBy = customer.updatedBy;

      if (customer.createdBy) {
        const creator = await prisma.user.findUnique({
          where: { id: customer.createdBy },
          select: { id: true }
        });
        if (creator?.id) {
          ownerUserId = creator.id;
          updatedBy = updatedBy || creator.id;
          stats.ownerInferredByCreatedBy += 1;
        }
      }

      if (!ownerUserId) {
        const latestContract = await prisma.salesContract.findFirst({
          where: { customerId: customer.id },
          orderBy: { createdAt: 'desc' },
          select: { createdBy: true }
        });

        if (latestContract?.createdBy) {
          const contractCreator = await prisma.user.findUnique({
            where: { id: latestContract.createdBy },
            select: { id: true }
          });
          if (contractCreator?.id) {
            ownerUserId = contractCreator.id;
            createdBy = createdBy || contractCreator.id;
            updatedBy = updatedBy || contractCreator.id;
            stats.ownerInferredByContractCreator += 1;
          }
        }
      }

      if (!ownerUserId) {
        ownerUserId = fallbackUserId;
        createdBy = createdBy || fallbackUserId;
        updatedBy = updatedBy || fallbackUserId;
        stats.ownerAssignedFallback += 1;
      }

      if (!dryRun) {
        await prisma.crmCustomer.update({
          where: { id: customer.id },
          data: {
            ownerUserId,
            createdBy,
            updatedBy
          }
        });
      }
    } catch (error: any) {
      stats.failed += 1;
      stats.failedItems.push({
        customerId: customer.id,
        reason: error?.message || 'unknown_error'
      });
    }
  }

  console.log('[crm-owner-backfill] report');
  console.log(
    JSON.stringify(
      {
        ...stats,
        fallbackUserId
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error('[crm-owner-backfill] fatal', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
