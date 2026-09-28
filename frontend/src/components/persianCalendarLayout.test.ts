import assert from 'node:assert/strict';
import test from 'node:test';
import { persianCalendarLayout } from './persianCalendarLayout';

test('date and time panel stays inside short, zoomed and scrolled viewports', () => {
  for (const height of [200, 480, 768]) for (const top of [0, 380, 900]) {
    const layout = persianCalendarLayout({ width: 500, top, bottom: top + 48, left: 800 }, { width: 900, height }, 510);
    assert.ok(layout.top >= 16);
    assert.ok(layout.top + layout.maxHeight <= height - 16);
    assert.ok(layout.left + layout.width <= 884);
  }
});
