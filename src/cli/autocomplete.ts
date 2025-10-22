/**
 * Shell autocomplete for Orckit CLI
 */

import omelette from 'omelette';
import { existsSync } from 'fs';
import { parseConfig } from '../core/config/parser.js';

/**
 * Setup shell autocomplete
 */
export function setupAutocomplete(): void {
  const completion = omelette('orc <command> <args>');

  // Complete commands
  completion.on('command', ({ reply }: { reply: (items: string[]) => void }) => {
    reply(['start', 'stop', 'restart', 'status', 'list', 'validate', 'logs', 'attach', 'completion']);
  });

  // Complete process names for relevant commands
  completion.on('args', ({ reply, line, fragment }: { reply: (items: string[]) => void; line: string; fragment: string }) => {
    // Try to load config
    let processNames: string[] = [];

    try {
      // Look for config file
      const configPaths = ['./orckit.yaml', './orckit.yml', './.orckit/config.yaml'];
      const configPath = configPaths.find((p) => existsSync(p));

      if (configPath) {
        const config = parseConfig(configPath);
        processNames = Object.keys(config.processes);
      }
    } catch {
      // Ignore config errors during autocomplete
    }

    // Suggest process names for relevant commands
    if (
      line.includes('start') ||
      line.includes('stop') ||
      line.includes('restart') ||
      line.includes('logs') ||
      line.includes('attach')
    ) {
      reply(processNames);
    }

    // Suggest config file paths for -c flag
    if (fragment === '-c' || line.endsWith('-c ')) {
      reply(['./orckit.yaml', './orckit.yml', './.orckit/config.yaml']);
    }
  });

  completion.init();
}

/**
 * Print installation instructions
 */
export function printInstallInstructions(): void {
  console.log(`
Shell Autocomplete Setup:

Bash:
  Add to ~/.bashrc:
    eval "$(orc completion)"

Zsh:
  Add to ~/.zshrc:
    eval "$(orc completion)"

Fish:
  Add to ~/.config/fish/config.fish:
    orc completion | source

After adding, restart your shell or run:
  source ~/.bashrc  # or ~/.zshrc or ~/.config/fish/config.fish
`);
}

/**
 * Get completion script
 */
export function getCompletionScript(): string {
  const completion = omelette('orc');
  return completion.setupSh();
}
