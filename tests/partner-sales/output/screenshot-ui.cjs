const fs = require('node:fs');
const assert = require('node:assert/strict');
const puppeteer = require('/app/node_modules/puppeteer');
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    for (const theme of ['light', 'dark']) for (const width of [390, 1440]) {
      await page.setViewport({ width, height: 960 });
      await page.setContent(fs.readFileSync(`/tmp/customer-output-325/ui/${theme}.html`, 'utf8'));
      await page.evaluate('document.fonts.ready');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.$$eval('button', elements => elements.length), 2);
      await page.screenshot({ path: `/tmp/customer-output-325/ui/${theme}-${width}.png`, fullPage: true });
      if (width === 390) {
        await page.$eval('.overflow-x-auto', element => { element.scrollLeft = -element.scrollWidth; });
        await page.screenshot({ path: `/tmp/customer-output-325/ui/${theme}-${width}-table-end.png`, fullPage: true });
      }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
