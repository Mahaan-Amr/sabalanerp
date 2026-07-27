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
    if (!context.isResponsibleSupervisor) throw new Error('Only the current responsible supervisor may propose a schedule change.');
    return;
  }
  if (action === 'PREPARE') {
    if (!context.hasHrProcessor || !['PROPOSED', 'RETURNED', 'DRAFT'].includes(context.status || '')) {
      throw new Error('HR Processor may prepare a proposed or returned schedule change.');
    }
    return;
  }
  if (action === 'SUBMIT') {
    if (!context.hasHrProcessor || context.status !== 'DRAFT') throw new Error('A prepared draft is required before submission.');
    return;
  }
  if (!context.hasHrManager || context.status !== 'SUBMITTED') throw new Error('HR Manager may review only a submitted schedule change.');
  if (action === 'APPROVE' && context.preparedBy === context.actorId) throw new Error('A different HR Manager must approve the prepared schedule.');
  if (action === 'RETURN' && !String(context.returnReason || '').trim()) throw new Error('A return reason is required.');
};
