/**
 * Real-time overview CLI command using Blessed UI
 */

import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { connect, type Socket } from 'node:net';
import type { IPCMessage, StatusUpdateMessage, IPCProcessInfo } from '@/types';

export interface OverviewOptions {
  socketPath: string;
}

/**
 * Launch real-time overview UI
 */
export async function launchOverview(options: OverviewOptions): Promise<void> {
  // Create screen
  const screen = blessed.screen({
    smartCSR: true,
    title: 'Orckit Overview',
    fullUnicode: true,
  });

  // Create layout grid
  const grid = new contrib.grid({
    rows: 12,
    cols: 12,
    screen,
  });

  // Process table (top half)
  const processTable = grid.set(0, 0, 8, 12, contrib.table, {
    keys: true,
    vi: true,
    fg: 'white',
    selectedFg: 'white',
    selectedBg: 'blue',
    interactive: true,
    label: 'Processes',
    width: '100%',
    height: '100%',
    border: { type: 'line', fg: 'cyan' },
    columnSpacing: 2,
    columnWidth: [20, 10, 8, 10, 8, 10, 10],
  });

  // Log area (bottom half)
  const logBox = grid.set(8, 0, 4, 12, blessed.log, {
    fg: 'green',
    label: 'Logs',
    border: { type: 'line', fg: 'cyan' },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: ' ',
      track: {
        bg: 'cyan',
      },
      style: {
        inverse: true,
      },
    },
  });

  // Status bar at the bottom
  const statusBar = blessed.text({
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    content: ' Connected | q: quit | r: restart | s: stop | ?: help',
    style: {
      fg: 'black',
      bg: 'cyan',
    },
  });

  screen.append(statusBar);

  // Connect to IPC server
  let socket: Socket | null = null;
  let processes: IPCProcessInfo[] = [];

  const connectToServer = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      socket = connect(options.socketPath);

      socket.on('connect', () => {
        logBox.log('Connected to Orckit IPC server');
        statusBar.setContent(' Connected | q: quit | r: restart | s: stop | ?: help');
        screen.render();
        resolve();
      });

      socket.on('error', (error) => {
        logBox.log(`Connection error: ${error.message}`);
        statusBar.setContent(` Disconnected | q: quit | Error: ${error.message}`);
        screen.render();
        reject(error);
      });

      socket.on('close', () => {
        logBox.log('Disconnected from server');
        statusBar.setContent(' Disconnected | q: quit | Press Ctrl+C to exit');
        screen.render();
      });

      let buffer = '';
      socket.on('data', (data) => {
        buffer += data.toString();

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          try {
            const message = JSON.parse(line) as IPCMessage;
            handleMessage(message);
          } catch (error) {
            logBox.log(`Failed to parse message: ${error}`);
          }
        }
      });
    });
  };

  const handleMessage = (message: IPCMessage): void => {
    switch (message.type) {
      case 'status_update':
        updateProcessTable(message as StatusUpdateMessage);
        break;

      case 'command_response':
        logBox.log(`Command response: ${message.message}`);
        screen.render();
        break;

      case 'log':
        logBox.log(`[${message.processName}] ${message.content}`);
        screen.render();
        break;
    }
  };

  const updateProcessTable = (message: StatusUpdateMessage): void => {
    processes = message.processes;

    const headers = ['Process', 'Status', 'PID', 'Uptime', 'Restarts', 'Category', 'Build'];
    const data = processes.map((p) => {
      const uptimeStr = p.uptime ? formatUptime(p.uptime) : '-';
      const buildStr = p.buildInfo
        ? `${p.buildInfo.progress ?? 0}% E:${p.buildInfo.errors} W:${p.buildInfo.warnings}`
        : '-';

      return [
        p.name,
        formatStatus(p.status),
        p.pid?.toString() ?? '-',
        uptimeStr,
        p.restartCount.toString(),
        p.category,
        buildStr,
      ];
    });

    processTable.setData({
      headers,
      data,
    });

    screen.render();
  };

  const formatStatus = (status: string): string => {
    const statusIcons: Record<string, string> = {
      pending: '⏳ pending',
      starting: '⚙️  starting',
      running: '✅ running',
      building: '🔨 building',
      failed: '❌ failed',
      stopped: '⏹️  stopped',
    };
    return statusIcons[status] ?? status;
  };

  const formatUptime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const sendCommand = (action: 'restart' | 'stop' | 'start', processName: string): void => {
    if (!socket) {
      logBox.log('Not connected to server');
      return;
    }

    const message = JSON.stringify({
      type: 'command',
      action,
      processName,
    });

    socket.write(message + '\n');
    logBox.log(`Sent ${action} command for ${processName}`);
    screen.render();
  };

  // Key bindings
  screen.key(['q', 'C-c'], () => {
    if (socket) {
      socket.destroy();
    }
    process.exit(0);
  });

  processTable.rows.key(['r'], () => {
    const selected = processTable.rows.selected;
    if (selected >= 0 && processes[selected]) {
      const process = processes[selected];
      sendCommand('restart', process.name);
    }
  });

  processTable.rows.key(['s'], () => {
    const selected = processTable.rows.selected;
    if (selected >= 0 && processes[selected]) {
      const process = processes[selected];
      sendCommand('stop', process.name);
    }
  });

  processTable.rows.key(['?', 'h'], () => {
    const helpText = `
    Keyboard Shortcuts:

    Navigation:
      ↑/k     - Move up
      ↓/j     - Move down

    Actions:
      r       - Restart selected process
      s       - Stop selected process

    General:
      q       - Quit
      ?/h     - Show this help

    Press any key to close
    `;

    const helpBox = blessed.box({
      top: 'center',
      left: 'center',
      width: '50%',
      height: '50%',
      content: helpText,
      border: { type: 'line' },
      label: ' Help ',
      style: {
        fg: 'white',
        bg: 'black',
        border: {
          fg: 'cyan',
        },
      },
    });

    screen.append(helpBox);
    helpBox.focus();

    helpBox.key(['escape', 'q', 'enter', 'space'], () => {
      screen.remove(helpBox);
      processTable.focus();
      screen.render();
    });

    screen.render();
  });

  // Focus on process table
  processTable.focus();

  // Connect and render
  try {
    await connectToServer();
    screen.render();
  } catch (error) {
    logBox.log(`Failed to connect: ${error}`);
    screen.render();
  }
}
