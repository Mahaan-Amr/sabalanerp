"use client";

import PersianCalendarComponent, {
  type PersianCalendarProps,
} from "@/components/PersianCalendar";

export const withAuthenticatedHrCalendarDefaults = (
  props: PersianCalendarProps,
): PersianCalendarProps => ({
  ...props,
  enableYearSelection: true,
});

export default function HrPersianCalendar(props: PersianCalendarProps) {
  return (
    <PersianCalendarComponent
      {...withAuthenticatedHrCalendarDefaults(props)}
    />
  );
}
