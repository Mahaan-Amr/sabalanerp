import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildDispatchConfirmationOtpTemplateParameters,
  buildDispatchExitTemplateParameters,
} from '../smsService';

test('builds the approved driver OTP template parameters with exact SMS.ir casing', () => {
  assert.deepEqual(buildDispatchConfirmationOtpTemplateParameters('173001', '123456'), [
    { name: 'DISPATCHNUMBER', value: '173001' },
    { name: 'CODE', value: '123456' },
  ]);
});

test('rejects incomplete driver OTP template values', () => {
  assert.throws(() => buildDispatchConfirmationOtpTemplateParameters('', '123456'), /Dispatch number/);
  assert.throws(() => buildDispatchConfirmationOtpTemplateParameters('173001', '12345'), /six digits/);
});

test('builds both exit templates with their approved shared parameter casing', () => {
  assert.deepEqual(buildDispatchExitTemplateParameters('153001', '12ع345 ایران 11'), [
    { name: 'DNO', value: '153001' },
    { name: 'PLATE', value: '12ع345 ایران 11' },
  ]);
});

test('rejects incomplete exit template values', () => {
  assert.throws(() => buildDispatchExitTemplateParameters('', '12ع345 ایران 11'), /Dispatch number/);
  assert.throws(() => buildDispatchExitTemplateParameters('153001', ''), /Vehicle plate/);
});
