export const buildLoadingFinalizeRequest = (loadingId: string) => ({
  path: `/logistics/loadings/${loadingId}/finalize`,
  body: {},
  config: {
    headers: {
      'Idempotency-Key': `logistics-loading-finalize:${loadingId}`,
    },
  },
});
