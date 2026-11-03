import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type LegacyCustomer = {
  id: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  isActive: boolean;
};

const normalizeText = (value?: string | null): string =>
  (value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

const normalizePhone = (value?: string | null): string =>
  (value || '').replace(/[^\d+]/g, '');

const buildNationalCodeKey = (nationalCode?: string | null): string | null => {
  const normalized = normalizeText(nationalCode);
  if (!normalized) return null;
  return `nat:${normalized}`;
};

const buildNamePhoneKey = (
  firstName?: string | null,
  lastName?: string | null,
  phone?: string | null
): string => {
  const nameKey = `${normalizeText(firstName)}|${normalizeText(lastName)}`;
  return `namephone:${nameKey}|${normalizePhone(phone)}`;
};

const getPrimaryPhoneFromCrm = (customer: any): string | null => {
  const primary = customer.phoneNumbers?.find((item: any) => item.isPrimary);
  if (primary?.number) return primary.number;
  if (customer.phoneNumbers?.length) return customer.phoneNumbers[0].number;
  return customer.homeNumber || customer.workNumber || null;
};

async function main() {
  const dryRun = !process.argv.includes('--apply');

  const report = {
    dryRun,
    totalLegacy: 0,
    inserted: 0,
    skipped: 0,
    failed: 0,
    skippedItems: [] as Array<{ legacyId: string; reason: string; key: string }>,
    failedItems: [] as Array<{ legacyId: string; reason: string }>
  };

  console.log(`[legacy->crm] Starting migration (${dryRun ? 'dry-run' : 'apply'})`);

  const legacyCustomers: LegacyCustomer[] = await prisma.customer.findMany({
    where: { isActive: true },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      companyName: true,
      phone: true,
      address: true,
      city: true,
      country: true,
      isActive: true
    },
    orderBy: { createdAt: 'asc' }
  });

  report.totalLegacy = legacyCustomers.length;

  const existingCrmCustomers = await prisma.crmCustomer.findMany({
    select: {
      id: true,
      firstName: true,
      lastName: true,
      nationalCode: true,
      homeNumber: true,
      workNumber: true,
      phoneNumbers: {
        where: { isActive: true },
        select: { number: true, isPrimary: true }
      }
    }
  });

  const existingKeys = new Set<string>();
  for (const customer of existingCrmCustomers) {
    const nationalCodeKey = buildNationalCodeKey(customer.nationalCode);
    if (nationalCodeKey) {
      existingKeys.add(nationalCodeKey);
      continue;
    }
    const key = buildNamePhoneKey(
      customer.firstName,
      customer.lastName,
      getPrimaryPhoneFromCrm(customer)
    );
    existingKeys.add(key);
  }

  for (const legacy of legacyCustomers) {
    const dedupeKey = buildNamePhoneKey(legacy.firstName, legacy.lastName, legacy.phone);

    if (existingKeys.has(dedupeKey)) {
      report.skipped += 1;
      report.skippedItems.push({
        legacyId: legacy.id,
        reason: 'duplicate',
        key: dedupeKey
      });
      continue;
    }

    try {
      if (!dryRun) {
        await prisma.crmCustomer.create({
          data: {
            firstName: legacy.firstName,
            lastName: legacy.lastName,
            companyName: legacy.companyName,
            customerType: 'Individual',
            status: 'Active',
            homeAddress: legacy.address,
            city: legacy.city,
            country: legacy.country || 'ایران',
            homeNumber: legacy.phone,
            isBlacklisted: false,
            isLocked: false,
            isActive: true,
            phoneNumbers: legacy.phone
              ? {
                  create: {
                    number: legacy.phone,
                    type: 'mobile',
                    isPrimary: true,
                    isActive: true
                  }
                }
              : undefined
          }
        });
      }

      existingKeys.add(dedupeKey);
      report.inserted += 1;
    } catch (error: any) {
      report.failed += 1;
      report.failedItems.push({
        legacyId: legacy.id,
        reason: error?.message || 'unknown_error'
      });
    }
  }

  console.log('[legacy->crm] Migration report:');
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error('[legacy->crm] Fatal error:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
