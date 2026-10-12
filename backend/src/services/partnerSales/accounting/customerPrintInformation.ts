/** Allowlisted customer context for the internal PDF; no retail terms or collections. */
export const partnerCustomerPrintSelect = {
  nationalCode: true, companyName: true, brandName: true,
  projectManagerName: true, projectManagerNumber: true,
} as const;

export const partnerPrintValue = (value: string | null | undefined): string => value?.trim() || '--';
