import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';

type RequestOwnership = { release(): void | Promise<void> };
type RequestWork = { responseDone: boolean; mutation: boolean; writeAdmitted: boolean; writes: number; handlers: Set<symbol>; onFinish: Set<() => void>;
  ownership?: RequestOwnership; releasing?: boolean; ownershipFailed?: boolean };
type WriteReservation = { run<T>(work: () => Promise<T>): Promise<T>; cancel(): void };
type Layer = { handle: Function; route?: { stack: Layer[] }; };
type RouterStack = { stack?: Layer[]; _router?: RouterStack };

/** Express 4 discards returned handler promises. This adapter observes them so
 * a disconnected/answered HTTP response cannot stand in for business completion.
 * Callback middleware that neither finishes nor calls next remains unresolved;
 * timeout blocks retirement instead of guessing that its work has stopped. */
export class HttpRequestLifecycle {
  private readonly active = new Set<RequestWork>();
  private observedRequest = false;
  private readonly requests = new WeakMap<Request, RequestWork>();
  private readonly installed = new WeakSet<Layer>();
  constructor(private readonly canAdmitWrite: () => boolean = () => true,
    private acquireOwnership?: (request: Request) => Promise<RequestOwnership>) {}

  /** Bind the same lifecycle already captured by uploads/audit routes.
   * Binding is startup-only and cannot replace ownership or promote a runtime
   * after even a probe has been served. There is no unbind/reset path. */
  bindOwnership(acquire: (request: Request) => Promise<RequestOwnership>) {
    if (this.acquireOwnership) throw new Error('HTTP_OWNERSHIP_ALREADY_BOUND');
    if (this.observedRequest) throw new Error('HTTP_OWNERSHIP_ALREADY_OBSERVED');
    if (typeof acquire !== 'function') throw new Error('HTTP_OWNERSHIP_BINDING_INVALID');
    this.acquireOwnership = acquire;
  }

  readonly middleware: RequestHandler = (req, res, next) => {
    this.observedRequest = true;
    const pathname = req.originalUrl.split('?')[0];
    if (pathname === '/api/health' || pathname === '/api/ready') return next();
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
    if (!this.acquireOwnership) return next();
    const admission = Symbol();
    work.handlers.add(admission);
    // Dispatch belongs to this reservation, even when the client disconnects
    // while the kernel/journal admission is pending. It cannot outlive drain.
    void Promise.resolve().then(() => this.acquireOwnership!(req)).then(ownership => {
      work.ownership = ownership;
      if (!req.aborted && !res.destroyed) next();
    }, next).then(() => {
      work.handlers.delete(admission); this.releaseIfDone(work);
    }, error => {
      try { next(error); } finally { work.handlers.delete(admission); this.releaseIfDone(work); }
    });
  };

  private releaseIfDone(work: RequestWork) {
    if (!work.responseDone || work.handlers.size !== 0 || work.releasing || work.ownershipFailed) return;
    if (!work.ownership) { this.active.delete(work); return; }
    work.releasing = true;
    void Promise.resolve().then(() => work.ownership!.release()).then(() => {
      this.active.delete(work);
    }, () => { work.ownershipFailed = true; });
  }

  /** Reserve future response-event writes when registering the event, before
   * recovery can close admission and observe an apparently drained GET. */
  reserveWrite(req: Request): WriteReservation {
    const work = this.requests.get(req);
    if (!work) return { run: async execute => execute(), cancel: () => {} };
    if (!(work.mutation && work.writeAdmitted) && !this.canAdmitWrite()) {
      throw Object.assign(new Error('سامانه در حال تهیهٔ پشتیبان است؛ کمی بعد دوباره تلاش کنید.'), {
        code: 'RECOVERY_WRITE_ADMISSION_CLOSED', status: 503, statusCode: 503, isOperational: true,
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
    if (!work) {
      // Health/readiness probes do not participate in retirement, but their
      // Express 4 middleware still needs promise rejection forwarding.
      try {
        const result = handler.apply(receiver, [...parameters, next]);
        return result !== null && result !== undefined && typeof result.then === 'function'
          ? Promise.resolve(result).catch(next) : result;
      } catch (error) { next(error); return; }
    }
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
