const CATEGORY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  CUSTOMER_IDENTITY: 'هویت مشتری',
  AMOUNT_PRICING: 'مبلغ و قیمت',
  PAYMENT_PLAN: 'برنامه پرداخت',
  DELIVERY_SCHEDULE: 'برنامه تحویل',
  TAX_INFO: 'اطلاعات مالیاتی',
  DOCUMENT_SIGNATURE: 'اسناد و امضا',
  OTHER: 'سایر',
});

export const contractCorrectionCategoryLabel = (category: string): string =>
  CATEGORY_LABELS[category] || CATEGORY_LABELS.OTHER;

export const contractCorrectionBannerTitle = (accountantNote: string): string => {
  const note = accountantNote.trim();
  return note
    ? `اصلاح قرارداد با تأیید حسابداری — ${note}`
    : 'اصلاح قرارداد با تأیید حسابداری';
};
