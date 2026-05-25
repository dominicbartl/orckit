/**
 * End-to-end MCP server integration.
 *
 * Spawns `tsx src/cli.ts start` as a child process with a tiny YAML config,
 * waits for the printed MCP URL, then connects an MCP client over Streamable
 * HTTP and exercises each of the three tools. Mirrors
 * `tests/integration/fullstack.test.ts` in style.
 *
 * Run with:
 *   pnpm test:integration -- mcp
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { isPortFree } from '../../src/util/port.js';

async function findFreePort(): Promise<number> {
  for (let i = 0; i < 50; i++) {
    const port = 30_000 + Math.floor(Math.random() * 20_000);
    if (await isPortFree(port)) return port;
  }
  throw new Error('no free port');
}

const REPO_ROOT = resolve(__dirname, '..', '..');
const TSX = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const CLI = join(REPO_ROOT, 'src', 'cli.ts');

describe('orc start + MCP end-to-end', () => {
  let tmpDir: string;
  let configPath: string;
  let mcpPort: number;
  let child: ChildProcess | null = null;
  let mcpUrl: string;
  let client: Client;
  let transport: StreamableHTTPClientTransport;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'orckit-mcp-int-'));
    configPath = join(tmpDir, 'orckit.yaml');
    mcpPort = await findFreePort();

    writeFileSync(
      configPath,
      [
        'project: mcp-int',
        'mcp:',
        '  enabled: true',
        `  port: ${mcpPort}`,
        'processes:',
        '  worker:',
        '    command: sleep 30',
        '    restart: never',
      ].join('\n') + '\n',
    );

    child = spawn(TSX, [CLI, 'start', '-c', configPath, '--no-repl'], {
      cwd: tmpDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const urlPromise = new Promise<string>((resolveFn, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timed out waiting for mcp URL line')),
        15_000,
      );
      child!.stdout!.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        const match = text.match(/mcp:\s*(http:\/\/\S+)/);
        if (match) {
          clearTimeout(timer);
          resolveFn(match[1]);
        }
      });
      child!.on('error', reject);
      child!.on('exit', (code) =>
        reject(new Error(`orc start exited early with code ${code ?? '?'}`)),
      );
    });

    mcpUrl = await urlPromise;

    transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
    client = new Client({ name: 'orckit-int-test', version: '0.0.0' }, { capabilities: {} });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    try {
      await client?.close();
    } catch {
      // already closed
    }
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise<void>((r) => {
        const t = setTimeout(() => {
          child!.kill('SIGKILL');
          r();
        }, 5_000);
        child!.on('exit', () => {
          clearTimeout(t);
          r();
        });
      });
    }
    rmSync(tmpDir, { recursive: true, force: true });
  }, 15_000);

  it('exposes the three orckit tools via the printed URL', async () => {
    const result = await client.listTools();
    expect(result.tools.map((t) => t.name).sort()).toEqual([
      'get_errors',
      'get_logs',
      'get_status',
    ]);
  });

  it('get_status returns the running worker', async () => {
    const result = await client.callTool({ name: 'get_status' });
    expect(result.isError).not.toBe(true);
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toMatch(/worker/);
    expect(text).toMatch(/running/);
  });

  it('get_errors reports no errors for a healthy stack', async () => {
    const result = await client.callTool({ name: 'get_errors' });
    expect(result.isError).not.toBe(true);
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toMatch(/no errors/);
  });

  it('get_logs returns output for the worker process', async () => {
    const result = await client.callTool({
      name: 'get_logs',
      arguments: { name: 'worker', lines: 10 },
    });
    expect(result.isError).not.toBe(true);
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toMatch(/worker/);
  });

  it('get_logs returns an isError result for an unknown process', async () => {
    const result = await client.callTool({
      name: 'get_logs',
      arguments: { name: 'nope' },
    });
    expect(result.isError).toBe(true);
  });
});
