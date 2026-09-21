import type { RequestHandler } from 'express';

const normalizeText = (value: string) => value
  .replace(/[\u06F0-\u06F9]/g, digit => String(digit.charCodeAt(0) - 0x06F0))
  .replace(/[\u0660-\u0669]/g, digit => String(digit.charCodeAt(0) - 0x0660))
  .replace(/\u066B/g, '.')
  .replace(/[\u060C\u066C]/g, ',');

export function normalizeStructuredNumerals(value: unknown): unknown {
  if (typeof value === 'string') return normalizeText(value);
  if (Array.isArray(value)) return value.map(normalizeStructuredNumerals);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeStructuredNumerals(item)]));
}

/** JSON/form boundary normalization. Domain validators remain responsible for
 * accepting or rejecting decimal/group separators for each structured field. */
export const normalizeStructuredNumeralsMiddleware: RequestHandler = (request, _response, next) => {
  if (request.body !== undefined) request.body = normalizeStructuredNumerals(request.body);
  next();
};
