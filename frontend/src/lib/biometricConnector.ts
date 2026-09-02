const connectorBaseUrl = 'http://127.0.0.1:47631';

const request = async (path: string, init?: RequestInit, acceptedStatuses: number[] = []) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${connectorBaseUrl}${path}`, { ...init, cache: 'no-store', signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok && !acceptedStatuses.includes(response.status)) throw new Error(body.error || 'اتصال‌گر اثر انگشت پاسخ معتبر نداد.');
    return body;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('مهلت پاسخ اتصال‌گر اثر انگشت پایان یافت.');
    throw error;
  } finally { window.clearTimeout(timeout); }
};

export const biometricConnectorClient = {
  status: () => request('/v1/status', undefined, [503]),
  execute: (bundle: unknown) => request('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bundle) }),
};
