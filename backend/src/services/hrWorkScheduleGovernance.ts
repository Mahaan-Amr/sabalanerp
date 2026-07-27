type ScheduleAction = 'PROPOSE' | 'PREPARE' | 'SUBMIT' | 'APPROVE' | 'RETURN';
type Context = {
  isResponsibleSupervisor?: boolean;
  hasHrProcessor?: boolean;
  hasHrManager?: boolean;
  status?: string;
  actorId?: string;
  preparedBy?: string | null;
  returnReason?: string;
};

export const assertWorkScheduleAction = (action: ScheduleAction, context: Context) => {
  if (action === 'PROPOSE') {
    if (!context.isResponsibleSupervisor) throw new Error('فقط سرپرست مسئول فعلی می‌تواند تغییر برنامه کاری را پیشنهاد دهد.');
    return;
  }
  if (action === 'PREPARE') {
    if (!context.hasHrProcessor || !['PROPOSED', 'RETURNED', 'DRAFT'].includes(context.status || '')) {
      throw new Error('فقط کارشناس منابع انسانی می‌تواند درخواست پیشنهادی یا بازگشتی را آماده کند.');
    }
    return;
  }
  if (action === 'SUBMIT') {
    if (!context.hasHrProcessor || context.status !== 'DRAFT') throw new Error('پیش از ارسال، پیش‌نویس آماده‌شده توسط کارشناس منابع انسانی الزامی است.');
    return;
  }
  if (!context.hasHrManager || context.status !== 'SUBMITTED') throw new Error('مدیر منابع انسانی فقط می‌تواند برنامه کاری ارسال‌شده را بررسی کند.');
  if (context.preparedBy && context.preparedBy === context.actorId) throw new Error('بررسی برنامه کاری باید توسط مدیر منابع انسانی دیگری انجام شود.');
  if (action === 'RETURN' && !String(context.returnReason || '').trim()) throw new Error('ثبت دلیل بازگرداندن الزامی است.');
};
