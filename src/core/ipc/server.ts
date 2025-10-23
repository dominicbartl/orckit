/**
 * IPC Server for real-time process communication
 * Uses Unix Domain Sockets for bi-directional communication between orchestrator and overview client
 */

import { createServer, type Server as NetServer, type Socket } from 'node:net';
import { unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type {
  IPCMessage,
  StatusUpdateMessage,
  CommandMessage,
  CommandResponseMessage,
  LogMessage,
  IPCProcessInfo,
  SystemMetrics,
} from '../../types/index.js';

export interface IPCServerOptions {
  socketPath: string;
}

/**
 * IPC Server that manages Unix socket communication
 */
export class IPCServer {
  private server: NetServer | null = null;
  private clients: Set<Socket> = new Set();
  private socketPath: string;

  constructor(options: IPCServerOptions) {
    this.socketPath = options.socketPath;
  }

  /**
   * Start the IPC server
   */
  async start(): Promise<void> {
    // Clean up existing socket if it exists
    if (existsSync(this.socketPath)) {
      await unlink(this.socketPath);
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on('error', (error) => {
        reject(error);
      });

      this.server.listen(this.socketPath, () => {
        resolve();
      });
    });
  }

  /**
   * Stop the IPC server and clean up
   */
  async stop(): Promise<void> {
    // Close all client connections
    for (const client of this.clients) {
      client.destroy();
    }
    this.clients.clear();

    // Close server
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          resolve();
        });
      });
    }

    // Clean up socket file
    if (existsSync(this.socketPath)) {
      await unlink(this.socketPath);
    }
  }

  /**
   * Handle new client connection
   */
  private handleConnection(socket: Socket): void {
    this.clients.add(socket);

    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();

      // Process complete messages (newline-delimited JSON)
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        try {
          const message = JSON.parse(line) as IPCMessage;
          this.handleMessage(socket, message);
        } catch (error) {
          console.error('Failed to parse IPC message:', error);
        }
      }
    });

    socket.on('close', () => {
      this.clients.delete(socket);
    });

    socket.on('error', (error) => {
      console.error('IPC socket error:', error);
      this.clients.delete(socket);
    });
  }

  /**
   * Handle incoming message from client
   */
  private handleMessage(socket: Socket, message: IPCMessage): void {
    if (message.type === 'command') {
      this.handleCommand(socket, message as CommandMessage);
    }
  }

  /**
   * Handle command message from client
   */
  private handleCommand(socket: Socket, message: CommandMessage): void {
    // Commands are handled by orchestrator via event emission
    // The orchestrator will call sendCommandResponse after handling
    // For now, we'll emit a custom event that orchestrator can listen to
    if (this.server) {
      this.server.emit('ipc:command', message, socket);
    }
  }

  /**
   * Broadcast status update to all connected clients
   */
  broadcastStatus(processes: IPCProcessInfo[], systemMetrics?: SystemMetrics): void {
    const message: StatusUpdateMessage = {
      type: 'status_update',
      timestamp: new Date(),
      processes,
      systemMetrics,
    };

    this.broadcast(message);
  }

  /**
   * Send log message to all connected clients
   */
  broadcastLog(processName: string, level: 'stdout' | 'stderr', content: string): void {
    const message: LogMessage = {
      type: 'log',
      processName,
      timestamp: new Date(),
      level,
      content,
    };

    this.broadcast(message);
  }

  /**
   * Send command response to specific client
   */
  sendCommandResponse(socket: Socket, success: boolean, message: string, data?: unknown): void {
    const response: CommandResponseMessage = {
      type: 'command_response',
      success,
      message,
      data,
    };

    this.send(socket, response);
  }

  /**
   * Broadcast message to all connected clients
   */
  private broadcast(message: IPCMessage): void {
    const json = JSON.stringify(message) + '\n';
    const buffer = Buffer.from(json);

    for (const client of this.clients) {
      try {
        client.write(buffer);
      } catch (error) {
        console.error('Failed to send message to client:', error);
        this.clients.delete(client);
      }
    }
  }

  /**
   * Send message to specific client
   */
  private send(socket: Socket, message: IPCMessage): void {
    const json = JSON.stringify(message) + '\n';
    try {
      socket.write(json);
    } catch (error) {
      console.error('Failed to send message to client:', error);
      this.clients.delete(socket);
    }
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get the server instance for listening to custom events
   */
  getServer(): NetServer | null {
    return this.server;
  }
}
