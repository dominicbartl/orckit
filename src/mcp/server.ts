import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Orckit } from '../orchestrator/orchestrator.js';
import { registerTools } from './tools.js';

export interface McpServerOptions {
  /** Port to bind. Use 0 to pick an arbitrary free port (handy for tests). */
  port: number;
  /** Host to bind. Defaults to 127.0.0.1; only override for non-localhost setups. */
  host?: string;
  /** Path component of the MCP endpoint. Defaults to "/mcp". */
  path?: string;
}

export interface McpServerHandle {
  /** Full URL clients should connect to (e.g. "http://127.0.0.1:7676/mcp"). */
  readonly url: string;
  /** The bound port (resolved if options.port was 0). */
  readonly port: number;
  /** Stop listening, close all open streams, detach event listeners. */
  dispose(): Promise<void>;
}

/**
 * Attach an in-process MCP server to an Orckit instance. The server exposes
 * three read-only tools (`get_status`, `get_errors`, `get_logs`) over
 * Streamable HTTP and is intended to be hit by Claude Code or any other MCP
 * client.
 *
 * Returns a handle whose `dispose()` cleanly closes the HTTP listener and
 * tears down the MCP transport. Throws on `EADDRINUSE` so the caller can
 * surface a useful "port busy" message — does NOT silently fall back to a
 * random port, since that would break clients with a static URL config.
 */
export async function attachMcpServer(
  orckit: Orckit,
  opts: McpServerOptions,
): Promise<McpServerHandle> {
  const host = opts.host ?? '127.0.0.1';
  const path = opts.path ?? '/mcp';

  const lastErrors = new Map<string, string>();
  const onFailed = (name: string, err?: Error) => {
    lastErrors.set(name, err?.message ?? 'process failed');
  };
  orckit.on('process:failed', onFailed);

  // Streamable HTTP in stateless mode requires a fresh transport per request —
  // see the SDK's simpleStatelessStreamableHttp example. The McpServer setup
  // is also re-created per request (cheap; just tool registration).
  const handleMcp = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const mcp = new McpServer(
      { name: 'orckit', version: '0.2.0' },
      { capabilities: { tools: {} } },
    );
    registerTools(mcp, orckit, lastErrors);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close().catch(() => {});
      mcp.close().catch(() => {});
    });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: (err as Error).message },
            id: null,
          }),
        );
      }
    }
  };

  const http: HttpServer = createServer((req, res) => {
    if (!req.url || pathOf(req) !== path) {
      res.statusCode = 404;
      res.end();
      return;
    }
    void handleMcp(req, res);
  });

  await listen(http, opts.port, host);
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  const url = `http://${host}:${port}${path}`;

  return {
    url,
    port,
    async dispose() {
      orckit.off('process:failed', onFailed);
      await new Promise<void>((resolve, reject) => {
        http.close((err) => (err ? reject(err) : resolve()));
        // http.close() only stops accepting new sockets; it waits for existing
        // ones to drain before invoking the callback. A connected MCP client
        // (e.g. Claude Code holding a keep-alive socket) would hang shutdown
        // indefinitely — force-terminate active sockets so close() resolves.
        http.closeAllConnections();
      });
    },
  };
}

function pathOf(req: IncomingMessage): string {
  const url = req.url ?? '/';
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

function listen(server: HttpServer, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `port ${port} on ${host} is already in use — pass --mcp-port to choose another, ` +
              'or stop the other orckit',
          ),
        );
      } else {
        reject(err);
      }
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}
