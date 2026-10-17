/** One mounted list owns its requests. A superseded success, failure or finally
 * must never publish into the current query, including when transport ignores abort. */
export function createAccountingContractsLoader<Params, Result>(callbacks: {
  read: (params: Params, signal: AbortSignal) => Promise<Result>;
  start: () => void;
  success: (result: Result) => void;
  failure: (error: unknown) => void;
  settled: () => void;
}) {
  let generation = 0;
  let controller: AbortController | null = null;
  const cancel = () => {
    generation += 1;
    controller?.abort();
    controller = null;
  };
  return {
    cancel,
    async load(params: Params) {
      cancel();
      const current = generation;
      const request = new AbortController();
      controller = request;
      callbacks.start();
      try {
        const result = await callbacks.read(params, request.signal);
        if (current === generation) callbacks.success(result);
      } catch (error) {
        if (current === generation && !request.signal.aborted) callbacks.failure(error);
      } finally {
        if (current === generation) {
          controller = null;
          callbacks.settled();
        }
      }
    },
  };
}
