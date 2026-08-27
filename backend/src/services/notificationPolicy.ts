import { PARTNER_NOTIFICATION_EVENTS } from './partnerSales/notifications/definitions';

export type NotificationPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type NotificationChannel = 'IN_APP' | 'REALTIME' | 'WEB_PUSH';
export type NotificationRecipientResolver =
  | 'DIRECT_USER'
  | 'ACTIVE_ADMINS'
  | 'SECURITY_INCIDENT_HANDLERS'
  | 'WORKSPACE_USERS'
  | 'HR_AUTHORITIES'
  | 'WORKSPACE_MANAGERS'
  | 'RESOURCE_OWNER'
  | 'EXPLICIT_WATCHERS';

export interface RegisteredNotificationEvent {
  type: string;
  mandatory: boolean;
  titleTemplate: string;
  messageTemplate: string;
  priority: NotificationPriority;
  allowedVariables: readonly string[];
  allowedChannels: readonly NotificationChannel[];
  allowedRecipientResolvers: readonly NotificationRecipientResolver[];
}

export interface NotificationPolicyDraft {
  enabled: boolean;
  titleTemplate: string;
  messageTemplate: string;
  priority: NotificationPriority;
  channels: NotificationChannel[];
  recipientResolvers: NotificationRecipientResolver[];
}

const REGISTERED_NOTIFICATION_EVENTS = {
  ...PARTNER_NOTIFICATION_EVENTS,
  HR_DUTY_ASSIGNED: {
    type: 'HR_DUTY_ASSIGNED', mandatory: true,
    titleTemplate: 'وظیفه جدید', messageTemplate: 'یک وظیفه جدید در فضای کاری شما آماده رسیدگی است.',
    priority: 'HIGH', allowedVariables: [],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['DIRECT_USER'],
  },
  HR_DUTY_UNASSIGNED_TRIAGE: {
    type: 'HR_DUTY_UNASSIGNED_TRIAGE', mandatory: true,
    titleTemplate: 'وظیفه بدون مسئول', messageTemplate: 'یک وظیفه برای تعیین مسئول در صف مدیریت فضای کاری قرار گرفت.',
    priority: 'URGENT', allowedVariables: [],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['WORKSPACE_MANAGERS'],
  },
  HR_DUTY_NEAR_DUE: {
    type: 'HR_DUTY_NEAR_DUE', mandatory: true,
    titleTemplate: 'مهلت وظیفه نزدیک است', messageTemplate: 'مهلت یکی از وظایف فضای کاری شما نزدیک است.',
    priority: 'HIGH', allowedVariables: [],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['DIRECT_USER'],
  },
  HR_DUTY_OVERDUE: {
    type: 'HR_DUTY_OVERDUE', mandatory: true,
    titleTemplate: 'وظیفه معوق', messageTemplate: 'مهلت یکی از وظایف فضای کاری شما گذشته است.',
    priority: 'URGENT', allowedVariables: [],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['DIRECT_USER'],
  },
  HR_DUTY_REASSIGNED: {
    type: 'HR_DUTY_REASSIGNED', mandatory: true,
    titleTemplate: 'تغییر مسئول وظیفه', messageTemplate: 'مسئولیت یک وظیفه به شما واگذار شده است.',
    priority: 'HIGH', allowedVariables: [],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['DIRECT_USER'],
  },
  HR_DUTY_RESULT: {
    type: 'HR_DUTY_RESULT', mandatory: true,
    titleTemplate: 'نتیجه وظیفه ثبت شد', messageTemplate: 'نتیجه ساختاریافته یک وظیفه ثبت و به مبدأ بازگردانده شد.',
    priority: 'HIGH', allowedVariables: [],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['DIRECT_USER', 'WORKSPACE_MANAGERS'],
  },
  HR_DUTY_MANAGER_ESCALATION: {
    type: 'HR_DUTY_MANAGER_ESCALATION', mandatory: true,
    titleTemplate: 'وظیفه بیش از ۲۴ ساعت معوق است', messageTemplate: 'یک وظیفه معوق به صف مدیریت فضای کاری ارجاع شد.',
    priority: 'URGENT', allowedVariables: [],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['WORKSPACE_MANAGERS'],
  },
  DEPLOYMENT_COMPLETED: {
    type: 'DEPLOYMENT_COMPLETED',
    mandatory: true,
    titleTemplate: 'استقرار سامانه با موفقیت کامل شد',
    messageTemplate: 'نسخه {{releaseId}} با وضعیت {{result}} تکمیل شد.',
    priority: 'HIGH',
    allowedVariables: ['releaseId', 'result'],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['ACTIVE_ADMINS'],
  },
  DEPLOYMENT_FAILED: {
    type: 'DEPLOYMENT_FAILED',
    mandatory: true,
    titleTemplate: 'هشدار فوری استقرار سامانه',
    messageTemplate: 'استقرار نسخه {{releaseId}} با وضعیت {{result}} متوقف شد.',
    priority: 'URGENT',
    allowedVariables: ['releaseId', 'result'],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['ACTIVE_ADMINS'],
  },
  FAILED_LOGIN_ALERT: {
    type: 'FAILED_LOGIN_ALERT',
    mandatory: true,
    titleTemplate: 'هشدار تلاش ورود ناموفق',
    messageTemplate: 'تلاش‌های ورود ناموفق مشکوک برای {{alertKey}}',
    priority: 'URGENT',
    allowedVariables: ['alertKey'],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['ACTIVE_ADMINS'],
  },
  HIRING_CHECKLIST_OVERDUE: {
    type: 'HIRING_CHECKLIST_OVERDUE',
    mandatory: false,
    titleTemplate: 'پیگیری الزام معوق جذب',
    messageTemplate: 'الزام «{{itemTitle}}» برای {{candidateName}} در جایگاه {{positionTitle}} معوق شده است.',
    priority: 'HIGH',
    allowedVariables: ['itemTitle', 'candidateName', 'positionTitle'],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['HR_AUTHORITIES'],
  },
  HIRING_INVITATION_SMS_FAILED: {
    type: 'HIRING_INVITATION_SMS_FAILED',
    mandatory: true,
    titleTemplate: 'عدم تحویل پیامک دعوت استخدام',
    messageTemplate: 'SMS.ir عدم تحویل پیامک دعوت متقاضی را گزارش کرده است.',
    priority: 'HIGH',
    allowedVariables: [],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['HR_AUTHORITIES'],
  },
  HIRING_OFFER_DECLINED: {
    type: 'HIRING_OFFER_DECLINED',
    mandatory: true,
    titleTemplate: 'رد پیشنهاد همکاری',
    messageTemplate: '{{candidateName}} پیشنهاد جایگاه {{positionTitle}} را رد کرد. دسته دلیل: {{declineCategory}} — توضیح متقاضی: {{decisionNote}}',
    priority: 'HIGH',
    allowedVariables: ['candidateName', 'positionTitle', 'declineCategory', 'decisionNote'],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['HR_AUTHORITIES'],
  },
  HIRING_OFFER_ACCEPTED: {
    type: 'HIRING_OFFER_ACCEPTED',
    mandatory: true,
    titleTemplate: 'پذیرش پیشنهاد همکاری',
    messageTemplate: '{{candidateName}} پیشنهاد جایگاه {{positionTitle}} را پذیرفت.',
    priority: 'HIGH',
    allowedVariables: ['candidateName', 'positionTitle', 'declineCategory', 'decisionNote'],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['HR_AUTHORITIES'],
  },
  HIRING_SHARED_WORK_AVAILABLE: {
    type: 'HIRING_SHARED_WORK_AVAILABLE',
    mandatory: true,
    titleTemplate: 'کار مشترک استخدام آماده رسیدگی است',
    messageTemplate: 'اقدام «{{actionLabel}}» برای {{candidateName}} آماده رسیدگی است.',
    priority: 'HIGH',
    allowedVariables: ['actionLabel', 'candidateName'],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['DIRECT_USER'],
  },
  NEW_BROWSER_LOGIN: {
    type: 'NEW_BROWSER_LOGIN',
    mandatory: true,
    titleTemplate: 'ورود از مرورگر جدید',
    messageTemplate: '{{browser}} · {{operatingSystem}} · {{ipAddress}}',
    priority: 'URGENT',
    allowedVariables: ['browser', 'operatingSystem', 'ipAddress'],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['DIRECT_USER'],
  },
  RECOVERY_BACKUP_STALE: {
    type: 'RECOVERY_BACKUP_STALE',
    mandatory: true,
    titleTemplate: 'نسخه پشتیبان بازیابی به‌روز نیست',
    messageTemplate: 'بیش از هفت روز است که نسخه پشتیبان کامل دانلود نشده است. فایل باقی‌مانده روی همین سرور محافظت در برابر خرابی سرور نیست.',
    priority: 'URGENT',
    allowedVariables: [],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['ACTIVE_ADMINS'],
  },
  SYSTEM_RECOVERY_COMPLETED: {
    type: 'SYSTEM_RECOVERY_COMPLETED',
    mandatory: true,
    titleTemplate: 'بازیابی کامل سامانه انجام شد',
    messageTemplate: 'بازیابی توسط {{actorDisplay}} تکمیل شد. ورود دوباره برای همه کاربران الزامی است.',
    priority: 'URGENT',
    allowedVariables: ['actorDisplay'],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['ACTIVE_ADMINS'],
  },
  SYSTEM_RECOVERY_STARTED: {
    type: 'SYSTEM_RECOVERY_STARTED',
    mandatory: true,
    titleTemplate: 'بازیابی کامل سامانه آغاز شد',
    messageTemplate: 'بازیابی توسط {{actorDisplay}} آغاز شد.',
    priority: 'URGENT',
    allowedVariables: ['actorDisplay'],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['ACTIVE_ADMINS'],
  },
  SUPPORT_TICKET_CREATED: {
    type: 'SUPPORT_TICKET_CREATED',
    mandatory: true,
    titleTemplate: 'تیکت پشتیبانی جدید',
    messageTemplate: 'تیکت {{referenceCode}} توسط {{reporterName}} ثبت شد.',
    priority: 'HIGH',
    allowedVariables: ['referenceCode', 'reporterName'],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['ACTIVE_ADMINS', 'SECURITY_INCIDENT_HANDLERS', 'WORKSPACE_MANAGERS'],
  },
  SUPPORT_TICKET_ASSIGNED: {
    type: 'SUPPORT_TICKET_ASSIGNED',
    mandatory: true,
    titleTemplate: 'تیکت پشتیبانی به شما ارجاع شد',
    messageTemplate: 'رسیدگی به تیکت {{referenceCode}} به شما واگذار شد.',
    priority: 'HIGH',
    allowedVariables: ['referenceCode'],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['DIRECT_USER'],
  },
  SUPPORT_TICKET_RESPONSE: {
    type: 'SUPPORT_TICKET_RESPONSE',
    mandatory: true,
    titleTemplate: 'پاسخ جدید به تیکت',
    messageTemplate: 'برای تیکت {{referenceCode}} پاسخ جدیدی ثبت شد.',
    priority: 'HIGH',
    allowedVariables: ['referenceCode'],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['DIRECT_USER', 'EXPLICIT_WATCHERS'],
  },
  SUPPORT_TICKET_REPORTER_REMINDER: {
    type: 'SUPPORT_TICKET_REPORTER_REMINDER',
    mandatory: true,
    titleTemplate: 'تیکت منتظر پاسخ شماست',
    messageTemplate: 'برای ادامه رسیدگی به تیکت {{referenceCode}} پاسخ دهید.',
    priority: 'HIGH',
    allowedVariables: ['referenceCode'],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['DIRECT_USER'],
  },
  SUPPORT_TICKET_SLA_WARNING: {
    type: 'SUPPORT_TICKET_SLA_WARNING',
    mandatory: true,
    titleTemplate: 'در آستانه تأخیر',
    messageTemplate: 'تیکت {{referenceCode}} به زمان هدف نزدیک شده است.',
    priority: 'URGENT',
    allowedVariables: ['referenceCode'],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['DIRECT_USER'],
  },
  SUPPORT_TICKET_SLA_BREACHED: {
    type: 'SUPPORT_TICKET_SLA_BREACHED',
    mandatory: true,
    titleTemplate: 'تأخیر در رسیدگی',
    messageTemplate: 'زمان هدف تیکت {{referenceCode}} گذشته است.',
    priority: 'URGENT',
    allowedVariables: ['referenceCode'],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['WORKSPACE_MANAGERS', 'ACTIVE_ADMINS'],
  },
  SALES_CONTRACT_READY_FOR_ACCOUNTING: {
    type: 'SALES_CONTRACT_READY_FOR_ACCOUNTING',
    mandatory: true,
    titleTemplate: 'قرارداد قابل بررسی',
    messageTemplate: 'قرارداد قابل بررسی از {{actorName}}',
    priority: 'HIGH',
    allowedVariables: ['actorName'],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['WORKSPACE_USERS'],
  },
  ACCOUNTING_RECORD_SUBMITTED: {
    type: 'ACCOUNTING_RECORD_SUBMITTED',
    mandatory: true,
    titleTemplate: 'رکورد مالی جدید',
    messageTemplate: 'رکورد مالی قرارداد {{contractNumber}} توسط {{actorName}} ثبت شد.',
    priority: 'HIGH',
    allowedVariables: ['contractNumber', 'actorName'],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['RESOURCE_OWNER'],
  },
  ACCOUNTING_CORRECTION_REQUIRED: {
    type: 'ACCOUNTING_CORRECTION_REQUIRED',
    mandatory: true,
    titleTemplate: 'نیازمند اصلاح',
    messageTemplate: 'قرارداد {{contractNumber}} نیازمند اصلاح فروش است.',
    priority: 'URGENT',
    allowedVariables: ['contractNumber'],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['RESOURCE_OWNER'],
  },
  ACCOUNTING_CONTRACT_CORRECTION_EDITED: {
    type: 'ACCOUNTING_CONTRACT_CORRECTION_EDITED',
    mandatory: true,
    titleTemplate: 'اصلاح قرارداد ثبت شد',
    messageTemplate: 'اصلاح قرارداد {{contractNumber}} ثبت و برای بررسی حسابداری آماده شد.',
    priority: 'HIGH',
    allowedVariables: ['contractNumber'],
    allowedChannels: ['IN_APP', 'REALTIME', 'WEB_PUSH'],
    allowedRecipientResolvers: ['DIRECT_USER'],
  },
} as const satisfies Record<string, RegisteredNotificationEvent>;

export type RegisteredNotificationEventType = keyof typeof REGISTERED_NOTIFICATION_EVENTS;

export const notificationEventDefinition = (
  type: RegisteredNotificationEventType,
): RegisteredNotificationEvent => REGISTERED_NOTIFICATION_EVENTS[type];

export const registeredNotificationEventTypes = (): RegisteredNotificationEventType[] =>
  (Object.keys(REGISTERED_NOTIFICATION_EVENTS) as RegisteredNotificationEventType[]).sort();

export const registeredNotificationEventDefinitions = (): RegisteredNotificationEvent[] =>
  registeredNotificationEventTypes().map((type) => notificationEventDefinition(type));

const templateVariables = (template: string): string[] =>
  [...template.matchAll(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g)].map((match) => match[1]);

export const validateNotificationPolicyDraft = (
  definition: RegisteredNotificationEvent,
  draft: NotificationPolicyDraft,
): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  if (definition.mandatory && !draft.enabled) {
    errors.push('اعلان الزامی را نمی‌توان غیرفعال کرد.');
  }

  const variables = [...templateVariables(draft.titleTemplate), ...templateVariables(draft.messageTemplate)];
  for (const variable of variables) {
    if (!definition.allowedVariables.includes(variable)) {
      errors.push(`متغیر «${variable}» برای این رویداد مجاز نیست.`);
    }
  }

  for (const channel of draft.channels) {
    if (!definition.allowedChannels.includes(channel)) {
      errors.push(`کانال «${channel}» برای این رویداد مجاز نیست.`);
    }
  }

  for (const resolver of draft.recipientResolvers) {
    if (!definition.allowedRecipientResolvers.includes(resolver)) {
      errors.push(`مخاطب «${resolver}» برای این رویداد مجاز نیست.`);
    }
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
};

const renderTemplate = (template: string, payload: Record<string, unknown>): string =>
  template.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (_match, variable: string) => {
    const value = payload[variable];
    return value === null || value === undefined ? 'نامشخص' : String(value);
  });

export const renderNotificationPolicy = ({
  definition,
  payload,
  policy,
}: {
  definition: RegisteredNotificationEvent;
  payload: Record<string, unknown>;
  policy?: Partial<Pick<NotificationPolicyDraft, 'titleTemplate' | 'messageTemplate' | 'priority'>>;
}): { title: string; message: string; priority: NotificationPriority } => ({
  title: renderTemplate(policy?.titleTemplate || definition.titleTemplate, payload),
  message: renderTemplate(policy?.messageTemplate || definition.messageTemplate, payload),
  priority: policy?.priority || definition.priority,
});

export const materializeNotificationEvent = ({
  definition,
  actorId,
  recipientIds,
  payload,
  actionUrl,
  policy,
}: {
  definition: RegisteredNotificationEvent;
  actorId?: string | null;
  recipientIds: string[];
  payload: Record<string, unknown>;
  actionUrl?: string | null;
  policy?: Partial<Pick<NotificationPolicyDraft, 'titleTemplate' | 'messageTemplate' | 'priority'>>;
}): {
  recipientIds: string[];
  title: string;
  message: string;
  priority: NotificationPriority;
  actionUrl: string | null;
} => {
  if (actionUrl && (!actionUrl.startsWith('/') || actionUrl.startsWith('//'))) {
    throw new Error('پیوند اعلان باید داخلی باشد.');
  }
  const rendered = renderNotificationPolicy({ definition, payload, policy });
  return {
    ...rendered,
    recipientIds: [...new Set(recipientIds)].filter((userId) => userId !== actorId),
    actionUrl: actionUrl || null,
  };
};

export const privacySafeWebPushPayload = (actionUrl?: string | null) => {
  if (actionUrl && (!actionUrl.startsWith('/') || actionUrl.startsWith('//'))) {
    throw new Error('پیوند اعلان باید داخلی باشد.');
  }
  return {
    title: 'سبلان ERP',
    body: 'یک اعلان جدید در سبلان دارید.',
    url: actionUrl || '/dashboard',
  };
};
