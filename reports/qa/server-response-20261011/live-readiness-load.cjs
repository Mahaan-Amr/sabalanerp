// Read-only diagnostic against the running backend's existing Prisma client.
const WebSocket = require('/app/node_modules/ws');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const [target] = await (await fetch('http://127.0.0.1:9229/json/list', { signal: AbortSignal.timeout(5000) })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map(); let sequence = 0;
  ws.on('message', bytes => {
    const message = JSON.parse(bytes);
    const entry = pending.get(message.id);
    if (entry) { pending.delete(message.id); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result); }
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const command = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  let loading = true;
  const samples = [];
  const readiness = (async () => {
    while (samples.length < 100 && (loading || samples.length < 30)) {
      const start = performance.now();
      try {
        const response = await fetch('http://127.0.0.1:5000/api/ready', { signal: AbortSignal.timeout(4000) });
        const body = await response.json();
        samples.push({ status: response.status, ready: body.ready === true, ms: Math.round(performance.now() - start), duringLoad: loading });
      } catch { samples.push({ status: 0, ready: false, ms: Math.round(performance.now() - start), duringLoad: loading }); }
      await wait(100);
    }
  })();
  try {
    const expression = `(async () => {
      const db = process.mainModule.require('/app/dist/lib/prisma').prisma;
      const { getCrossWorkspaceDutySummary } = process.mainModule.require('/app/dist/services/crossWorkspaceDutyInbox');
      const actor = await db.user.findFirst({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
      if (!actor) throw new Error('No active diagnostic actor');
      const durationsMs = [];
      for (let iteration = 0; iteration < 3; iteration++) {
        const start = performance.now();
        const summaries = await Promise.all(['sales', 'accounting'].map(workspaceCode =>
          db.$transaction(async tx => {
            await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
            return getCrossWorkspaceDutySummary(tx, { actorUserId: actor.id, workspaceCode });
          }, { timeout: 30000 })));
        if (!summaries.every(summary => Number.isInteger(summary.attention))) throw new Error('Invalid summary');
        durationsMs.push(Math.round(performance.now() - start));
      }
      return { iterations: 3, concurrentWorkspaces: 2, durationsMs };
    })()`;
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error('Live summary diagnostic failed');
    loading = false;
    await readiness;
    const times = samples.map(sample => sample.ms).sort((a, b) => a - b);
    console.log(JSON.stringify({ load: result.result.value, readiness: { samples: samples.length,
      duringLoad: samples.filter(sample => sample.duringLoad).length,
      failures: samples.filter(sample => !sample.ready).length,
      maxMs: times.at(-1), p95Ms: times[Math.ceil(times.length * 0.95) - 1] } }));
    if (samples.some(sample => !sample.ready)) process.exitCode = 1;
  } finally {
    loading = false;
    await command('Runtime.evaluate', { expression: 'setTimeout(() => process.getBuiltinModule("inspector").close(), 100); true' });
    ws.close();
  }
})().catch(error => { console.error(error.name + ': ' + error.message); process.exitCode = 1; });
