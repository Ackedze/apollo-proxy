const SHUTDOWN_GRACE_MS = 2000;

// Only desktop-managed servers use stdin as a parent lifetime channel.
// Ordinary `node server.js` / `npm start` must survive a closed stdin.
function bindManagedProxyLifetime(server) {
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    console.log('Apollo launcher stopped; shutting down proxy');
    // A stalled HTTP request must not keep the app's port occupied forever.
    const deadline = setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS);
    deadline.unref();
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  process.stdin.once('end', shutdown);
  process.stdin.once('close', shutdown);
  process.stdin.once('error', shutdown);
  process.stdin.resume();
  if (process.stdin.readableEnded || process.stdin.destroyed) shutdown();
}

module.exports = { bindManagedProxyLifetime };
