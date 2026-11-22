import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import puppeteer from 'puppeteer';

async function main() {
  assert.equal(process.platform, 'linux'); assert.equal(process.env.NODE_ENV, 'test');
  const { configureNativeApplicationEnvironment } = await import('./application-native-environment.fixture');
  configureNativeApplicationEnvironment(randomBytes(32).toString('hex')); // Asset/home isolation only; NO native scope/authority claim.
  const trace = (event: string, detail: object = {}) => console.log(JSON.stringify({ event, at: new Date().toISOString(), ...detail }));
  const launch = puppeteer.launch.bind(puppeteer);
  let activePage: any, rawEvaluate: any, activeStage = '', done = false, observer: Promise<void> | undefined;
  (puppeteer as any).launch = async (options: any) => {
    const browser = await launch(options), newPage = browser.newPage.bind(browser);
    trace('browser-launched', { pid: browser.process()?.pid });
    (browser as any).newPage = async (...args: any[]) => {
      const page = await (newPage as any)(...args); activePage = page; rawEvaluate = page.evaluate.bind(page);
      page.on('pageerror', (error: any) => trace('pageerror', { message: error.message }));
      page.on('console', (message: any) => trace('pageconsole', { text: message.text().slice(0, 300) }));
      page.on('requestfailed', (request: any) => trace('requestfailed', { type: request.resourceType(), failure: request.failure() }));
      for (const method of ['setViewport', 'setContent', 'evaluate', 'emulateMediaType', 'pdf'] as const) {
        const call = page[method].bind(page);
        (page as any)[method] = async (...values: any[]) => {
          const label = method === 'evaluate' ? String(values[0]).slice(0, 120) : method;
          activeStage = label; trace('stage-begin', { stage: label });
          try { const result = await (call as any)(...values); trace('stage-end', { stage: label }); return result; }
          catch (error: any) { trace('stage-error', { stage: label, stack: error?.stack }); throw error; }
        };
      }
      return page;
    };
    return browser;
  };
  observer = (async () => {
    let samples = 0;
    while (!done) {
      await new Promise(resolve => setTimeout(resolve, 5000)); if (done) break;
      trace('observer-tick', { activeStage, samples });
      if (activePage && !activePage.isClosed()) {
        try { const state = await rawEvaluate(`JSON.stringify({ visibility: document.visibilityState, ready: document.readyState,
          fontsStatus: document.fonts.status, fonts: Array.from(document.fonts).map(f=>({family:f.family,status:f.status,weight:f.weight})),
          images: Array.from(document.images).map(i=>({complete:i.complete,width:i.naturalWidth,height:i.naturalHeight})) })`);
          trace('page-state', { activeStage, state: JSON.parse(state) });
        } catch (error: any) { trace('observer-error', { message: error?.message }); }
      }
      samples++;
    }
  })();
  try {
    const { renderDispatchDocumentPdf } = await import('../../backend/src/documents/dispatch/dispatchDocumentPdf');
    const { dispatchPrintBothFixture } = await import('../../backend/src/documents/dispatch/dispatchDocumentFixtures');
    for (const input of dispatchPrintBothFixture.inputs) {
      trace('document-begin', { kind: input.kind, documentId: input.documentId });
      const result = await renderDispatchDocumentPdf(input); assert.equal(result.bytes.subarray(0, 5).toString(), '%PDF-');
      fs.writeFileSync(path.join(process.cwd(), input.documentId + '.pdf'), result.bytes, { flag: 'wx', mode: 0o600 });
      trace('document-complete', { metadata: result.metadata });
    }
    trace('diagnostic-complete', { nativeAuthorityQualified: false });
  } finally { done = true; await observer; trace('diagnostic-observer-closed'); }
}
void main().catch(error => { console.error(error?.stack || String(error)); process.exitCode = 1; });