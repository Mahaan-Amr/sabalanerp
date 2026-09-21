import type { PartnerTechnicalFamily } from '@sabalanerp/partner-sales-contracts';

export const partnerSelectableFamilies = ['longitudinal', 'stair', 'slab', 'prepared'] as const satisfies readonly PartnerTechnicalFamily[];

export function partnerRetailPriceUnitLabel(input: { family: typeof partnerSelectableFamilies[number]; part?: 'tread' | 'riser' | 'landing' }): string {
  if (input.family === 'longitudinal') return 'فی هر مترمربع (تومان)';
  if (input.family === 'slab') return 'فی سنگ مادر مصرفی (تومان)';
  if (input.family === 'prepared') return 'قیمت واحد (تومان)';
  if (input.part === 'riser') return 'فی خیز (تومان)';
  if (input.part === 'landing') return 'فی پاگرد (تومان)';
  return 'فی کف پله (تومان)';
}
