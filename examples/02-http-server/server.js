import express from 'express';

const port = Number(process.env.PORT ?? 3001);
const app = express();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/', (_req, res) => {
  res.send('hello from the orckit http-server example');
});

const server = app.listen(port, () => {
  console.log(`[ready] listening on http://localhost:${port}`);
});

const shutdown = () => {
  console.log('shutting down...');
  server.close(() => process.exit(0));
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
