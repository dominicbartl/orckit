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
  BufferSyncMessage,
  BufferRequestMessage,
  LogBatchMessage,
  OutputLine,
  IPCProcessInfo,
  SystemMetrics,
} from '../../types/index.js';

export interface IPCServerOptions {
  socketPath: string;
  batchInterval?: number; // Milliseconds between log batch broadcasts (default: 100ms)
}

/**
 * IPC Server that manages Unix socket communication
 */
export class IPCServer {
  private server: NetServer | null = null;
  private clients: Set<Socket> = new Set();
  private socketPath: string;
  private batchInterval: number;
  private logBatch: LogBatchMessage['logs'] = [];
  private batchTimer: NodeJS.Timeout | null = null;

  constructor(options: IPCServerOptions) {
    this.socketPath = options.socketPath;
    this.batchInterval = options.batchInterval ?? 100;
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
        // Start batch timer
        this.startBatchTimer();
        resolve();
      });
    });
  }

  /**
   * Stop the IPC server and clean up
   */
  async stop(): Promise<void> {
    // Stop batch timer
    this.stopBatchTimer();

    // Flush any remaining batched logs
    this.flushLogBatch();

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
      // Only log non-EPIPE errors (EPIPE is expected when client disconnects)
      if ((error as NodeJS.ErrnoException).code !== 'EPIPE') {
        console.error('IPC socket error:', error);
      }
      this.clients.delete(socket);
      try {
        socket.destroy();
      } catch {
        // Already destroyed
      }
    });
  }

  /**
   * Handle incoming message from client
   */
  private handleMessage(socket: Socket, message: IPCMessage): void {
    if (message.type === 'command') {
      this.handleCommand(socket, message as CommandMessage);
    } else if (message.type === 'buffer_request') {
      this.handleBufferRequest(socket, message as BufferRequestMessage);
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
   * Note: Logs are batched for performance
   */
  broadcastLog(processName: string, level: 'stdout' | 'stderr', content: string): void {
    this.logBatch.push({
      processName,
      level,
      content,
      timestamp: new Date(),
    });

    // If batch is large, flush immediately
    if (this.logBatch.length >= 100) {
      this.flushLogBatch();
    }
  }

  /**
   * Send buffer sync message to a specific client
   */
  sendBufferSync(
    socket: Socket,
    processName: string,
    lines: OutputLine[],
    totalLines: number,
    maxSize: number
  ): void {
    const message: BufferSyncMessage = {
      type: 'buffer_sync',
      processName,
      lines,
      totalLines,
      maxSize,
    };

    this.send(socket, message);
  }

  /**
   * Broadcast log batch to all connected clients
   */
  private broadcastLogBatch(): void {
    if (this.logBatch.length === 0) {
      return;
    }

    const message: LogBatchMessage = {
      type: 'log_batch',
      logs: [...this.logBatch],
    };

    this.broadcast(message);
    this.logBatch = [];
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

    // Create array to avoid modifying Set during iteration
    const clientsToRemove: Socket[] = [];

    for (const client of this.clients) {
      // Check if socket is still writable
      if (!client.writable || client.destroyed) {
        clientsToRemove.push(client);
        continue;
      }

      try {
        client.write(buffer);
      } catch (error) {
        // Socket is broken, mark for removal
        clientsToRemove.push(client);
      }
    }

    // Remove disconnected clients
    for (const client of clientsToRemove) {
      this.clients.delete(client);
      try {
        client.destroy();
      } catch {
        // Already destroyed
      }
    }
  }

  /**
   * Send message to specific client
   */
  private send(socket: Socket, message: IPCMessage): void {
    // Check if socket is still writable
    if (!socket.writable || socket.destroyed) {
      this.clients.delete(socket);
      return;
    }

    const json = JSON.stringify(message) + '\n';
    try {
      socket.write(json);
    } catch (error) {
      // Socket is broken, clean up
      this.clients.delete(socket);
      try {
        socket.destroy();
      } catch {
        // Already destroyed
      }
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

  /**
   * Handle buffer request from client
   */
  private handleBufferRequest(socket: Socket, message: BufferRequestMessage): void {
    // Emit event for orchestrator to handle
    // The orchestrator will call sendBufferSync with the data
    if (this.server) {
      this.server.emit('ipc:buffer_request', message, socket);
    }
  }

  /**
   * Start batch timer
   */
  private startBatchTimer(): void {
    if (this.batchTimer) {
      return;
    }

    this.batchTimer = setInterval(() => {
      this.flushLogBatch();
    }, this.batchInterval);
  }

  /**
   * Stop batch timer
   */
  private stopBatchTimer(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
  }

  /**
   * Flush log batch immediately
   */
  private flushLogBatch(): void {
    this.broadcastLogBatch();
  }

  /**
   * Force flush any pending log batches (useful for testing)
   */
  flush(): void {
    this.flushLogBatch();
  }
}
