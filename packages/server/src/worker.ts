// Wave 0 placeholder worker. Wave 1 replaces this with Graphile Worker bootstrap.
process.stdout.write('agentwatch worker placeholder\n');

// Keep the process alive so docker-compose reports it as running.
setInterval(() => {
  // no-op heartbeat; Graphile Worker takes over in Wave 1.
}, 60_000);
