import type { PartnerTechnicalFamily } from '@sabalanerp/partner-sales-contracts';

export const partnerSelectableFamilies = ['longitudinal', 'stair', 'slab', 'prepared'] as const satisfies readonly PartnerTechnicalFamily[];

export function partnerRetailPriceUnitLabel(input: { family: typeof partnerSelectableFamilies[number]; part?: 'tread' | 'riser' | 'landing' }): string {
  if (input.family === 'prepared') return 'قیمت واحد (تومان)';
  return 'فی هر مترمربع (تومان)';
}
