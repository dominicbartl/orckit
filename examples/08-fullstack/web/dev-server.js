// Simulated webpack-dev-server. Emits webpack-shaped progress lines so the
// `type: webpack` parser in Orckit picks them up as build events, then serves
// a tiny static page that calls the API.

import express from 'express';

const port = Number(process.env.PORT ?? 3005);
const apiUrl = process.env.API_URL ?? 'http://localhost:3004';

async function fakeBuild() {
  console.log('compilation starting...');
  for (const pct of [10, 30, 60, 90]) {
    await new Promise((r) => setTimeout(r, 200));
    console.log(`${pct}% building`);
  }
  console.log('compiled successfully in 824ms');
}

const app = express();

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html><head><title>fullstack web</title></head>
<body>
  <h1>fullstack web</h1>
  <p>API: <a href="${apiUrl}/api/items">${apiUrl}/api/items</a></p>
</body></html>`);
});

const server = app.listen(port, async () => {
  console.log(`web listening on http://localhost:${port}`);
  await fakeBuild();
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
