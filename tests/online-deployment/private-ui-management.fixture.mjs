import net from 'node:net';

// Local acceptance only. Requests have no business data and this socket is
// located in the fixture's private, native-lock-owned directory.
export function privateUiManagementServer(handle) {
  return net.createServer({allowHalfOpen: true}, socket => {
    let buffer = '', running = false;
    socket.setTimeout(30000, () => socket.destroy());
    // A caller may disappear while a durable publication finishes. Preserve
    // that publication and let a later status read reconcile the lost reply.
    socket.on('error', () => socket.destroy());
    socket.on('data', bytes => {
      buffer += bytes.toString('utf8');
      if (buffer.length > 128 || running) {socket.destroy(); return;}
      if (!buffer.endsWith('\n')) return;
      running = true;
      Promise.resolve().then(() => handle(buffer.trim())).then(
        value => {if (!socket.destroyed) socket.end(JSON.stringify({ok: true, value}) + '\n');},
        failure => {if (!socket.destroyed) socket.end(JSON.stringify({ok: false, error: failure.code || failure.message}) + '\n');},
      );
    });
  });
}
