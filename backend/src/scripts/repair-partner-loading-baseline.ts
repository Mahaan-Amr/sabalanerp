import { prisma } from '../lib/prisma';
import { repairPartnerLoadingBaseline } from '../services/partnerSales/fulfillment/baselineRepair';

async function main() {
  const args = process.argv.slice(2);
  const targets = args.filter(argument => argument.startsWith('--contract='));
  const apply = args.includes('--apply');
  const contractNumber = targets[0]?.slice('--contract='.length).trim();
  if (!contractNumber || targets.length !== 1 || args.length !== (apply ? 2 : 1)) {
    throw new Error('Usage: repair-partner-loading-baseline --contract=<customer contract number> [--apply]');
  }
  console.log(JSON.stringify(await repairPartnerLoadingBaseline(prisma, contractNumber, apply)));
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
