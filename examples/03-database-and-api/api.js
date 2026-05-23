import express from 'express';
import net from 'node:net';

const port = Number(process.env.PORT ?? 3002);
const dbHost = process.env.DB_HOST ?? 'localhost';
const dbPort = Number(process.env.DB_PORT ?? 5432);

const app = express();

app.get('/health', (_req, res) => {
  const socket = net.connect({ host: dbHost, port: dbPort });
  socket.once('connect', () => {
    socket.end();
    res.json({ status: 'ok', db: 'reachable' });
  });
  socket.once('error', (err) => {
    res.status(503).json({ status: 'degraded', db: err.message });
  });
});

const server = app.listen(port, () => {
  console.log(`api listening on http://localhost:${port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
