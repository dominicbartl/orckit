// Tiny HTTP server that reports which host (sandbox) answered.
const { hostname } = require('node:os');
const { existsSync, readFileSync } = require('node:fs');

const env = existsSync('.env.local') ? readFileSync('.env.local', 'utf8').trim() : '(no .env.local)';

require('node:http')
  .createServer((_req, res) => res.end(`hello from ${hostname()} — ${env}\n`))
  .listen(3000, '127.0.0.1', () => console.log('listening on 127.0.0.1:3000'));
