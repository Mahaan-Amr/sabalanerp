/** Optional denial constraint for instrumented browser requests. Headers never
 * grant access: the HttpOnly cookie's authoritative session must already pass.
 * Uninstrumented supported browser builds retain their existing auth contract. */
export function matchesRequestSessionBinding(input: { expectedUser?: string; expectedSession?: string; userOnlyProbe: boolean },
  session: { id: string; userId: string }) {
  if (input.expectedUser === undefined && input.expectedSession === undefined) return true;
  const identifier = /^[a-zA-Z0-9_-]{1,128}$/;
  if (!input.expectedUser || !identifier.test(input.expectedUser) || input.expectedUser !== session.userId) return false;
  if (input.expectedSession === undefined) return input.userOnlyProbe;
  return identifier.test(input.expectedSession) && input.expectedSession === session.id;
}
