const labels: Record<string, string> = {
  ACTIVE: 'فعال', INACTIVE: 'غیرفعال', ARCHIVED: 'بایگانی‌شده', DRAFT: 'پیش‌نویس',
  PENDING: 'در انتظار بررسی', PENDING_APPROVAL: 'در انتظار تأیید', APPROVED: 'تأییدشده',
  REJECTED: 'ردشده', SIGNED: 'امضاشده', CANCELLED: 'لغوشده', VOIDED: 'باطل‌شده',
  COMPLETED: 'تکمیل‌شده', OPEN: 'باز', CLOSED: 'بسته‌شده', READY: 'آماده',
  NEEDS_ATTENTION: 'نیازمند رسیدگی', NEEDS_CORRECTION: 'نیازمند اصلاح', REVIEW_REQUIRED: 'نیازمند بررسی',
  RECONCILED: 'تطبیق داده‌شده', RESOLVED: 'رفع‌شده', ELIGIBLE: 'مجاز به رانندگی',
  SUSPENDED: 'تعلیق‌شده', OUT_OF_SERVICE: 'خارج از سرویس', RETIRED: 'از رده خارج',
  FINALIZED: 'نهایی‌شده', ISSUED: 'صادرشده', POSTED: 'ثبت نهایی‌شده', ACCEPTED: 'پذیرفته‌شده',
  RETURNED: 'برای اصلاح بازگردانده‌شده', WITHDRAWN: 'پس‌گرفته‌شده',
  STALE_REQUIRES_SUCCESSOR: 'نیازمند نسخه جایگزین', EVIDENCE_CONFLICT: 'دارای مغایرت در شواهد',
  WAITING_AT_GATE: 'در انتظار پذیرش گارد', AVAILABLE_FOR_LOADING: 'آماده ورود به بارگیری',
  RESERVED_FOR_LOADING: 'برای بارگیری رزرو شده', LOADING_FINALIZED: 'بارگیری نهایی شده',
  EXIT_RECORDED: 'خروج از مجموعه ثبت شده', CLOSED_WITHOUT_LOADING: 'بدون بارگیری بسته شده',
  WAITING: 'در انتظار', ENTERED_LOADING_AREA: 'وارد محوطه بارگیری', RESERVED: 'رزرو شده',
  DISPATCHED: 'اعزام شده', OUT_OF_QUEUE: 'خارج از صف', ENTRY_RECORDED: 'ورود ثبت شده',
  INFO_COMPLETED: 'اطلاعات تکمیل شده', ENTRY_VOIDED: 'ورود لغو شده', READY_TO_EXIT: 'آماده خروج',
  LIVE: 'زنده‌بودن تأیید شده', SPOOF_DETECTED: 'زنده‌بودن تأیید نشده',
  EXITED: 'خارج شده', EXIT_VOIDED: 'خروج لغو شده', HAS_FINANCIAL_RECORDS: 'دارای سابقه مالی',
  VISIBLE_ONLY: 'فقط قابل مشاهده', PARTIALLY_PAID: 'بخشی پرداخت شده', PAID: 'پرداخت شده',
  SETTLED: 'تسویه شده', OVERDUE: 'سررسید گذشته', RECEIVED: 'دریافت شده', DEPOSITED: 'واگذار شده',
  BOUNCED: 'برگشت خورده', DISPUTED: 'دارای مغایرت', EXPIRED: 'منقضی شده', FAILED: 'ناموفق',
  CONFIRMED: 'تأیید شده', REGISTERED: 'ثبت شده',
};

export const operationalStatusLabel = (status?: string | null) => {
  if (!status) return 'بدون وضعیت';
  return labels[status] || 'وضعیت ثبت‌شده';
};
