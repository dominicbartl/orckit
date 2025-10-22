/**
 * Vite plugin for Orckit integration
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Plugin = any;

/**
 * Vite plugin options
 */
export interface MaestroVitePluginOptions {
  /**
   * Path to orckit configuration file
   */
  configPath?: string;

  /**
   * Process name in orckit config
   */
  processName: string;

  /**
   * Start dependencies before vite
   */
  startDependencies?: boolean;
}

/**
 * Vite plugin for Orckit integration
 *
 * @example
 * ```typescript
 * // vite.config.ts
 * import { maestro } from '@orckit/cli/vite';
 *
 * export default defineConfig({
 *   plugins: [
 *     maestro({
 *       configPath: './orckit.yaml',
 *       processName: 'vite',
 *       startDependencies: true
 *     })
 *   ]
 * });
 * ```
 */
export function maestro(options: MaestroVitePluginOptions): Plugin {
  let startTime: number;

  return {
    name: 'orckit-vite-plugin',

    configResolved() {
      // Configuration has been resolved
      sendEvent({
        type: 'config:resolved',
        processName: options.processName,
        timestamp: new Date().toISOString(),
      });
    },

    buildStart() {
      startTime = Date.now();
      sendEvent({
        type: 'build:start',
        processName: options.processName,
        timestamp: new Date().toISOString(),
      });
    },

    buildEnd(error?: Error) {
      const duration = Date.now() - startTime;

      if (error) {
        sendEvent({
          type: 'build:failed',
          processName: options.processName,
          error: error.message,
          duration,
          timestamp: new Date().toISOString(),
        });
      } else {
        sendEvent({
          type: 'build:complete',
          processName: options.processName,
          success: true,
          duration,
          timestamp: new Date().toISOString(),
        });
      }
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configureServer(server: any) {
      // Development server specific hooks
      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address();
        const port = address && typeof address === 'object' ? (address.port as number) : undefined;

        sendEvent({
          type: 'server:ready',
          processName: options.processName,
          port,
          timestamp: new Date().toISOString(),
        });
      });
    },
  };
}

/**
 * Send event to orckit
 */
function sendEvent(event: Record<string, unknown>): void {
  // In a real implementation, this would send events via IPC or websocket
  console.log(`[ORCKIT_EVENT] ${JSON.stringify(event)}`);
}
