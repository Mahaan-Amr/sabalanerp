import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const origin = 'http://127.0.0.1:5000/api';
const login = await fetch(`${origin}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent':'OrdinaryContractLocalQA' },
  body: JSON.stringify({ identifier: 'admin', password: process.env.SABALAN_SMOKE_PASSWORD }) });
assert.equal(login.status, 200);
const cookie = login.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
try {
  for (const variant of ['original','accounting','workshop','custom']) {
    const response = await fetch(`${origin}/accounting/contracts/qa-ordinary-commercial-note/sales-pdf?variant=${variant}&download=true`, { headers: { cookie } });
    assert.equal(response.status, 200, `${variant}: ${await (response.status!==200?response.text():Promise.resolve(''))}`);
    const pdf = Buffer.from(await response.arrayBuffer());
    assert.equal(pdf.subarray(0,4).toString(), '%PDF');
    await writeFile(`reports/qa/ordinary-contract-lifecycle/${variant}.pdf`,pdf);
    console.log(`${variant}: HTTP200 PDF ${pdf.length} bytes`);
  }
} finally {
  await fetch(`${origin}/auth/logout`, { method: 'POST', headers: { cookie } });
}
