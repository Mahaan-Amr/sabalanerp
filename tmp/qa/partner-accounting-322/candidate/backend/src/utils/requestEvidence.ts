import type { Request } from 'express';

export interface RequestEvidenceMeta {
  ipAddress?: string;
  userAgent?: string;
  acceptLanguage?: string;
  deviceFingerprint?: string;
  referrer?: string;
}

export function getRequestEvidence(req: Request): RequestEvidenceMeta {
  const forwardedFor = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  const ipAddress = forwardedFor || req.ip || (req.socket?.remoteAddress ?? undefined);

  return {
    ipAddress,
    userAgent: req.headers['user-agent'] as string | undefined,
    acceptLanguage: req.headers['accept-language'] as string | undefined,
    deviceFingerprint: req.headers['x-device-fingerprint'] as string | undefined,
    referrer: req.headers.referer as string | undefined
  };
}

