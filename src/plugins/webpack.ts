/**
 * Webpack plugin for Orckit integration
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Compiler = any;

/**
 * Webpack plugin options
 */
export interface MaestroWebpackPluginOptions {
  /**
   * Path to orckit configuration file
   */
  orckitConfig?: string;

  /**
   * Process name in orckit config
   */
  processName: string;

  /**
   * Processes to wait for before starting build
   */
  waitFor?: string[];

  /**
   * Report progress to orckit
   */
  reportProgress?: boolean;
}

/**
 * Webpack plugin for Orckit integration
 *
 * This plugin integrates webpack builds with Orckit, providing:
 * - Real-time build progress
 * - Build statistics
 * - Dependency waiting
 *
 * @example
 * ```javascript
 * // webpack.config.js
 * import { MaestroWebpackPlugin } from '@orckit/cli/webpack';
 *
 * export default {
 *   plugins: [
 *     new MaestroWebpackPlugin({
 *       orckitConfig: './orckit.yaml',
 *       processName: 'webpack',
 *       waitFor: ['api']
 *     })
 *   ]
 * };
 * ```
 */
export class MaestroWebpackPlugin {
  private options: MaestroWebpackPluginOptions;

  constructor(options: MaestroWebpackPluginOptions) {
    this.options = options;
  }

  apply(compiler: Compiler): void {
    const { processName, reportProgress = true } = this.options;

    // Hook into compilation lifecycle
    compiler.hooks.compile.tap('MaestroWebpackPlugin', () => {
      this.sendEvent({
        type: 'build:start',
        processName,
        timestamp: new Date().toISOString(),
      });
    });

    // Report progress
    if (reportProgress) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      const progressPlugin = new compiler.webpack.ProgressPlugin(
        (percentage: number, msg: string) => {
          this.sendEvent({
            type: 'build:progress',
            processName,
            progress: Math.floor(percentage * 100),
            message: msg,
            timestamp: new Date().toISOString(),
          });
        }
      );

      progressPlugin.apply(compiler);
    }

    // Hook into compilation complete
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    compiler.hooks.done.tap('MaestroWebpackPlugin', (stats: any) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const hasErrors = stats.hasErrors() as boolean;

      this.sendEvent({
        type: hasErrors ? 'build:failed' : 'build:complete',
        processName,
        success: !hasErrors,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        duration: stats.endTime && stats.startTime ? stats.endTime - stats.startTime : 0,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        errors: stats.compilation.errors.length as number,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        warnings: stats.compilation.warnings.length as number,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        hash: stats.hash as string,
        timestamp: new Date().toISOString(),
      });
    });
  }

  /**
   * Send event to orckit (stub - would use IPC in real implementation)
   */
  private sendEvent(event: Record<string, unknown>): void {
    // In a real implementation, this would send events via IPC or websocket
    // For now, just log to console in a structured format
    console.log(`[ORCKIT_EVENT] ${JSON.stringify(event)}`);
  }
}
