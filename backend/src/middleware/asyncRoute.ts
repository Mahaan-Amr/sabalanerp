import type { NextFunction, Request, Response } from 'express';

/** Express 4 does not forward rejected async handlers to error middleware. */
export const asyncRoute = (
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    // Prisma messages can contain SQL or protected data. Retain the diagnostic
    // code without disclosing the original message to the client or logs.
    const code = (error as { code?: unknown } | null)?.code;
    console.error('Async request failed', { code: typeof code === 'string' && /^P\d{4}$/.test(code) ? code : 'REQUEST_FAILED' });
    const message = 'خطای داخلی سرور. لطفاً دوباره تلاش کنید.';
    if (res.headersSent) {
      next(new Error(message));
      return;
    }
    res.status(500).json({ success: false, error: message });
  }
};
