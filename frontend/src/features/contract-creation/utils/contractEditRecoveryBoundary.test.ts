import assert from 'node:assert/strict';
import test from 'node:test';
import { contractEditRecoveryBoundaryProps } from './contractEditRecoveryBoundary';

test('the blocked contract editor uses a boolean inert attribute', () => {
  assert.deepEqual(contractEditRecoveryBoundaryProps(true), {
    'aria-disabled': true,
    inert: true,
    className: 'pointer-events-none select-none opacity-70',
  });
});

test('the available contract editor does not render inert', () => {
  assert.deepEqual(contractEditRecoveryBoundaryProps(false), {
    'aria-disabled': false,
    className: '',
  });
});
