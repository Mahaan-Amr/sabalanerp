import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { generateCustomerContractPdf } from '../../../backend/src/utils/pdf';
import { createCustomerOutputSnapshots } from '../../../backend/src/services/partnerSales/customerOutput/snapshots';

const requireContract = createRequire(path.resolve(__dirname, '../../../packages/partner-sales-contracts/package.json'));
const contract = requireContract('@sabalanerp/partner-sales-contracts');
const testing = requireContract('@sabalanerp/partner-sales-contracts/testing');
const directory = path.resolve(__dirname, '../../../artifacts');
fs.mkdirSync(directory, { recursive: true });

async function run() {
  for (const count of [1, 45]) {
    const fixture = testing.createPartnerFixtures();
    const { seller, outputHash, ...retail } = fixture.customer;
    retail.products = Array.from({ length: count }, (_, index) => ({ ...retail.products[0], productRowId: `row-${index}`,
      description: `سنگ تراورتن آزمایشی با فرآوری و برش ${index + 1} — توضیح بلند برای بررسی شکست سطر در جدول قرارداد` }));
    retail.deliveries[0].items = retail.products.map((row: { productRowId: string; quantity: string }) => ({ productRowId: row.productRowId, quantity: row.quantity }));
    retail.totals.net = retail.totals.payable = String(count * 2000);
    retail.customerPaymentPlan.installments[0].amount.amount = retail.totals.payable;
    const snapshot = await createCustomerOutputSnapshots(contract).mint({
      snapshotId: `pdf-${count}`, owner: fixture.case.head, normalizedRecipient: '+989120000001',
      createdAt: '2026-08-27T12:00:00.000Z', expiresAt: '2026-10-26T12:00:00.000Z',
      business: { tradeName: 'سنگ آفتاب', legalName: 'شرکت آفتاب', businessPhone: '02111111111', businessAddress: 'تهران، نشانی تجاری آزمایشی' }, retail,
    });
    const bytes = await generateCustomerContractPdf(contract, snapshot.content);
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    const output = path.join(directory, `customer-${count}.pdf`);
    fs.writeFileSync(output, bytes);
    const fonts = execFileSync('pdffonts', [output], { encoding: 'utf8' });
    assert.match(fonts, /Yekan/i);
    fs.writeFileSync(path.join(directory, `customer-${count}.fonts.txt`), fonts);
    const text = execFileSync('pdftotext', ['-layout', output, '-'], { encoding: 'utf8' });
    for (const secret of ['FIXTURE-CASE', 'FIXTURE-INTERNAL', 'fixture-313', 'contractData', 'wholesale']) assert.ok(!text.includes(secret), secret);
    fs.writeFileSync(path.join(directory, `customer-${count}.txt`), text);
    execFileSync('pdftoppm', ['-scale-to', '1400', '-png', output, path.join(directory, `customer-${count}`)]);
    console.log(execFileSync('pdfinfo', [output], { encoding: 'utf8' }).split('\n').filter(line => /Pages:|Page size:|File size:/.test(line)).join('\n'));
  }
}
run().catch(() => { console.error('Customer output PDF verification failed'); process.exitCode = 1; });
