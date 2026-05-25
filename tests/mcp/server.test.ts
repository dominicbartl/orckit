import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Orckit } from '../../src/orchestrator/orchestrator.js';
import { validateConfig } from '../../src/config/load.js';
import { attachMcpServer, type McpServerHandle } from '../../src/mcp/server.js';

describe('attachMcpServer over Streamable HTTP', () => {
  let orckit: Orckit;
  let server: McpServerHandle;
  let client: Client;
  let transport: StreamableHTTPClientTransport;

  beforeEach(async () => {
    const config = validateConfig({
      project: 'mcp-test',
      processes: {
        api: { command: 'sleep 1', restart: 'never' },
        worker: { command: 'sleep 1', restart: 'never', manual_retry: true },
      },
    });
    orckit = new Orckit(config);
    server = await attachMcpServer(orckit, { port: 0 });

    transport = new StreamableHTTPClientTransport(new URL(server.url));
    client = new Client({ name: 'orckit-mcp-test', version: '0.0.0' }, { capabilities: {} });
    await client.connect(transport);
  });

  afterEach(async () => {
    await client.close();
    await server.dispose();
    await orckit.dispose();
  });

  it('lists exactly the three orckit tools with input schemas', async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual(['get_errors', 'get_logs', 'get_status']);

    const logsTool = result.tools.find((t) => t.name === 'get_logs')!;
    expect(logsTool.inputSchema.properties).toMatchObject({
      name: expect.any(Object),
      lines: expect.any(Object),
      stream: expect.any(Object),
    });
    expect(logsTool.inputSchema.required).toEqual(['name']);
  });

  it('get_status returns the current process states', async () => {
    const result = await client.callTool({ name: 'get_status' });
    expect(result.isError).not.toBe(true);
    const json = extractJson(result);
    expect(json.processes).toHaveLength(2);
    const names = json.processes.map((p: { name: string }) => p.name).sort();
    expect(names).toEqual(['api', 'worker']);
    // All processes are pending because we never called start()
    for (const p of json.processes) {
      expect(p.state).toBe('pending');
      expect(p.pid).toBeNull();
    }
    const worker = json.processes.find((p: { name: string }) => p.name === 'worker');
    expect(worker.manualRetry).toBe(true);
  });

  it('get_errors reflects a process:failed emission', async () => {
    // No errors initially.
    let result = await client.callTool({ name: 'get_errors' });
    expect(extractJson(result).errors).toEqual([]);

    // Simulate a failed process by manipulating the internal handle via a fake
    // event. We bypass the public API because the test should focus on the
    // MCP layer, not on orchestrating a real crash.
    const handle = (
      orckit as unknown as {
        handles: Map<string, { state: string; buffer: { push(t: string, s: string): unknown } }>;
      }
    ).handles.get('api')!;
    handle.state = 'failed';
    handle.buffer.push('database connection refused', 'stderr');
    orckit.emit('process:failed', 'api', new Error('exited (code 1)'));

    result = await client.callTool({ name: 'get_errors' });
    const json = extractJson(result);
    expect(json.errors).toHaveLength(1);
    expect(json.errors[0].name).toBe('api');
    expect(json.errors[0].lastError).toBe('exited (code 1)');
    expect(json.errors[0].recentStderr.map((l: { text: string }) => l.text)).toContain(
      'database connection refused',
    );
  });

  it('get_logs returns recent output for a named process', async () => {
    // Push some output directly into the internal buffer.
    const handle = (
      orckit as unknown as {
        handles: Map<string, { buffer: { push(t: string, s: 'stdout' | 'stderr'): unknown } }>;
      }
    ).handles.get('api')!;
    handle.buffer.push('listening on 3000', 'stdout');
    handle.buffer.push('warning: slow query', 'stderr');

    const result = await client.callTool({
      name: 'get_logs',
      arguments: { name: 'api', lines: 10 },
    });
    const json = extractJson(result);
    expect(json.name).toBe('api');
    expect(json.lines.map((l: { text: string }) => l.text)).toEqual([
      'listening on 3000',
      'warning: slow query',
    ]);
  });

  it('get_logs returns an isError result for an unknown process', async () => {
    const result = await client.callTool({
      name: 'get_logs',
      arguments: { name: 'nope' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toMatch(/unknown process/);
  });

  it('rejects an EADDRINUSE bind with a clear message', async () => {
    const port = server.port;
    await expect(attachMcpServer(orckit, { port })).rejects.toThrow(/already in use/);
  });
});

function extractJson(result: unknown): {
  processes?: { name: string; state: string; pid: number | null; manualRetry: boolean }[];
  errors?: { name: string; lastError: string | null; recentStderr: { text: string }[] }[];
  name?: string;
  lines?: { text: string }[];
} {
  const content = (result as { content: { type: string; text: string }[] }).content;
  const jsonBlock = content.find((c) => c.text.startsWith('```json'))!;
  const inner = jsonBlock.text.replace(/^```json\n/, '').replace(/\n```$/, '');
  return JSON.parse(inner);
}
