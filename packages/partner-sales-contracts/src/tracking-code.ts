/** The full UUID remains an internal evidence identity. Only the independent
 * numeric tracking number is suitable for customer-facing labels. */
export function partnerTrackingCode(_caseNumber: string, trackingNumber?: number | null): string {
  if (trackingNumber && Number.isSafeInteger(trackingNumber) && trackingNumber > 0) {
    return `همکار-${trackingNumber.toLocaleString('fa-IR', { useGrouping: false, minimumIntegerDigits: 5 })}`;
  }
  return 'همکار';
}

export function partnerCustomerContractLabel(caseNumber: string, customerContractNumber?: string | null,
  trackingNumber?: number | null): string {
  return customerContractNumber || partnerTrackingCode(caseNumber, trackingNumber);
}
