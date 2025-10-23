/**
 * Process runner factory
 */

import type { ProcessConfig } from '../types/index.js';
import type { ProcessRunner } from './base.js';
import type { TmuxManager } from '../core/tmux/manager.js';
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
 * @param tmuxManager - Optional tmux manager for running processes in tmux panes
 * @returns Process runner instance
 */
export function createRunner(
  name: string,
  config: ProcessConfig,
  tmuxManager?: TmuxManager
): ProcessRunner {
  const type = config.type ?? 'bash';

  switch (type) {
    case 'bash':
      return new BashRunner(name, config, tmuxManager);

    case 'docker':
      return new DockerRunner(name, config, tmuxManager);

    case 'node':
    case 'ts-node':
      return new NodeRunner(name, config, tmuxManager);

    case 'webpack':
    case 'build':
      return new WebpackRunner(name, config, tmuxManager);

    case 'angular':
      return new AngularRunner(name, config, tmuxManager);

    case 'vite':
      return new ViteRunner(name, config, tmuxManager);

    default:
      throw new Error(`Unknown process type: ${type}`);
  }
}
