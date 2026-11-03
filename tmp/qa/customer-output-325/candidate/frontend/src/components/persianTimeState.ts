export type TimePeriod = 'AM' | 'PM';

export type PersianTimeSelection = {
  hour: number;
  minute: number;
  period: TimePeriod;
};

export type PersianTimeDraft = {
  selection: PersianTimeSelection;
  commitValue: string | null;
};

export type PersianTimeDraftAction =
  | { type: 'CHANGE_HOUR'; hour: number }
  | { type: 'CHANGE_MINUTE'; minute: number }
  | { type: 'CHANGE_PERIOD'; period: TimePeriod }
  | { type: 'CONFIRM' };

export const parseTimeSelection = (value?: string | null): PersianTimeSelection => {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  const hour24 = match ? Number(match[1]) : 8;
  return {
    hour: hour24 % 12 || 12,
    minute: match ? Number(match[2]) : 0,
    period: hour24 >= 12 ? 'PM' : 'AM',
  };
};

export const to24HourTime = ({ hour, minute, period }: PersianTimeSelection) => {
  const hour24 = period === 'AM' ? hour % 12 : (hour % 12) + 12;
  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

export const reduceTimeDraft = (
  state: PersianTimeDraft,
  action: PersianTimeDraftAction,
): PersianTimeDraft => {
  if (action.type === 'CONFIRM') {
    return { ...state, commitValue: to24HourTime(state.selection) };
  }
  if (action.type === 'CHANGE_HOUR') {
    return { selection: { ...state.selection, hour: action.hour }, commitValue: null };
  }
  if (action.type === 'CHANGE_MINUTE') {
    return { selection: { ...state.selection, minute: action.minute }, commitValue: null };
  }
  return { selection: { ...state.selection, period: action.period }, commitValue: null };
};

export const formatTime12 = (value?: string | null) => {
  if (!value) return '';
  const parsed = parseTimeSelection(value);
  return `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')} ${parsed.period}`;
};

export const stepTimeSelection = (
  selection: PersianTimeSelection,
  field: 'hour' | 'minute',
  delta: number,
): PersianTimeSelection => {
  if (field === 'hour') {
    return { ...selection, hour: ((selection.hour - 1 + delta + 12) % 12) + 1 };
  }
  return { ...selection, minute: (selection.minute + delta + 60) % 60 };
};
