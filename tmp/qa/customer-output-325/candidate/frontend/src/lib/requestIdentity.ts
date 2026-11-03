type BrowserCrypto = {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint32Array) => Uint32Array;
};

type RequestIdFallbacks = {
  now?: () => number;
  random?: () => number;
};

export const createClientRequestId = (
  browserCrypto: BrowserCrypto | undefined = typeof globalThis.crypto === 'undefined' ? undefined : globalThis.crypto,
  fallbacks: RequestIdFallbacks = {},
) => {
  if (typeof browserCrypto?.randomUUID === 'function') return browserCrypto.randomUUID();

  if (typeof browserCrypto?.getRandomValues === 'function') {
    const values = browserCrypto.getRandomValues(new Uint32Array(4));
    return `client-${Array.from(values, (value) => value.toString(36)).join('-')}`;
  }

  const now = (fallbacks.now ?? Date.now)().toString(36);
  const random = (fallbacks.random ?? Math.random)().toString(36).slice(2) || '0';
  return `client-${now}-${random}`;
};
