import express from 'express';
import net from 'node:net';

const port = Number(process.env.PORT ?? 3004);
const dbPort = Number(process.env.DB_PORT ?? 5433);

const app = express();

app.get('/health', (_req, res) => {
  const socket = net.connect({ host: 'localhost', port: dbPort });
  socket.once('connect', () => {
    socket.end();
    res.json({ status: 'ok' });
  });
  socket.once('error', () => res.status(503).json({ status: 'db-unreachable' }));
});

app.get('/api/items', (_req, res) => {
  res.json({ items: ['alpha', 'beta', 'gamma'] });
});

const server = app.listen(port, () => {
  console.log(`api listening on http://localhost:${port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
