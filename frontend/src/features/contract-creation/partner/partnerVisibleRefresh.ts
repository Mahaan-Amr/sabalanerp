/** One visible-page request at a time. A failure backs off; a foreground/manual
 * refresh bypasses that wait, but never overlaps an in-flight request. */
export function createPartnerVisibleRefresh({ refresh, visible, schedule, cancel, onError }: {
  refresh: () => Promise<void>; visible: () => boolean;
  schedule: (callback: () => void, delay: number) => number;
  cancel: (timer: number) => void; onError?: (error: unknown) => void;
}) {
  let stopped = false, running = false, failures = 0;
  let timer: number | undefined;
  const clear = () => { if (timer !== undefined) cancel(timer); timer = undefined; };
  const run = async () => {
    if (stopped || running) return;
    clear(); running = true;
    try {
      if (visible()) { await refresh(); failures = 0; }
    } catch (error) { failures = Math.min(failures + 1, 3); onError?.(error); }
    finally {
      running = false;
      if (!stopped) timer = schedule(() => void run(), Math.min(60_000, 10_000 * 2 ** failures));
    }
  };
  return { start: () => { void run(); }, refresh: () => { void run(); }, stop: () => { stopped = true; clear(); } };
}
