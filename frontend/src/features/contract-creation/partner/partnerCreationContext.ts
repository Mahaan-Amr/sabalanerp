const retryableStatuses = new Set([409, 502, 503, 504]);

function responseStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | undefined)?.response?.status;
}

export async function readPartnerCreationContext<T>(
  request: () => Promise<T>,
  wait: (milliseconds: number) => Promise<void> = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    const status = responseStatus(error);
    if (status !== undefined && !retryableStatuses.has(status)) throw error;
    await wait(150);
    return request();
  }
}
