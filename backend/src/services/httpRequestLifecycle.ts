import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';

type RequestWork = { responseDone: boolean; mutation: boolean; writeAdmitted: boolean; writes: number; handlers: Set<symbol>; onFinish: Set<() => void> };
type WriteReservation = { run<T>(work: () => Promise<T>): Promise<T>; cancel(): void };
type Layer = { handle: Function; route?: { stack: Layer[] }; };
type RouterStack = { stack?: Layer[]; _router?: RouterStack };

/** Express 4 discards returned handler promises. This adapter observes them so
 * a disconnected/answered HTTP response cannot stand in for business completion.
 * Callback middleware that neither finishes nor calls next remains unresolved;
 * timeout blocks retirement instead of guessing that its work has stopped. */
export class HttpRequestLifecycle {
  private readonly active = new Set<RequestWork>();
  private readonly requests = new WeakMap<Request, RequestWork>();
  private readonly installed = new WeakSet<Layer>();
  constructor(private readonly canAdmitWrite: () => boolean = () => true) {}

  readonly middleware: RequestHandler = (req, res, next) => {
    const pathname = req.originalUrl.split('?')[0];
    if (pathname === '/api/health' || pathname === '/api/ready'
      || pathname === '/api/system-recovery' || pathname.startsWith('/api/system-recovery/')) return next();
    const work: RequestWork = { responseDone: false, mutation: !['GET', 'HEAD', 'OPTIONS'].includes(req.method),
      writeAdmitted: this.canAdmitWrite(), writes: 0, handlers: new Set(), onFinish: new Set() };
    this.requests.set(req, work);
    this.active.add(work);
    const done = () => { work.responseDone = true; this.releaseIfDone(work); };
    res.once('finish', () => {
      work.responseDone = true;
      for (const callback of [...work.onFinish]) callback();
      this.releaseIfDone(work);
    });
    res.once('close', done);
    next();
  };

  private releaseIfDone(work: RequestWork) {
    if (work.responseDone && work.handlers.size === 0) this.active.delete(work);
  }

  /** Reserve future response-event writes when registering the event, before
   * recovery can close admission and observe an apparently drained GET. */
  reserveWrite(req: Request): WriteReservation {
    const work = this.requests.get(req);
    if (!work) return { run: async execute => execute(), cancel: () => {} };
    if (!(work.mutation && work.writeAdmitted) && !this.canAdmitWrite()) {
      throw Object.assign(new Error('سامانه در حال تهیهٔ پشتیبان است؛ کمی بعد دوباره تلاش کنید.'), {
        code: 'RECOVERY_WRITE_ADMISSION_CLOSED', statusCode: 503, isOperational: true,
      });
    }
    const token = Symbol();
    work.handlers.add(token);
    work.writes += 1;
    this.active.add(work);
    let consumed = false;
    const release = () => { work.writes -= 1; work.handlers.delete(token); this.releaseIfDone(work); };
    return {
      run: async execute => {
        if (consumed) throw new Error('HTTP_WRITE_RESERVATION_CONSUMED');
        consumed = true;
        try { return await execute(); } finally { release(); }
      },
      cancel: () => { if (!consumed) { consumed = true; release(); } },
    };
  }

  async trackWork<T>(req: Request, run: () => Promise<T>): Promise<T> { return this.reserveWrite(req).run(run); }

  private invoke(handler: Function, receiver: unknown, parameters: unknown[], req: Request, res: Response, next: NextFunction) {
    const work = this.requests.get(req);
    if (!work) return handler.apply(receiver, [...parameters, next]);
    const token = Symbol();
    work.handlers.add(token);
    let returned = false; let promise = false; let advanced = false;
    const release = () => {
      work.onFinish.delete(onFinish);
      work.handlers.delete(token);
      this.releaseIfDone(work);
    };
    const onFinish = () => { if (returned && !promise) release(); };
    work.onFinish.add(onFinish);
    const proceed: NextFunction = (error?: unknown) => {
      advanced = true;
      // Downstream admission must precede upstream release, including when the
      // client has already disconnected while callback middleware was waiting.
      try { next(error); } finally { if (returned && !promise) release(); }
    };
    try {
      const result = handler.apply(receiver, [...parameters, proceed]);
      returned = true;
      promise = result !== null && result !== undefined && typeof result.then === 'function';
      if (promise) {
        // Attach rejection forwarding here because Express 4 does not do so.
        return Promise.resolve(result).then(release, error => { try { next(error); } finally { release(); } });
      }
      if (advanced || res.writableEnded) release();
      return result;
    } catch (error) { try { next(error); } finally { release(); } }
  }

  /** Call after all routes/error middleware are registered, before listen. */
  install(application: Application) {
    if (!Array.isArray((application as unknown as RouterStack)._router?.stack)) {
      throw new Error('HTTP_ROUTER_LAYOUT_UNSUPPORTED');
    }
    const visit = (router: RouterStack) => {
      for (const layer of router._router?.stack || router.stack || []) {
        if (this.installed.has(layer)) continue;
        this.installed.add(layer);
        if (layer.route) { visit(layer.route); continue; }
        if ((layer.handle as RouterStack).stack) { visit(layer.handle as RouterStack); continue; }
        const owner = this; const handler = layer.handle;
        if (handler.length > 4) continue; // Express skips these handlers too.
        // Keep Express's arity-based distinction between error and normal handlers.
        layer.handle = handler.length === 4
          ? function (this: unknown, error: unknown, req: Request, res: Response, next: NextFunction) {
            return owner.invoke(handler, this, [error, req, res], req, res, next);
          }
          : function (this: unknown, req: Request, res: Response, next: NextFunction) {
            return owner.invoke(handler, this, [req, res], req, res, next);
          };
      }
    };
    visit(application as unknown as RouterStack);
  }

  private async wait(timeoutMs: number, writesOnly: boolean) {
    const deadline = Date.now() + timeoutMs;
    const pending = () => [...this.active].some(work => !writesOnly || work.mutation || work.writes > 0);
    while (pending() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    if (pending()) throw new Error('HTTP_REQUEST_DRAIN_TIMEOUT');
  }

  waitForDrain(timeoutMs: number) { return this.wait(timeoutMs, false); }
  waitForWriteDrain(timeoutMs: number) { return this.wait(timeoutMs, true); }
}

// Bound once by recoveryRuntime; no request or environment flag can replace it.
let runtimeWriteAdmission: (() => boolean) | undefined;
export const bindRuntimeHttpWriteAdmission = (admission: () => boolean) => {
  if (runtimeWriteAdmission) throw new Error('HTTP_WRITE_ADMISSION_ALREADY_BOUND');
  runtimeWriteAdmission = admission;
};
export const runtimeHttpRequests = new HttpRequestLifecycle(() => runtimeWriteAdmission?.() === true);
