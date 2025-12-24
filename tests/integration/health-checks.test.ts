/**
 * Health Check Integration Tests
 *
 * Tests the health checking system with real processes.
 * Verifies that processes correctly wait for readiness.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Orckit } from '@/core/orckit';
import type { OrckitConfig } from '@/types';
import { createServer, type Server } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer } from 'node:net';

describe('Health Check Integration', () => {
  let orckit: Orckit | null = null;
  let httpServer: Server | null = null;
  let tcpServer: TcpServer | null = null;

  afterEach(async () => {
    if (orckit) {
      try {
        await orckit.stop();
      } catch {
        // Ignore cleanup errors
      }
      orckit = null;
    }

    if (httpServer) {
      httpServer.close();
      httpServer = null;
    }

    if (tcpServer) {
      tcpServer.close();
      tcpServer = null;
    }
  });

  describe('log-pattern ready check', () => {
    it('should wait for log pattern to appear', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-logpattern',
        processes: {
          server: {
            category: 'test',
            type: 'bash',
            command: 'sleep 0.5 && echo "Server is ready!" && sleep 5',
            ready: {
              type: 'log-pattern',
              pattern: 'Server is ready',
              timeout: 5000,
            },
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const events: string[] = [];
      const timestamps: Record<string, number> = {};

      orckit.on('process:starting', (e) => {
        events.push(`starting:${e.processName}`);
        timestamps['starting'] = Date.now();
      });
      orckit.on('process:ready', (e) => {
        events.push(`ready:${e.processName}`);
        timestamps['ready'] = Date.now();
      });

      await orckit.start();

      expect(events).toContain('starting:server');
      expect(events).toContain('ready:server');

      // Ready should come after starting (with some delay for the log pattern)
      const delay = timestamps['ready'] - timestamps['starting'];
      expect(delay).toBeGreaterThan(400); // Should wait for the log pattern
    });

    it('should fail if log pattern never appears', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-logpattern-fail',
        processes: {
          server: {
            category: 'test',
            type: 'bash',
            command: 'echo "Wrong message" && sleep 5',
            ready: {
              type: 'log-pattern',
              pattern: 'This pattern will never match',
              timeout: 1000, // Short timeout
            },
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const events: string[] = [];
      orckit.on('process:failed', (e) => events.push(`failed:${e.processName}`));

      await expect(orckit.start()).rejects.toThrow();
      expect(events).toContain('failed:server');
    });
  });

  describe('http ready check', () => {
    it('should wait for HTTP endpoint to respond', async () => {
      const port = 19876;

      // Start an HTTP server after a delay
      setTimeout(() => {
        httpServer = createServer((req, res) => {
          res.writeHead(200);
          res.end('OK');
        });
        httpServer.listen(port);
      }, 500);

      const config: OrckitConfig = {
        version: '1',
        project: 'test-http',
        processes: {
          // This process just waits - the HTTP server is started separately
          waiter: {
            category: 'test',
            type: 'bash',
            command: 'sleep 10',
            ready: {
              type: 'http',
              url: `http://localhost:${port}/`,
              timeout: 5000,
              interval: 200,
            },
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const events: string[] = [];
      orckit.on('process:ready', (e) => events.push(`ready:${e.processName}`));

      await orckit.start();

      expect(events).toContain('ready:waiter');
    });

    it('should fail if HTTP endpoint never responds', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-http-fail',
        processes: {
          waiter: {
            category: 'test',
            type: 'bash',
            command: 'sleep 10',
            ready: {
              type: 'http',
              url: 'http://localhost:19999/', // Port that nothing listens on
              timeout: 1000,
              interval: 200,
            },
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const events: string[] = [];
      orckit.on('process:failed', (e) => events.push(`failed:${e.processName}`));

      await expect(orckit.start()).rejects.toThrow();
      expect(events).toContain('failed:waiter');
    });
  });

  describe('tcp ready check', () => {
    it('should wait for TCP port to be available', async () => {
      const port = 19877;

      // Start a TCP server after a delay
      setTimeout(() => {
        tcpServer = createTcpServer((socket) => {
          socket.end('Hello\n');
        });
        tcpServer.listen(port);
      }, 500);

      const config: OrckitConfig = {
        version: '1',
        project: 'test-tcp',
        processes: {
          waiter: {
            category: 'test',
            type: 'bash',
            command: 'sleep 10',
            ready: {
              type: 'tcp',
              host: 'localhost',
              port: port,
              timeout: 5000,
            },
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const events: string[] = [];
      orckit.on('process:ready', (e) => events.push(`ready:${e.processName}`));

      await orckit.start();

      expect(events).toContain('ready:waiter');
    });

    it('should fail if TCP port never opens', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-tcp-fail',
        processes: {
          waiter: {
            category: 'test',
            type: 'bash',
            command: 'sleep 10',
            ready: {
              type: 'tcp',
              host: 'localhost',
              port: 19998, // Port that nothing listens on
              timeout: 1000,
            },
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const events: string[] = [];
      orckit.on('process:failed', (e) => events.push(`failed:${e.processName}`));

      await expect(orckit.start()).rejects.toThrow();
      expect(events).toContain('failed:waiter');
    });
  });

  describe('process exit during health check', () => {
    it('should fail fast if process crashes during health check', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-crash',
        processes: {
          crasher: {
            category: 'test',
            type: 'bash',
            // Process starts then crashes immediately
            command: 'echo "Starting..." && exit 1',
            ready: {
              type: 'http',
              url: 'http://localhost:19999/', // This will never respond
              timeout: 60000, // Long timeout - but should fail fast due to crash
            },
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const events: string[] = [];
      orckit.on('process:failed', (e) => events.push(`failed:${e.processName}`));

      const startTime = Date.now();
      await expect(orckit.start()).rejects.toThrow(/Process (exited|failed)/);
      const duration = Date.now() - startTime;

      expect(events).toContain('failed:crasher');
      // Should fail within a few seconds, not 60 seconds
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('exit-code ready check', () => {
    it('should mark process as ready when it exits with code 0', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-exitcode',
        processes: {
          task: {
            category: 'test',
            type: 'bash',
            command: 'echo "Task completed" && exit 0',
            ready: {
              type: 'exit-code',
            },
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const events: string[] = [];
      orckit.on('process:ready', (e) => events.push(`ready:${e.processName}`));

      await orckit.start();

      // Exit-code processes are marked ready immediately (handled by runner)
      expect(events).toContain('ready:task');
    });
  });

  describe('custom ready check', () => {
    it('should run custom command to check readiness', async () => {
      // Create a temp file that the custom check will look for
      const marker = `/tmp/orckit-test-ready-${Date.now()}`;

      const config: OrckitConfig = {
        version: '1',
        project: 'test-custom',
        processes: {
          server: {
            category: 'test',
            type: 'bash',
            // Create the marker file after 500ms
            command: `sleep 0.5 && touch ${marker} && sleep 5`,
            ready: {
              type: 'custom',
              command: `test -f ${marker}`,
              timeout: 5000,
            },
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const events: string[] = [];
      orckit.on('process:ready', (e) => events.push(`ready:${e.processName}`));

      await orckit.start();

      expect(events).toContain('ready:server');

      // Cleanup
      try {
        const { unlink } = await import('node:fs/promises');
        await unlink(marker);
      } catch {
        // Ignore cleanup errors
      }
    });
  });

  describe('multiple processes with health checks', () => {
    it('should wait for all processes to be ready', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-multiple',
        processes: {
          fast: {
            category: 'test',
            type: 'bash',
            command: 'echo "Fast ready" && sleep 5',
            ready: {
              type: 'log-pattern',
              pattern: 'Fast ready',
              timeout: 3000,
            },
          },
          slow: {
            category: 'test',
            type: 'bash',
            command: 'sleep 0.5 && echo "Slow ready" && sleep 5',
            ready: {
              type: 'log-pattern',
              pattern: 'Slow ready',
              timeout: 3000,
            },
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const readyEvents: string[] = [];
      orckit.on('process:ready', (e) => readyEvents.push(e.processName));

      await orckit.start();

      expect(readyEvents).toContain('fast');
      expect(readyEvents).toContain('slow');
    });

    it('should handle mixed ready check types', async () => {
      const marker = `/tmp/orckit-test-mixed-${Date.now()}`;

      const config: OrckitConfig = {
        version: '1',
        project: 'test-mixed',
        processes: {
          logBased: {
            category: 'test',
            type: 'bash',
            command: 'echo "Log based ready" && sleep 5',
            ready: {
              type: 'log-pattern',
              pattern: 'Log based ready',
              timeout: 3000,
            },
          },
          customBased: {
            category: 'test',
            type: 'bash',
            command: `touch ${marker} && sleep 5`,
            ready: {
              type: 'custom',
              command: `test -f ${marker}`,
              timeout: 3000,
            },
          },
          noCheck: {
            category: 'test',
            type: 'bash',
            command: 'echo "No check" && sleep 5',
            // No ready check - should be ready immediately
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const readyEvents: string[] = [];
      orckit.on('process:ready', (e) => readyEvents.push(e.processName));

      await orckit.start();

      expect(readyEvents).toContain('logBased');
      expect(readyEvents).toContain('customBased');
      expect(readyEvents).toContain('noCheck');

      // Cleanup
      try {
        const { unlink } = await import('node:fs/promises');
        await unlink(marker);
      } catch {
        // Ignore cleanup errors
      }
    });
  });
});
