type ClosestTarget = {
  closest?: (selector: string) => unknown;
};

export const PERSIAN_CALENDAR_OWNED_OVERLAY_SELECTOR =
  '[data-persian-calendar-owned-overlay="true"]';

export const isCalendarOwnedInteraction = ({
  target,
  triggerContains,
  panelContains,
}: {
  target: ClosestTarget | null;
  triggerContains: boolean;
  panelContains: boolean;
}): boolean => (
  triggerContains ||
  panelContains ||
  Boolean(target?.closest?.(PERSIAN_CALENDAR_OWNED_OVERLAY_SELECTOR))
);
