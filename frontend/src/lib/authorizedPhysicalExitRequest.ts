export const buildAuthorizedPhysicalExitRequest = (
  authorizationId: string,
  correlationId: string,
) => ({
  path: `/security/exit-desk/authorizations/${authorizationId}/exit`,
  body: {},
  config: {
    headers: {
      'Idempotency-Key': `security-authorized-physical-exit:${authorizationId}`,
      'X-Correlation-ID': correlationId,
    },
  },
});
