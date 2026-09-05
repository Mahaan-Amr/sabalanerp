import { PartnerInquiryViewV2Schema, partnerError, type PartnerQueryV2Port } from '@sabalanerp/partner-sales-contracts';
import type { PartnerInquiryView } from './inquiryPresentation';

export interface PartnerInquiryReadState {
  inquiry: PartnerInquiryView | null;
  pending: boolean;
  error?: string;
}

export function createPartnerInquiryReader(queries: PartnerQueryV2Port, inquiryId: string) {
  let sequence = 0;
  let state: PartnerInquiryReadState = { inquiry: null, pending: false };
  const listeners = new Set<() => void>();
  const publish = (next: PartnerInquiryReadState) => {
    state = next;
    listeners.forEach(listener => listener());
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh: async () => {
      const request = ++sequence;
      publish({ ...state, pending: true, error: undefined });
      try {
        const result = await queries.query({ schemaVersion: 2, purpose: 'PARTNER_INQUIRY', inquiryId });
        if (sequence !== request) return;
        if (!result.ok) {
          // A failed read is never permission to keep using an old approval.
          publish({ inquiry: null, pending: false, error: partnerError(result.error.code).message });
          return;
        }
        const parsed = PartnerInquiryViewV2Schema.safeParse(result.value);
        if (!parsed.success || parsed.data.inquiryId !== inquiryId) throw new Error('Invalid inquiry projection');
        publish({ inquiry: parsed.data, pending: false });
      } catch {
        if (sequence === request) publish({ inquiry: null, pending: false, error: 'دریافت پاسخ استعلام انجام نشد. دوباره تلاش کنید؛ اطلاعات پیش‌نویس شما حفظ شده است.' });
      }
    },
  };
}
