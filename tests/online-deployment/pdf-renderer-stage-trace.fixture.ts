import puppeteer from 'puppeteer';

let installed = false;
/** Diagnostic-only observation of the exact shared renderer's Puppeteer
 * instance. Wrappers call each original method with unchanged arguments and
 * await its original promise. No timeout, activation or closure adjustment,
 * timers, or detached observer work. */
export function installNativePdfStageTrace() {
  if (installed) throw Error('PDF_STAGE_TRACE_ALREADY_INSTALLED'); installed = true;
  const emit = (event: string, detail: object = {}) => console.log(JSON.stringify({ event: 'pdf-renderer-' + event,
    at: new Date().toISOString(), ...detail }));
  const launch = puppeteer.launch.bind(puppeteer);
  let sequence = 0;
  (puppeteer as any).launch = async (...options: any[]) => {
    const browserId = ++sequence; emit('launch-begin', { browserId });
    const browser = await (launch as any)(...options), newPage = browser.newPage.bind(browser);
    emit('launch-complete', { browserId, pid: browser.process()?.pid });
    browser.once('disconnected', () => emit('disconnected', { browserId }));
    (browser as any).newPage = async (...args: any[]) => {
      const page = await (newPage as any)(...args), evaluate = page.evaluate.bind(page);
      const snapshot = async (after: string) => {
        const state = await evaluate(`JSON.stringify({ visibility: document.visibilityState, ready: document.readyState,
          fontsStatus: document.fonts.status, fonts: Array.from(document.fonts).map(f=>({family:f.family,status:f.status,weight:f.weight})),
          images: Array.from(document.images).map(i=>({complete:i.complete,width:i.naturalWidth,height:i.naturalHeight})) })`);
        emit('snapshot', { browserId, after, state: JSON.parse(state) });
      };
      page.on('pageerror', (error: any) => emit('page-error', { browserId, stack: error?.stack || String(error) }));
      page.on('requestfailed', (request: any) => emit('request-failed', { browserId, type: request.resourceType(), failure: request.failure() }));
      for (const method of ['setViewport', 'setContent', 'evaluate', 'emulateMediaType', 'pdf'] as const) {
        const call = page[method].bind(page);
        (page as any)[method] = async (...values: any[]) => {
          const stage = method === 'evaluate' ? String(values[0]).slice(0, 140) : method;
          emit('stage-begin', { browserId, stage });
          try {
            const result = await (call as any)(...values);
            emit('stage-complete', { browserId, stage });
            if (method === 'setContent' || method === 'emulateMediaType') {
              await snapshot(stage).catch((error: any) => emit('snapshot-error', { browserId, after: stage, stack: error?.stack || String(error) }));
            }
            return result;
          } catch (error: any) { emit('stage-error', { browserId, stage, stack: error?.stack || String(error) }); throw error; }
        };
      }
      return page;
    };
    return browser;
  };
}