/**
 * Process runner factory
 */

import type { ProcessConfig } from '../types/index.js';
import type { ProcessRunner } from './base.js';
import { BashRunner } from './bash.js';
import { DockerRunner } from './docker.js';
import { NodeRunner } from './node.js';
import { WebpackRunner } from './webpack.js';
import { AngularRunner } from './angular.js';
import { ViteRunner } from './vite.js';

/**
 * Create appropriate runner for process configuration
 *
 * @param name - Process name
 * @param config - Process configuration
 * @returns Process runner instance
 */
export function createRunner(name: string, config: ProcessConfig): ProcessRunner {
  const type = config.type ?? 'bash';

  switch (type) {
    case 'bash':
      return new BashRunner(name, config);

    case 'docker':
      return new DockerRunner(name, config);

    case 'node':
    case 'ts-node':
      return new NodeRunner(name, config);

    case 'webpack':
    case 'build':
      return new WebpackRunner(name, config);

    case 'angular':
      return new AngularRunner(name, config);

    case 'vite':
      return new ViteRunner(name, config);

    default:
      throw new Error(`Unknown process type: ${type}`);
  }
}
