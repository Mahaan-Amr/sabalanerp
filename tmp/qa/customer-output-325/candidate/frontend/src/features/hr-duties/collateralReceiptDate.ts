import moment from 'moment-jalaali';
import { toIsoDate } from '@/features/hr/hrUi';

export const collateralReceiptDatePayload = (jalaliDate: string) => toIsoDate(jalaliDate);

export const isFutureCollateralReceiptDate = (jalaliDate: string, todayJalali: string) =>
  moment(jalaliDate, 'jYYYY/jMM/jDD', true).isAfter(moment(todayJalali, 'jYYYY/jMM/jDD', true), 'day');
