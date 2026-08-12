import assert from 'node:assert/strict';
import { isCalendarOwnedInteraction } from '../calendarOverlayPolicy';

const nestedTimePickerTarget = {
  closest: (selector: string) => selector === '[data-persian-calendar-owned-overlay="true"]'
    ? { dataset: { persianCalendarOwnedOverlay: 'true' } }
    : null,
};

assert.equal(
  isCalendarOwnedInteraction({
    target: nestedTimePickerTarget,
    triggerContains: false,
    panelContains: false,
  }),
  true,
  'a time-picker portal opened from the calendar must not be treated as an outside click',
);

assert.equal(
  isCalendarOwnedInteraction({
    target: { closest: () => null },
    triggerContains: false,
    panelContains: false,
  }),
  false,
  'an unrelated page target must still close the calendar',
);

assert.equal(
  isCalendarOwnedInteraction({
    target: null,
    triggerContains: true,
    panelContains: false,
  }),
  true,
);

console.log('Calendar overlay policy tests passed.');
