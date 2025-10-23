/**
 * tmux session manager
 */

import { execa } from 'execa';
import { TMUX_THEME } from './theme.js';

/**
 * tmux session manager
 */
export class TmuxManager {
  private sessionName: string;
  private windows: Map<string, number> = new Map();
  private overviewPaneId: string | null = null;
  private windowsWithProcesses: Set<string> = new Set();
  private configFile: string;

  constructor(projectName: string = 'orckit') {
    this.sessionName = `${projectName}-dev`;
    this.configFile = `/tmp/orckit-tmux-${this.sessionName}.conf`;
  }

  /**
   * Check if session exists
   */
  async sessionExists(): Promise<boolean> {
    try {
      await execa('tmux', ['has-session', '-t', this.sessionName]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create tmux session
   */
  async createSession(): Promise<void> {
    // Kill existing session if it exists
    if (await this.sessionExists()) {
      await execa('tmux', ['kill-session', '-t', this.sessionName]);
    }

    // Write theme configuration to file
    await this.writeConfigFile();

    // Create new session (detached) with custom config
    await execa('tmux', [
      'new-session',
      '-d',
      '-s',
      this.sessionName,
      '-n',
      'overview',
      '-f',
      this.configFile,
    ]);

    // Create overview pane
    await this.createOverviewPane();
  }

  /**
   * Write tmux configuration to file
   */
  private async writeConfigFile(): Promise<void> {
    const fs = await import('node:fs/promises');

    // Clean up TMUX_THEME - remove empty lines and comments
    const config = TMUX_THEME.split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('#');
      })
      .join('\n');

    await fs.writeFile(this.configFile, config, 'utf-8');
  }

  /**
   * Create overview pane
   */
  private async createOverviewPane(): Promise<void> {
    // Split overview window into two panes: status view and terminal
    await execa('tmux', [
      'split-window',
      '-h',
      '-t',
      `${this.sessionName}:overview`,
      '-p',
      '40', // 40% width for terminal
    ]);

    // Get pane IDs
    const { stdout } = await execa('tmux', [
      'list-panes',
      '-t',
      `${this.sessionName}:overview`,
      '-F',
      '#{pane_id}',
    ]);

    const panes = stdout.split('\n');
    this.overviewPaneId = panes[0]; // Left pane for status

    // Start the interactive overview command in the left pane
    // The overview command will connect to the IPC socket and display real-time status
    const cliPath = 'node dist/cli/index.js';
    const overviewCommand = `${cliPath} overview`;
    await execa('tmux', ['send-keys', '-t', this.overviewPaneId, overviewCommand, 'C-m']);
  }

  /**
   * Create window for category
   */
  async createWindow(category: string, windowName: string): Promise<number> {
    if (this.windows.has(category)) {
      return this.windows.get(category)!;
    }

    // Create new window
    const { stdout } = await execa('tmux', [
      'new-window',
      '-t',
      this.sessionName,
      '-n',
      windowName,
      '-P',
      '-F',
      '#{window_index}',
    ]);

    const windowIndex = parseInt(stdout.trim(), 10);
    this.windows.set(category, windowIndex);

    return windowIndex;
  }

  /**
   * Create pane for process
   */
  async createProcessPane(
    category: string,
    processName: string,
    command: string,
    cwd?: string
  ): Promise<string> {
    const windowIndex = this.windows.get(category);
    if (windowIndex === undefined) {
      throw new Error(`Window for category '${category}' not found`);
    }

    const window = `${this.sessionName}:${windowIndex}`;

    // Get current number of panes in window
    const { stdout: paneCount } = await execa('tmux', [
      'list-panes',
      '-t',
      window,
      '-F',
      '#{pane_id}',
    ]);

    const panes = paneCount.split('\n').filter((p) => p);
    let paneId: string;

    // If this is the first process in this window, use the existing pane
    // Otherwise, split the window to create a new pane
    if (!this.windowsWithProcesses.has(category)) {
      // Use the existing pane for the first process in this window
      paneId = panes[0];
      this.windowsWithProcesses.add(category);
    } else {
      // Split window for subsequent processes
      // The -P flag prints the new pane ID
      const { stdout: splitOutput } = await execa('tmux', [
        'split-window',
        '-t',
        window,
        '-v',
        '-P',
        '-F',
        '#{pane_id}',
      ]);
      paneId = splitOutput.trim();

      // Apply tiled layout to organize panes
      await execa('tmux', ['select-layout', '-t', window, 'tiled']);
    }

    // Set pane title
    await execa('tmux', ['select-pane', '-t', paneId, '-T', processName]);

    // Change directory if specified
    if (cwd) {
      await execa('tmux', ['send-keys', '-t', paneId, `cd ${cwd}`, 'C-m']);
    }

    // Send command
    await execa('tmux', ['send-keys', '-t', paneId, command, 'C-m']);

    return paneId;
  }

  /**
   * Update overview pane content
   */
  async updateOverview(content: string): Promise<void> {
    if (!this.overviewPaneId) {
      return;
    }

    // Write content to the status file
    // tail -f will automatically display the updates without flickering
    const statusFile = `/tmp/orckit-status-${this.sessionName}.txt`;
    const fs = await import('node:fs/promises');

    // Clear the file and write new content
    // This causes tail -f to show the new content
    await fs.writeFile(statusFile, content, 'utf-8');
  }

  /**
   * Attach to session
   */
  async attach(): Promise<void> {
    await execa('tmux', ['attach-session', '-t', this.sessionName], {
      stdio: 'inherit',
    });
  }

  /**
   * Attach to specific process pane
   */
  async attachToProcess(paneId: string): Promise<void> {
    await execa('tmux', ['select-pane', '-t', paneId]);
    await this.attach();
  }

  /**
   * Kill session
   */
  async killSession(): Promise<void> {
    if (await this.sessionExists()) {
      await execa('tmux', ['kill-session', '-t', this.sessionName]);
    }

    // Clean up config file
    try {
      const fs = await import('node:fs/promises');
      await fs.unlink(this.configFile);
    } catch {
      // Ignore errors if file doesn't exist
    }
  }

  /**
   * Send keys to pane
   */
  async sendKeys(paneId: string, keys: string): Promise<void> {
    await execa('tmux', ['send-keys', '-t', paneId, keys]);
  }

  /**
   * Get session name
   */
  getSessionName(): string {
    return this.sessionName;
  }
}
