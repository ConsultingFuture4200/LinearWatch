import { createServer } from 'node:http';

// Wave 0 placeholder server. Wave 1 replaces this with Fastify + Drizzle + Graphile Worker.
// The compose smoke test (scripts/smoke-compose.sh) hits /health on this server.
const PORT = Number(process.env.PORT ?? 8080);

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, () => {
  process.stdout.write(`agentwatch server placeholder — listening on :${PORT}\n`);
});
