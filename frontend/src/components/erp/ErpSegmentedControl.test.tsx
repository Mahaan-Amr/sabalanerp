import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErpSegmentedControl } from './index';

test('segmented control makes the pressed option visually and accessibly distinct without a checkmark', () => {
  const html = renderToStaticMarkup(
    <ErpSegmentedControl
      value="POSITIVE"
      onChange={() => undefined}
      options={[
        { value: 'POSITIVE', label: 'مثبت' },
        { value: 'NEGATIVE', label: 'منفی' },
      ]}
    />,
  );

  const pressedButton = html.match(/<button[^>]*aria-pressed="true"[^>]*>.*?<\/button>/)?.[0];
  assert.ok(pressedButton, 'the active option must expose aria-pressed=true');
  assert.match(pressedButton, /border-\[var\(--sds-accent\)\]/);
  assert.match(pressedButton, /bg-\[var\(--sds-accent-soft\)\]/);
  assert.match(pressedButton, /text-\[var\(--sds-text-primary\)\]/);
  assert.match(pressedButton, /focus-visible:ring-2/);
  assert.doesNotMatch(pressedButton, /<svg/);
});
