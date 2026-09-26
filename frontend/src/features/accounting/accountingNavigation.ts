export type AccountingNavigationLink = {
  label: string;
  href: string;
  description?: string;
};

export type AccountingNavigationGroup = {
  id: 'review' | 'money' | 'records' | 'reports';
  label: string;
  description: string;
  links: readonly AccountingNavigationLink[];
};

/** Grouping changes navigation only. Every existing Accounting route keeps its own writer and history. */
export const accountingNavigationGroups: readonly AccountingNavigationGroup[] = [
  {
    id: 'review', label: 'بررسی و پیگیری', description: 'قراردادها، صورتحساب‌ها و اصلاحات',
    links: [
      { label: 'قراردادهای قابل بررسی', href: '/dashboard/accounting/contracts' },
      { label: 'پیش‌نویس صورتحساب‌ها', href: '/dashboard/accounting/invoice-candidates' },
      { label: 'درخواست‌های اصلاح', href: '/dashboard/accounting/correction-requests' },
      { label: 'اسناد ارسال مشتری', href: '/dashboard/accounting/dispatch-documents' },
      { label: 'فرمان‌های ارسال', href: '/dashboard/accounting/dispatch' },
    ],
  },
  {
    id: 'money', label: 'دریافت و پرداخت', description: 'حساب مشتری، بانک، صندوق، چک و تنخواه',
    links: [
      { label: 'دریافتنی‌ها', href: '/dashboard/accounting/receivables' },
      { label: 'حساب‌های مالی مشتریان', href: '/dashboard/accounting/customer-accounts' },
      { label: 'دریافت‌ها و چک‌ها', href: '/dashboard/accounting/payments' },
      { label: 'بانک، صندوق و تنخواه', href: '/dashboard/accounting/treasury' },
    ],
  },
  {
    id: 'records', label: 'ثبت و دارایی', description: 'دفترکل، خرید، موجودی، دارایی ثابت و حقوق',
    links: [
      { label: 'دفترکل و کدینگ', href: '/dashboard/accounting/ledger' },
      { label: 'خرید، موجودی و بهای تمام‌شده', href: '/dashboard/accounting/supply-chain' },
      { label: 'دارایی ثابت', href: '/dashboard/accounting/period-end?tab=assets' },
      { label: 'حقوق و تعهدات', href: '/dashboard/accounting/period-end?tab=payroll' },
    ],
  },
  {
    id: 'reports', label: 'گزارش و تنظیمات', description: 'گزارش‌های رسمی، مالیات، سوابق و تنظیمات',
    links: [
      { label: 'گزارش‌های رسمی', href: '/dashboard/accounting/period-end?tab=reports' },
      { label: 'بستن دوره', href: '/dashboard/accounting/period-end?tab=close' },
      { label: 'مالیات و سامانه مؤدیان', href: '/dashboard/accounting/tax' },
      { label: 'عملیات مالیاتی قطعی', href: '/dashboard/accounting/tax-center' },
      { label: 'سوابق عملیات', href: '/dashboard/accounting/audit' },
      { label: 'عملکرد حسابداران', href: '/dashboard/accounting/performance' },
      { label: 'تنظیمات حسابداری', href: '/dashboard/accounting/settings' },
    ],
  },
];

export const accountingGroupHref = (id: AccountingNavigationGroup['id']) => `/dashboard/accounting/workflows/${id}`;
