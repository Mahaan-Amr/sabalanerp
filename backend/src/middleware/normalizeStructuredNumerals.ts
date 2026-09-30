import type { RequestHandler } from 'express';

import { normalizePartnerInput } from '@sabalanerp/partner-sales-contracts';

export function normalizeStructuredNumerals(value: unknown): unknown {
  return normalizePartnerInput(value);
}

/** JSON/form boundary normalization. Domain validators remain responsible for
 * accepting or rejecting decimal/group separators for each structured field. */
export const normalizeStructuredNumeralsMiddleware: RequestHandler = (request, _response, next) => {
  if (request.body !== undefined) request.body = normalizeStructuredNumerals(request.body);
  next();
};
