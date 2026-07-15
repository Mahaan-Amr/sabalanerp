export interface SecurityPersonnelSummary {
  name: string;
  position: string;
  department: string | null;
}

export const getSecurityDashboardDescription = (
  securityPersonnel: SecurityPersonnelSummary | null
): string => securityPersonnel
  ? `${securityPersonnel.name || 'کاربر حراست'} - ${securityPersonnel.position || 'اپراتور شیفت'}`
  : 'مدیریت حراست - بدون عضویت عملیاتی در شیفت';
