/** The full UUID remains the evidence identity. Base 36 is a reversible,
 * collision-free shorter label for the same 128 bits, including old Cases. */
export function partnerTrackingCode(caseNumber: string, trackingNumber?: number | null): string {
  if (trackingNumber && Number.isSafeInteger(trackingNumber) && trackingNumber > 0) {
    return `همکار-${trackingNumber.toLocaleString('fa-IR', { useGrouping: false, minimumIntegerDigits: 5 })}`;
  }
  const uuid = /^PC-([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i.exec(caseNumber);
  if (!uuid) return caseNumber;
  return `همکار-${BigInt(`0x${uuid.slice(1).join('')}`).toString(36).toUpperCase().padStart(25, '0')}`;
}

export function partnerCustomerContractLabel(caseNumber: string, customerContractNumber?: string | null,
  trackingNumber?: number | null): string {
  return customerContractNumber || partnerTrackingCode(caseNumber, trackingNumber);
}
