import express from 'express';

const port = Number(process.env.PORT ?? 3003);
const app = express();

// Simulate slow warm-up — return 503 until enough time has passed.
const startedAt = Date.now();
const WARMUP_MS = 3000;

app.get('/ready', (_req, res) => {
  if (Date.now() - startedAt < WARMUP_MS) {
    res.status(503).send('warming up');
    return;
  }
  res.send('ready');
});

app.get('/', (_req, res) => res.send('ok'));

const server = app.listen(port, () => {
  console.log(`server listening on http://localhost:${port}`);
  console.log(`warming up for ${WARMUP_MS}ms...`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
