import type { Prisma } from '@prisma/client';

export type PersonnelLinkClient = Pick<Prisma.TransactionClient, 'personnel'>;

export const LEGACY_PERSONNEL_WRITE_DISABLED = {
  success: false,
  code: 'LEGACY_PERSONNEL_WRITE_DISABLED',
  error: 'ویرایش پرسنل از مسیر قدیمی متوقف شده است؛ اطلاعات نیروی انسانی را در فضای کاری منابع انسانی تغییر دهید.',
  canonicalPath: '/dashboard/hr/personnel'
} as const;

export const resolveExistingPersonnelLink = async (
  client: PersonnelLinkClient,
  input: { personnelId?: string | null; currentUserId?: string }
) => {
  const personnelId = String(input.personnelId || '').trim();
  if (!personnelId) return null;

  const personnel = await client.personnel.findUnique({
    where: { id: personnelId },
    include: { user: { select: { id: true } } }
  });

  if (!personnel) throw new Error('پرسنل انتخاب‌شده پیدا نشد.');
  if (personnel.user && personnel.user.id !== input.currentUserId) {
    throw new Error('این پرسنل قبلاً به کاربر دیگری متصل شده است.');
  }
  return personnel.id;
};

export const assertSubsequentEmploymentRelationship = (existingRelationshipCount: number) => {
  if (existingRelationshipCount < 1) {
    throw new Error('رابطه استخدامی اولیه باید از پرونده جذب یا مسیر صریح ثبت استثنایی ایجاد شود.');
  }
};
