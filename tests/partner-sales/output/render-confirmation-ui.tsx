import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ConfirmationContractView from '../../../frontend/src/app/contracts/confirm/ConfirmationContractView';
import { renderYekanFontFaces } from '../../../backend/src/utils/printTemplate';
const root = path.resolve(__dirname, '../../..');
const frontendRequire = createRequire(path.join(root, 'frontend/package.json'));
const React = frontendRequire('react');
Object.assign(globalThis, { React });
const { renderToStaticMarkup } = frontendRequire('react-dom/server');
const foundationRequire = createRequire(path.join(root, 'packages/partner-sales-contracts/package.json'));
const { createPartnerFixtures } = foundationRequire('@sabalanerp/partner-sales-contracts/testing');
const cssDirectory = path.join(root, 'tmp/qa/customer-output-325/candidate/frontend/.next-build/static/css');
const css = fs.readdirSync(cssDirectory).filter(file => file.endsWith('.css')).map(file => fs.readFileSync(path.join(cssDirectory, file), 'utf8')).join('\n');
const output = path.join(root, 'tmp/qa/customer-output-325/ui');
fs.mkdirSync(output, { recursive: true });
for (const theme of ['light', 'dark']) {
  const fixture = createPartnerFixtures();
  fixture.customer.status = 'PENDING_APPROVAL';
  const markup = renderToStaticMarkup(<ConfirmationContractView data={{ contract: fixture.customer,
    verifiedAt: null, linkExpiresAt: '2026-10-26T12:00:00.000Z', readOnly: false, banner: null }}
    code="" error="" success="" submitting={false} onCodeChange={() => {}} onVerify={() => {}} onResend={() => {}} />);
  fs.writeFileSync(path.join(output, `${theme}.html`), `<!doctype html><html lang="fa" dir="rtl" data-theme="${theme}"><head><meta charset="utf-8"><style>${css}\n${renderYekanFontFaces()}\nhtml,body{font-family:'Yekan Bakh',sans-serif}</style></head><body>${markup}</body></html>`);
}
