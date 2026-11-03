export type NotificationCategory = 'SECURITY' | 'HIRING' | 'SUPPORT' | 'RECOVERY' | 'SALES' | 'ACCOUNTING' | 'SYSTEM';

const persianDigitMap: Record<string, string> = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

export const normalizePersianSearchText = (value: unknown): string => String(value ?? '')
  .normalize('NFKC')
  .replace(/[يى]/g, 'ی')
  .replace(/ك/g, 'ک')
  .replace(/[ۀة]/g, 'ه')
  .replace(/[ؤ]/g, 'و')
  .replace(/[إأ]/g, 'ا')
  .replace(/[۰-۹٠-٩]/g, (digit) => persianDigitMap[digit] || digit)
  .replace(/[\u064B-\u065F\u0670]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLocaleLowerCase('fa-IR');

export const notificationMatchesSearch = (
  notification: Pick<{ title: string; message: string }, 'title' | 'message'>,
  query: string,
): boolean => {
  const normalizedQuery = normalizePersianSearchText(query);
  if (!normalizedQuery) return true;
  return normalizePersianSearchText(notification.title).includes(normalizedQuery)
    || normalizePersianSearchText(notification.message).includes(normalizedQuery);
};

export const notificationCategory = (eventType: string): NotificationCategory => {
  if (eventType === 'NEW_BROWSER_LOGIN' || eventType === 'FAILED_LOGIN_ALERT') return 'SECURITY';
  if (eventType.startsWith('HIRING_')) return 'HIRING';
  if (eventType.startsWith('SUPPORT_')) return 'SUPPORT';
  if (eventType.startsWith('RECOVERY_') || eventType.startsWith('SYSTEM_RECOVERY_')) return 'RECOVERY';
  if (eventType.startsWith('SALES_')) return 'SALES';
  if (eventType.startsWith('ACCOUNTING_')) return 'ACCOUNTING';
  return 'SYSTEM';
};
