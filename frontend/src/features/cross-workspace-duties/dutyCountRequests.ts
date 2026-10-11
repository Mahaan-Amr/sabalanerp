/** Share pending network work only within one authentication session. No settled
 * count or permission is cached. A mutation invalidates an in-flight response. */
export function createDutyCountRequests(load: (workspace: string) => Promise<number>) {
  const sessions = new WeakMap<object, Map<string, { promise: Promise<number>; dirty: boolean }>>();
  return (session: object, workspace: string, changed = false): Promise<number> => {
    let flights = sessions.get(session);
    if (!flights) { flights = new Map(); sessions.set(session, flights); }
    const existing = flights.get(workspace);
    if (existing) {
      if (changed) existing.dirty = true;
      return existing.promise;
    }
    const flight = { dirty: false, promise: undefined as unknown as Promise<number> };
    flight.promise = (async () => {
      try {
        do {
          flight.dirty = false;
          try {
            const count = await load(workspace);
            if (!flight.dirty) return count;
          } catch (error) {
            if (!flight.dirty) throw error;
          }
        } while (flight.dirty);
        throw new Error('DUTY_COUNT_REFRESH_INTERRUPTED');
      } finally { flights.delete(workspace); }
    })();
    flights.set(workspace, flight);
    return flight.promise;
  };
}
