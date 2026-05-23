/**
 * Full-stack simulation.
 *
 * Spawns a four-service stack — db (TCP) → api (HTTP) → worker (bash loop) + web
 * (HTTP) — through the real Orckit orchestrator, then asserts on dependency
 * order, ready timing, output capture, output highlighting, hook execution, and
 * graceful shutdown. The test prints a timeline of events and a snippet of each
 * process's captured output at the end so you can eyeball what happened.
 *
 * Run it with:
 *   pnpm test:integration -- fullstack
 *
 * Add --reporter=verbose to see each assertion as it runs:
 *   pnpm test:integration -- --reporter=verbose fullstack
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Orckit } from '../../src/orchestrator/orchestrator.js';
import { validateConfig } from '../../src/config/load.js';
import { isPortFree } from '../../src/util/port.js';

async function findFreePort(): Promise<number> {
  for (let i = 0; i < 50; i++) {
    const port = 30_000 + Math.floor(Math.random() * 20_000);
    if (await isPortFree(port)) return port;
  }
  throw new Error('could not find a free port after 50 attempts');
}

const DB_SCRIPT = `
const net = require('net');
const port = Number(process.env.DB_PORT);
const server = net.createServer((socket) => {
  // Probes will hang up abruptly; swallow the resulting EPIPE/ECONNRESET.
  socket.on('error', () => {});
  socket.end();
});
server.on('error', (err) => console.error('db server error:', err.message));
server.listen(port, () => console.log('db listening on ' + port));
const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
`;

const API_SCRIPT = `
const http = require('http');
const net = require('net');
const port = Number(process.env.API_PORT);
const dbPort = Number(process.env.DB_PORT);

// Verify we can reach the db (proves the dependency was honored).
const probe = net.createConnection({ port: dbPort, host: '127.0.0.1' });
probe.on('connect', () => { console.log('api connected to db'); probe.end(); });
probe.on('data', () => {});
probe.on('error', (err) => console.error('api db probe error:', err.message));

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(404);
  res.end();
});
server.on('clientError', (err, socket) => { socket.destroy(); });
server.on('error', (err) => console.error('api server error:', err.message));
server.listen(port, () => console.log('api listening on ' + port));
const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
`;

const WEB_SCRIPT = `
const http = require('http');
const port = Number(process.env.WEB_PORT);
const server = http.createServer((_req, res) => {
  res.writeHead(200);
  res.end('hello from web');
});
server.on('clientError', (err, socket) => { socket.destroy(); });
server.on('error', (err) => console.error('web server error:', err.message));
server.listen(port, () => console.log('web ready to serve on ' + port));
const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
`;

describe('Full-stack simulation', () => {
  let tmpDir: string;
  let dbPort: number;
  let apiPort: number;
  let webPort: number;
  let orckit: Orckit | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'orckit-fullstack-'));
    writeFileSync(join(tmpDir, 'db.js'), DB_SCRIPT);
    writeFileSync(join(tmpDir, 'api.js'), API_SCRIPT);
    writeFileSync(join(tmpDir, 'web.js'), WEB_SCRIPT);
    [dbPort, apiPort, webPort] = await Promise.all([
      findFreePort(),
      findFreePort(),
      findFreePort(),
    ]);
  });

  afterAll(async () => {
    if (orckit) {
      try {
        await orckit.dispose();
      } catch {
        // already disposed
      }
    }
    rmSync(tmpDir, { recursive: true, force: true });
  }, 20_000);

  it('boots db → api → worker+web, captures output, hooks fire, shuts down cleanly', async () => {
    const config = validateConfig({
      project: 'demo-stack',
      preflight: [
        { name: 'node-installed', command: 'command -v node >/dev/null' },
        { name: 'bash-installed', command: 'command -v bash >/dev/null' },
      ],
      processes: {
        db: {
          category: 'infra',
          command: `node ${join(tmpDir, 'db.js')}`,
          env: { DB_PORT: String(dbPort) },
          ready: {
            type: 'tcp',
            host: '127.0.0.1',
            port: dbPort,
            interval_ms: 100,
            timeout_ms: 5000,
          },
          hooks: {
            pre_start: 'echo "[hook] db pre_start"',
            post_start: 'echo "[hook] db post_start"',
          },
        },
        api: {
          category: 'backend',
          command: `node ${join(tmpDir, 'api.js')}`,
          depends_on: ['db'],
          env: { API_PORT: String(apiPort), DB_PORT: String(dbPort) },
          ready: {
            type: 'http',
            url: `http://127.0.0.1:${apiPort}/health`,
            interval_ms: 100,
            timeout_ms: 5000,
          },
        },
        worker: {
          category: 'backend',
          command: 'for i in 1 2 3; do echo "job $i processed"; sleep 0.05; done; sleep 30',
          depends_on: ['api'],
          ready: {
            // Wait for the 3rd job so we can reliably assert on all three
            // lines after start() returns.
            type: 'log-pattern',
            pattern: 'job 3 processed',
            timeout_ms: 5000,
          },
          output: {
            highlight: [
              { pattern: 'job', color: 'cyan' },
              { pattern: 'error', color: 'red' },
            ],
            suppress: ['^DEBUG:'],
          },
        },
        web: {
          category: 'frontend',
          command: `node ${join(tmpDir, 'web.js')}`,
          depends_on: ['api'],
          env: { WEB_PORT: String(webPort) },
          ready: {
            type: 'log-pattern',
            pattern: 'ready to serve',
            timeout_ms: 5000,
          },
        },
      },
    });

    orckit = new Orckit(config);

    type Entry = { tMs: number; line: string };
    const timeline: Entry[] = [];
    const t0 = Date.now();
    const log = (line: string) => timeline.push({ tMs: Date.now() - t0, line });

    orckit.on('preflight:start', () => log('preflight: start'));
    orckit.on('preflight:result', (r) => log(`preflight: ${r.name} ${r.passed ? '✓' : '✗'}`));
    orckit.on('preflight:complete', (ok) => log(`preflight: ${ok ? 'PASSED' : 'FAILED'}`));
    orckit.on('process:starting', (n) => log(`starting   ${n}`));
    orckit.on('process:ready', (n, ms) => log(`ready      ${n}  (${ms}ms)`));
    orckit.on('process:running', (n) => log(`running    ${n}`));
    orckit.on('process:stopped', (n) => log(`stopped    ${n}`));
    orckit.on('process:failed', (n, e) => log(`FAILED     ${n}  ${e?.message ?? ''}`));
    orckit.on('hook:complete', (n, hook) => log(`hook       ${n}:${hook}`));
    orckit.on('all:ready', (names) => log(`ALL READY  [${names.join(', ')}]`));

    await orckit.start();

    // ── lifecycle assertions ────────────────────────────────────────────────
    expect(orckit.state('db')).toBe('running');
    expect(orckit.state('api')).toBe('running');
    expect(orckit.state('worker')).toBe('running');
    expect(orckit.state('web')).toBe('running');

    // ── dependency order assertions ─────────────────────────────────────────
    const startIdx = (name: string) => timeline.findIndex((e) => e.line === `starting   ${name}`);
    expect(startIdx('db')).toBeGreaterThanOrEqual(0);
    expect(startIdx('db')).toBeLessThan(startIdx('api'));
    expect(startIdx('api')).toBeLessThan(startIdx('worker'));
    expect(startIdx('api')).toBeLessThan(startIdx('web'));

    // ── output capture assertions ───────────────────────────────────────────
    const dbText = orckit
      .output('db')
      .map((l) => l.text)
      .join('\n');
    expect(dbText).toMatch(/db listening on \d+/);

    const apiText = orckit
      .output('api')
      .map((l) => l.text)
      .join('\n');
    expect(apiText).toMatch(/api listening on \d+/);
    expect(apiText).toMatch(/api connected to db/);

    const workerLines = orckit.output('worker');
    expect(workerLines.map((l) => l.text)).toContain('job 1 processed');
    expect(workerLines.map((l) => l.text)).toContain('job 2 processed');
    expect(workerLines.map((l) => l.text)).toContain('job 3 processed');

    const webText = orckit
      .output('web')
      .map((l) => l.text)
      .join('\n');
    expect(webText).toMatch(/web ready to serve on \d+/);

    // ── output filter assertions ────────────────────────────────────────────
    const jobLine = workerLines.find((l) => l.text === 'job 1 processed');
    expect(jobLine?.highlight).toBe('cyan');

    // ── hook assertions ─────────────────────────────────────────────────────
    const hookLines = timeline.filter((e) => e.line.startsWith('hook')).map((e) => e.line);
    expect(hookLines).toContain('hook       db:pre_start');
    expect(hookLines).toContain('hook       db:post_start');

    // ── ready-timing sanity check ───────────────────────────────────────────
    const allReadyIdx = timeline.findIndex((e) => e.line.startsWith('ALL READY'));
    expect(allReadyIdx).toBeGreaterThanOrEqual(0);
    expect(timeline[allReadyIdx]!.tMs).toBeLessThan(10_000); // whole stack up in <10s

    // ── graceful shutdown ───────────────────────────────────────────────────
    await orckit.dispose();
    expect(orckit.state('db')).toBe('stopped');
    expect(orckit.state('api')).toBe('stopped');
    expect(orckit.state('worker')).toBe('stopped');
    expect(orckit.state('web')).toBe('stopped');

    // ── visible summary so you can eyeball the run ──────────────────────────
    const bar = '─'.repeat(72);
    const lines: string[] = [];
    lines.push('');
    lines.push(bar);
    lines.push('  Full-stack simulation — event timeline');
    lines.push(`  ports: db=${dbPort}  api=${apiPort}  web=${webPort}`);
    lines.push(bar);
    for (const entry of timeline) {
      lines.push(`  +${String(entry.tMs).padStart(5)}ms  ${entry.line}`);
    }
    lines.push(bar);
    lines.push('  Captured output (first 3 lines per process)');
    lines.push(bar);
    for (const name of ['db', 'api', 'worker', 'web']) {
      const out = orckit.output(name).slice(0, 3);
      lines.push(`  [${name}]`);
      for (const o of out) {
        const tag = o.highlight ? ` <${o.highlight}>` : '';
        lines.push(`    ${o.stream === 'stderr' ? '!' : '|'} ${o.text}${tag}`);
      }
    }
    lines.push(bar);

    console.log(lines.join('\n'));
  }, 30_000);
});
