import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../../apps/attendance-connector-windows/Read-Attendance.ps1', import.meta.url), 'utf8');
test('terminal SDK surface is restricted to session authentication, connect, read and disconnect', () => {
  const methods = [...new Set([...source.matchAll(/\$sdk\.([A-Za-z_][A-Za-z_0-9]*)\s*\(/g)].map(m => m[1]))].sort();
  assert.deepEqual(methods, ['Connect_Net', 'Disconnect', 'GetDeviceTime', 'ReadGeneralLogData', 'SSR_GetGeneralLogData', 'SetCommPassword']);
});
