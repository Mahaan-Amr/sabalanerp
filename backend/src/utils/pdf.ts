import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

export interface GeneratePdfOptions {
  htmlContent: string;
  outputDir?: string;
  fileName: string;
  landscape?: boolean;
  scale?: number;
  widthMm?: number;
  heightMm?: number;
}

// Ensure a directory exists
function ensureDirectoryExists(directoryPath: string): void {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

// Generate a PDF from HTML content with RTL support
export async function generatePdfFromHtml(options: GeneratePdfOptions): Promise<string> {
  const outputDir = options.outputDir || path.join(process.cwd(), 'storage', 'contracts');
  ensureDirectoryExists(outputDir);

  const outputPath = path.join(outputDir, `${options.fileName.replace(/[^\w\-\.]/g, '_')}.pdf`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();

    // Inject basic RTL and font setup; assumes Persian fonts installed on host or bundled via @font-face in HTML
    const htmlWithRtl = `<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8" />
      <style>
        html, body { font-family: Vazirmatn, Vazir, Samim, Tahoma, Arial, sans-serif; direction: rtl; }
      </style>
    </head><body>${options.htmlContent}</body></html>`;

    await page.setContent(htmlWithRtl, { waitUntil: 'networkidle0' });
    await page.emulateMediaType('print');

    const width = `${options.widthMm ?? (options.landscape ? 297 : 210)}mm`;
    const height = `${options.heightMm ?? (options.landscape ? 210 : 297)}mm`;

    await page.pdf({
      path: outputPath,
      width,
      height,
      printBackground: true,
      margin: { top: '3mm', right: '5px', bottom: '3mm', left: '3mm' },
      scale: options.scale ?? 1.0
    });
  } finally {
    await browser.close();
  }

  return outputPath;
}


