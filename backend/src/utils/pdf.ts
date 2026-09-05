import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import type { ContractRuntime, Output } from '../services/partnerSales/customerOutput/contracts';
import { createCustomerOutputSnapshots } from '../services/partnerSales/customerOutput/snapshots';
import { renderCustomerContractPrint } from './printTemplate';

/** Buffer-only consumer hook: no static file, status mutation or commitment.
 * The authenticated issuance adapter owns publication through the Case port. */
export async function generateCustomerContractPdf(contract: ContractRuntime, input: Output): Promise<Buffer> {
  const content = await createCustomerOutputSnapshots(contract).content(input);
  const template = renderCustomerContractPrint(content);
  return generatePdfBufferFromHtml({ ...template, displayHeaderFooter: true,
    footerTemplate: '<span></span>', margin: { top: '34mm', right: '5mm', bottom: '8mm', left: '5mm' } });
}

export interface GeneratePdfOptions {
  htmlContent: string;
  outputDir?: string;
  fileName: string;
  landscape?: boolean;
  scale?: number;
  widthMm?: number;
  heightMm?: number;
  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  assertNoOverflowSelector?: string;
}

// Ensure a directory exists
function ensureDirectoryExists(directoryPath: string): void {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

// Generate a PDF from HTML content with RTL support
export async function generatePdfBufferFromHtml(options: Omit<GeneratePdfOptions, 'fileName' | 'outputDir'> & { htmlContent: string; signal?: AbortSignal }): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const abort = () => { void browser.close(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    if (options.signal?.aborted) throw Object.assign(new Error('PDF generation aborted.'), { code: 'PDF_GENERATION_ABORTED' });
    const page = await browser.newPage();
    if (options.assertNoOverflowSelector) {
      await page.setViewport({
        width: Math.round((options.widthMm ?? (options.landscape ? 297 : 210)) * 3.78),
        height: Math.round((options.heightMm ?? (options.landscape ? 210 : 297)) * 3.78),
        deviceScaleFactor: 1,
      });
    }

    // Inject basic RTL and font setup; assumes Persian fonts installed on host or bundled via @font-face in HTML
    const htmlWithRtl = /^\s*(?:<!doctype|<html)/i.test(options.htmlContent) ? options.htmlContent : `<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8" />
      <style>
        html, body { font-family: Vazirmatn, Vazir, Samim, Tahoma, Arial, sans-serif; direction: rtl; }
      </style>
    </head><body>${options.htmlContent}</body></html>`;

    await page.setContent(htmlWithRtl, { waitUntil: 'load', timeout: 120_000 });
    await page.evaluate(`Promise.all(Array.from(document.images).map(async (image) => {
      if (!image.complete) await new Promise((resolve, reject) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', () => reject(new Error('Failed to load PDF image')), { once: true });
      });
      if (typeof image.decode === 'function') await image.decode();
    }))`);
    await page.evaluate('document.fonts.ready');
    await page.emulateMediaType('print');
    if (options.assertNoOverflowSelector) {
      const selector = JSON.stringify(options.assertNoOverflowSelector);
      const overflow = await page.evaluate(`Array.from(document.querySelectorAll(${selector})).map((element, index) => ({
        index,
        text: (element.textContent || '').trim().slice(0, 120),
        horizontal: element.scrollWidth > element.clientWidth + 1,
        vertical: element.scrollHeight > element.clientHeight + 1
      })).filter((entry) => entry.horizontal || entry.vertical)`);
      if (Array.isArray(overflow) && overflow.length > 0) {
        throw new Error(`PDF element overflow detected for ${options.assertNoOverflowSelector}: ${JSON.stringify(overflow)}`);
      }
    }

    const width = `${options.widthMm ?? (options.landscape ? 297 : 210)}mm`;
    const height = `${options.heightMm ?? (options.landscape ? 210 : 297)}mm`;

    const pdf = await page.pdf({
      width,
      height,
      printBackground: true,
      margin: options.margin || { top: '3mm', right: '5px', bottom: '3mm', left: '3mm' },
      scale: options.scale ?? 1.0,
      displayHeaderFooter: options.displayHeaderFooter,
      headerTemplate: options.headerTemplate,
      footerTemplate: options.footerTemplate,
      preferCSSPageSize: false
    });
    return Buffer.from(pdf);
  } finally {
    options.signal?.removeEventListener('abort', abort);
    await browser.close();
  }
}

// Generate a PDF from HTML content with RTL support
export async function generatePdfFromHtml(options: GeneratePdfOptions): Promise<string> {
  const outputDir = options.outputDir || path.join(process.cwd(), 'storage', 'contracts');
  ensureDirectoryExists(outputDir);

  const outputPath = path.join(outputDir, `${options.fileName.replace(/[^\w\-\.]/g, '_')}.pdf`);
  const bytes = await generatePdfBufferFromHtml(options);
  fs.writeFileSync(outputPath, bytes);

  return outputPath;
}
